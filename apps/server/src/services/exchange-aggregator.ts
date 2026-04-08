import ccxt, { Exchange } from 'ccxt';
import type { MarketEvent, AggregatedOrderBook, OrderBookLevel, ExchangeStatus, AggregatedTicker } from '@opencharts/common';
import { marketDataPipeline } from './market-data-pipeline';
import { logger } from './logger';

/**
 * ExchangeAggregator: manages multiple CCXT exchange connections
 * simultaneously, merges order books, and produces a unified price
 * feed using volume-weighted average pricing (VWAP).
 */

interface ExchangeHandle {
  id: string;
  exchange: Exchange;
  symbols: string[];
  pollIntervalMs: number;
  interval: NodeJS.Timeout | null;
  connected: boolean;
  lastUpdate: number | null;
  latencyMs: number | null;
  /** Latest price/volume per symbol on this exchange */
  tickers: Map<string, { price: number; volume: number; timestamp: number }>;
}

export interface ExchangeConfig {
  id: string; // ccxt exchange id
  symbols: string[];
  pollIntervalMs?: number;
  options?: Record<string, unknown>;
}

export class ExchangeAggregator {
  private exchanges = new Map<string, ExchangeHandle>();
  private running = false;

  // ── Add / remove exchanges ────────────────────────

  async addExchange(cfg: ExchangeConfig): Promise<void> {
    if (this.exchanges.has(cfg.id)) {
      logger.warn({ exchange: cfg.id }, '[Aggregator] Exchange already added');
      return;
    }

    const ExchangeClass = ccxt[cfg.id as keyof typeof ccxt] as unknown as new (opts?: Record<string, unknown>) => Exchange;
    if (!ExchangeClass) {
      throw new Error(`Unknown exchange: ${cfg.id}`);
    }

    const exchange = new ExchangeClass({
      enableRateLimit: true,
      ...cfg.options,
    });

    await exchange.loadMarkets();

    const handle: ExchangeHandle = {
      id: cfg.id,
      exchange,
      symbols: cfg.symbols,
      pollIntervalMs: cfg.pollIntervalMs ?? 3000,
      interval: null,
      connected: true,
      lastUpdate: null,
      latencyMs: null,
      tickers: new Map(),
    };

    this.exchanges.set(cfg.id, handle);
    logger.info({ exchange: cfg.id, markets: Object.keys(exchange.markets).length, symbols: cfg.symbols.length }, '[Aggregator] Exchange added');

    if (this.running) {
      this.startPolling(handle);
    }
  }

  removeExchange(exchangeId: string): void {
    const handle = this.exchanges.get(exchangeId);
    if (!handle) return;
    if (handle.interval) clearInterval(handle.interval);
    this.exchanges.delete(exchangeId);
    logger.info({ exchange: exchangeId }, '[Aggregator] Exchange removed');
  }

  // ── Start / stop ──────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const handle of this.exchanges.values()) {
      this.startPolling(handle);
    }
    logger.info({ exchanges: this.exchanges.size }, '[Aggregator] Started');
  }

  stop(): void {
    this.running = false;
    for (const handle of this.exchanges.values()) {
      if (handle.interval) {
        clearInterval(handle.interval);
        handle.interval = null;
      }
    }
    logger.info('[Aggregator] Stopped');
  }

  // ── Polling loop ──────────────────────────────────

  private startPolling(handle: ExchangeHandle): void {
    if (handle.interval) return;

    const poll = async () => {
      for (const symbol of handle.symbols) {
        try {
          const start = Date.now();
          const ticker = await handle.exchange.fetchTicker(symbol);
          handle.latencyMs = Date.now() - start;
          handle.lastUpdate = Date.now();
          handle.connected = true;

          if (!ticker.last) continue;

          handle.tickers.set(symbol, {
            price: ticker.last,
            volume: ticker.quoteVolume ?? ticker.baseVolume ?? 0,
            timestamp: ticker.timestamp ?? Date.now(),
          });

          // Emit into pipeline with exchange tag
          const event: MarketEvent = {
            type: 'trade',
            symbol: this.normalizeSymbol(symbol),
            timestamp: ticker.timestamp ?? Date.now(),
            price: ticker.last,
            volume: ticker.quoteVolume ?? 0,
            provider: handle.id,
          };
          await marketDataPipeline.onMarketEvent(event);
        } catch (err) {
          handle.connected = false;
          logger.error({ exchange: handle.id, symbol, err: (err as Error).message }, '[Aggregator] Poll error');
        }
      }
    };

    // Immediate first poll
    poll();
    handle.interval = setInterval(poll, handle.pollIntervalMs);
  }

  // ── Aggregated ticker (VWAP across exchanges) ─────

  getAggregatedTicker(symbol: string): AggregatedTicker | null {
    const normalized = this.normalizeSymbol(symbol);
    const prices: { exchange: string; price: number; volume: number }[] = [];

    for (const handle of this.exchanges.values()) {
      // Check both raw and normalized symbol
      const t = handle.tickers.get(symbol) ?? handle.tickers.get(normalized);
      if (t) {
        prices.push({ exchange: handle.id, price: t.price, volume: t.volume });
      }
    }

    if (prices.length === 0) return null;

    const totalVolume = prices.reduce((s, p) => s + p.volume, 0);
    const vwap = totalVolume > 0
      ? prices.reduce((s, p) => s + p.price * p.volume, 0) / totalVolume
      : prices.reduce((s, p) => s + p.price, 0) / prices.length;

    return {
      symbol: normalized,
      price: parseFloat(vwap.toFixed(8)),
      prices,
      totalVolume,
      timestamp: Date.now(),
    };
  }

  // ── Aggregated order book ─────────────────────────

  async getAggregatedOrderBook(symbol: string, depth: number = 20): Promise<AggregatedOrderBook> {
    const allBids: OrderBookLevel[] = [];
    const allAsks: OrderBookLevel[] = [];
    const exchangeIds: string[] = [];

    const fetchPromises = [...this.exchanges.values()].map(async (handle) => {
      if (!handle.connected) return;
      try {
        const ob = await handle.exchange.fetchOrderBook(symbol, depth);
        exchangeIds.push(handle.id);
        for (const [price, amount] of ob.bids) {
          allBids.push({ price: Number(price), amount: Number(amount), exchange: handle.id });
        }
        for (const [price, amount] of ob.asks) {
          allAsks.push({ price: Number(price), amount: Number(amount), exchange: handle.id });
        }
      } catch (err) {
        logger.warn({ exchange: handle.id, symbol, err: (err as Error).message }, '[Aggregator] Order book fetch failed');
      }
    });

    await Promise.all(fetchPromises);

    // Sort: bids descending, asks ascending
    allBids.sort((a, b) => b.price - a.price);
    allAsks.sort((a, b) => a.price - b.price);

    const bestBid = allBids[0] ?? null;
    const bestAsk = allAsks[0] ?? null;

    let vwap: number | null = null;
    if (bestBid && bestAsk) {
      // Calculate VWAP of top N levels
      const topBids = allBids.slice(0, depth);
      const topAsks = allAsks.slice(0, depth);
      const all = [...topBids, ...topAsks];
      const totalAmount = all.reduce((s, l) => s + l.amount, 0);
      if (totalAmount > 0) {
        vwap = all.reduce((s, l) => s + l.price * l.amount, 0) / totalAmount;
      }
    }

    const spread = bestBid && bestAsk ? bestAsk.price - bestBid.price : null;

    return {
      symbol,
      timestamp: Date.now(),
      bids: allBids.slice(0, depth),
      asks: allAsks.slice(0, depth),
      bestBid,
      bestAsk,
      vwap: vwap !== null ? parseFloat(vwap.toFixed(8)) : null,
      spread: spread !== null ? parseFloat(spread.toFixed(8)) : null,
      exchanges: exchangeIds,
    };
  }

  // ── Status ────────────────────────────────────────

  getStatus(): ExchangeStatus[] {
    return [...this.exchanges.values()].map((h) => ({
      id: h.id,
      name: String(h.exchange.name),
      connected: h.connected,
      symbols: h.symbols,
      lastUpdate: h.lastUpdate,
      latencyMs: h.latencyMs,
    }));
  }

  getConnectedCount(): number {
    return [...this.exchanges.values()].filter((h) => h.connected).length;
  }

  // ── Helpers ───────────────────────────────────────

  private normalizeSymbol(s: string): string {
    return s;
  }
}

export const exchangeAggregator = new ExchangeAggregator();

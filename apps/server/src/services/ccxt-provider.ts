import ccxt, { Exchange, OHLCV as CcxtOHLCV } from 'ccxt';
import type { MarketEvent } from '@opencharts/common';
import { marketDataPipeline } from './market-data-pipeline';
import { logger } from './logger';

/**
 * CcxtProvider: connects to real crypto exchanges via the CCXT unified API.
 * Fetches live trades and/or polls ticker data to feed the candle aggregation pipeline.
 *
 * Supports any CCXT-compatible exchange (Binance, Coinbase, Kraken, Bybit, etc.)
 */

export interface CcxtProviderConfig {
  /** CCXT exchange id, e.g. 'binance', 'coinbase', 'kraken' */
  exchangeId: string;
  /** Symbols to subscribe to (CCXT format, e.g. 'BTC/USDT') */
  symbols: string[];
  /** Polling interval in ms for REST-based price fetching (default: 2000) */
  pollIntervalMs?: number;
  /** CCXT exchange options (apiKey, secret, sandbox, etc.) */
  exchangeOptions?: Record<string, unknown>;
}

export class CcxtProvider {
  private exchange: Exchange | null = null;
  private intervals: NodeJS.Timeout[] = [];
  private config: CcxtProviderConfig;
  private running = false;

  constructor(config: CcxtProviderConfig) {
    this.config = config;
  }

  /** Initialize the exchange connection */
  async init(): Promise<void> {
    const ExchangeClass = ccxt[this.config.exchangeId as keyof typeof ccxt] as unknown as new (opts?: Record<string, unknown>) => Exchange;
    if (!ExchangeClass) {
      throw new Error(`Unknown exchange: ${this.config.exchangeId}. Available: ${ccxt.exchanges.join(', ')}`);
    }

    this.exchange = new ExchangeClass({
      enableRateLimit: true,
      ...this.config.exchangeOptions,
    });

    // Load markets
    await this.exchange.loadMarkets();
    logger.info({ exchange: this.config.exchangeId, markets: Object.keys(this.exchange.markets).length }, '[CCXT] Connected');
  }

  /**
   * Start polling for live ticker data.
   * Emits MarketEvents into the pipeline.
   */
  start(): void {
    if (!this.exchange) throw new Error('Call init() before start()');
    if (this.running) return;
    this.running = true;

    const pollMs = this.config.pollIntervalMs ?? 2000;

    const interval = setInterval(async () => {
      for (const symbol of this.config.symbols) {
        try {
          const ticker = await this.exchange!.fetchTicker(symbol);
          if (!ticker.last || !ticker.quoteVolume) continue;

          const event: MarketEvent = {
            type: 'trade',
            symbol: this.normalizeSymbol(symbol),
            timestamp: ticker.timestamp ?? Date.now(),
            price: ticker.last,
            volume: ticker.quoteVolume ?? 0,
            provider: this.config.exchangeId,
          };

          await marketDataPipeline.onMarketEvent(event);
        } catch (err) {
          logger.error({ symbol, err: (err as Error).message }, '[CCXT] Ticker fetch error');
        }
      }
    }, pollMs);

    this.intervals.push(interval);
    logger.info({ symbols: this.config.symbols.length, intervalMs: pollMs }, '[CCXT] Polling started');
  }

  /**
   * Fetch historical OHLCV bars from the exchange and backfill into the database.
   */
  async fetchHistoricalBars(
    symbol: string,
    timeframe: string = '1d',
    since?: number,
    limit: number = 500,
  ): Promise<{ time: number; open: number; high: number; low: number; close: number; volume: number }[]> {
    if (!this.exchange) throw new Error('Call init() before fetchHistoricalBars()');

    const raw: CcxtOHLCV[] = await this.exchange.fetchOHLCV(symbol, timeframe, since, limit);

    return raw.map(([timestamp, open, high, low, close, volume]) => ({
      time: Math.floor(timestamp / 1000),
      open,
      high,
      low,
      close,
      volume,
    }));
  }

  /**
   * Watch real-time trades using WebSocket (if exchange supports it).
   * Falls back to polling if not available.
   */
  async startWatchTrades(): Promise<void> {
    if (!this.exchange) throw new Error('Call init() before startWatchTrades()');

    // Check if exchange supports watchTrades
    if (!this.exchange.has['watchTrades']) {
      logger.info('[CCXT] Exchange does not support watchTrades, using polling');
      this.start();
      return;
    }

    this.running = true;
    logger.info({ symbols: this.config.symbols.join(', ') }, '[CCXT] Starting WebSocket trade stream');

    for (const symbol of this.config.symbols) {
      this.watchTradesLoop(symbol);
    }
  }

  private async watchTradesLoop(symbol: string): Promise<void> {
    while (this.running) {
      try {
        const trades = await (this.exchange as Exchange & { watchTrades: (s: string) => Promise<{ price: number; amount: number; timestamp: number }[]> }).watchTrades(symbol);
        for (const trade of trades) {
          const event: MarketEvent = {
            type: 'trade',
            symbol: this.normalizeSymbol(symbol),
            timestamp: trade.timestamp,
            price: trade.price,
            volume: trade.amount,
            provider: this.config.exchangeId,
          };
          await marketDataPipeline.onMarketEvent(event);
        }
      } catch (err) {
        logger.error({ symbol, err: (err as Error).message }, '[CCXT] Watch trades error');
        // Brief pause before reconnecting
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  /** Normalize CCXT symbol format to our internal format */
  private normalizeSymbol(ccxtSymbol: string): string {
    // CCXT uses 'BTC/USDT', we use 'BTC/USD' — keep as-is for now
    // Users can configure symbol mapping if needed
    return ccxtSymbol;
  }

  /** Get available symbols on the exchange */
  getAvailableSymbols(): string[] {
    if (!this.exchange) return [];
    return Object.keys(this.exchange.markets);
  }

  /** Get list of supported exchanges */
  static getExchanges(): string[] {
    return ccxt.exchanges;
  }

  stop(): void {
    this.running = false;
    this.intervals.forEach(clearInterval);
    this.intervals = [];
    logger.info('[CCXT] Provider stopped');
  }
}

import type {
  CandleRequest,
  ConnectionState,
  MarketDataSource,
  MarketEvent,
  Quote,
  Unsubscribe,
} from "../adapter/types.ts";
import type { Candle, Symbol as OcSymbol } from "../services/schemas.ts";
import { createInfoClient } from "./info.ts";
import type { HlRawCandle, InfoClient } from "./info.ts";
import { createMarketRegistry, toOpenChartsSymbols } from "./symbols.ts";
import type { HlMarket, MarketRegistry } from "./types.ts";
import { createHlSocket } from "./ws.ts";
import type { HlSocket } from "./ws.ts";

/**
 * Live, read-only Hyperliquid market data for the OpenCharts adapter contract.
 *
 * History: `candleSnapshot` returns at most the most recent ~5000 candles per
 * interval (verified live: 1m/1h/1d/1w all cap near 5000; windows entirely
 * older than that come back empty), so one request per page is enough and
 * "scrolled past available history" simply yields [].
 *
 * Live: never subscribes to the whole list's order books. The charted
 * symbol(s) get `bbo` + `candle`; the rest of the watchlist rides one cheap
 * `allMids` subscription per dex (ticks synthesised as bid = ask = mid).
 *
 * Units (matching src/pages/trading/ChartPanel.tsx): `Candle.time` is SECONDS;
 * candle MarketEvent `timestamp` is the bar's OPEN time in SECONDS (the chart
 * accepts s or ms); tick `timestamp` is epoch MS.
 */

export const TIMEFRAME_MS: Readonly<Record<string, number>> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 3_600_000,
  "4h": 4 * 3_600_000,
  "1d": 86_400_000,
  "1w": 7 * 86_400_000,
};

/** HL serves at most this many candles per interval. */
export const HL_MAX_CANDLES = 5000;
const DEFAULT_LIMIT = 500;
const MAX_CHART_STREAMS = 6;
const SYMBOLS_TTL_MS = 60_000;

export interface HyperliquidMarketDataOptions {
  info?: InfoClient;
  socket?: HlSocket;
  registry?: MarketRegistry;
  fetchImpl?: typeof fetch;
  webSocketImpl?: typeof WebSocket;
  /** Max simultaneous `bbo` subscriptions (default 10). */
  maxBboSubscriptions?: number;
  now?: () => number;
}

export type HyperliquidMarketData = MarketDataSource & {
  registry: MarketRegistry;
  info: InfoClient;
  socket: HlSocket;
};

/** Map one raw HL candle to an OpenCharts candle (time in seconds). */
export function toCandle(c: HlRawCandle): Candle {
  return {
    time: Math.floor(c.t / 1000),
    open: Number(c.o),
    high: Number(c.h),
    low: Number(c.l),
    close: Number(c.c),
    // A missing/garbled volume must not poison the volume histogram with NaN.
    volume: Number.isFinite(Number(c.v)) ? Number(c.v) : 0,
  };
}

function isValidCandle(c: Candle): boolean {
  return [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite);
}

function dexOf(coin: string): string {
  const i = coin.indexOf(":");
  return i > 0 ? coin.slice(0, i) : "";
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}

interface BboLevel {
  px?: string;
}
interface BboFrame {
  coin?: string;
  time?: number;
  bbo?: (BboLevel | null)[];
}
interface MidsFrame {
  dex?: string;
  mids?: Record<string, string>;
}

export function createHyperliquidMarketData(
  opts: HyperliquidMarketDataOptions = {},
): HyperliquidMarketData {
  const info = opts.info ?? createInfoClient(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {});
  const registry = opts.registry ?? createMarketRegistry(info);
  const socket =
    opts.socket ?? createHlSocket(opts.webSocketImpl ? { webSocketImpl: opts.webSocketImpl } : {});
  const maxBbo = opts.maxBboSubscriptions ?? 10;
  const now = opts.now ?? Date.now;

  const handlers = new Set<(event: MarketEvent) => void>();
  let started = false;
  let interest: string[] = [];
  /** LRU of charted (symbol, timeframe) pairs, oldest first. */
  const chartKeys = new Map<string, { symbol: string; timeframe: string }>();
  /** Active upstream subscriptions by logical key. */
  const active = new Map<string, () => void>();
  const bboCoins = new Set<string>();
  const candleKeys = new Set<string>();
  const lastMid = new Map<string, number>();
  /** Listed perp coins (refreshed on every reconcile); empty until the registry has loaded. */
  const knownCoins = new Set<string>();

  const emit = (event: MarketEvent) => {
    for (const h of [...handlers]) {
      try {
        h(event);
      } catch (err) {
        console.error("[hyperliquid] subscriber threw", err);
      }
    }
  };

  // ── Frame handlers ──────────────────────────────────────

  // HL does not echo the subscription key, and the socket routes by channel,
  // so every handler on a channel sees every frame. Each upstream subscription
  // therefore gets a handler that only reacts to ITS coin/interval; otherwise N
  // bbo subscriptions would emit every tick N times.
  const onBbo = (coin: string) => (data: unknown) => {
    const f = data as BboFrame | null;
    if (!f?.coin || f.coin !== coin || !bboCoins.has(f.coin) || !f.bbo) return;
    const bid = Number(f.bbo[0]?.px);
    const ask = Number(f.bbo[1]?.px);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return;
    emit({
      type: "tick",
      symbol: f.coin,
      bid: Math.min(bid, ask),
      ask: Math.max(bid, ask),
      timestamp: f.time ?? now(),
    });
  };

  const onCandle = (coin: string, tf: string) => (data: unknown) => {
    // The documented type is Candle[]; the live feed sends a bare object. Accept both.
    const frames = Array.isArray(data) ? (data as (HlRawCandle | null)[]) : [data as HlRawCandle | null];
    for (const c of frames) emitCandle(c, coin, tf);
  };

  const emitCandle = (c: HlRawCandle | null, coin: string, tf: string) => {
    if (!c || c.s !== coin || c.i !== tf || !candleKeys.has(`${c.s}|${c.i}`)) return;
    const candle = toCandle(c);
    if (!isValidCandle(candle)) return;
    emit({
      type: "candle",
      symbol: c.s,
      timeframe: c.i,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      timestamp: candle.time,
    });
  };

  const onMids = (dex: string) => (data: unknown) => {
    const f = data as MidsFrame | null;
    if (!f?.mids || (f.dex ?? "") !== dex) return;
    const ts = now();
    for (const [coin, px] of Object.entries(f.mids)) {
      if (coin.startsWith("@") || coin.startsWith("#")) continue;
      // The core frame also carries spot pairs ("PURR/USDC"); only listed perps get ticks.
      if (knownCoins.size > 0 ? !knownCoins.has(coin) : coin.includes("/")) continue;
      // A symbol with a live book subscription already gets better ticks.
      if (bboCoins.has(coin)) continue;
      const mid = Number(px);
      if (!Number.isFinite(mid) || mid <= 0) continue;
      if (lastMid.get(coin) === mid) continue;
      lastMid.set(coin, mid);
      emit({ type: "tick", symbol: coin, bid: mid, ask: mid, timestamp: ts });
    }
  };

  // ── Subscription reconciliation ─────────────────────────

  function desired(): { bbo: string[]; candles: { coin: string; tf: string }[]; dexes: string[] } {
    const interestSet = new Set(interest);
    const charted = [...chartKeys.values()].filter(
      (k) => interestSet.size === 0 || interestSet.has(k.symbol),
    );
    // Most recently charted first so it wins the bbo budget.
    const chartedCoins = [...new Set(charted.map((k) => k.symbol).reverse())];
    const bbo = [...new Set([...chartedCoins, ...interest])].slice(0, maxBbo);

    const dexes = new Set<string>();
    if (interest.length > 0) {
      for (const s of interest) dexes.add(dexOf(s));
      for (const c of chartedCoins) dexes.add(dexOf(c));
    } else if (registry.markets().length > 0) {
      for (const m of registry.markets()) dexes.add(m.dex);
    } else {
      dexes.add("");
    }

    return {
      bbo,
      candles: charted.map((k) => ({ coin: k.symbol, tf: k.timeframe })),
      dexes: [...dexes],
    };
  }

  function sync(key: string, wanted: boolean, make: () => (() => void) | null) {
    const has = active.get(key);
    if (wanted && !has) {
      try {
        const release = make();
        if (release) active.set(key, release);
      } catch (err) {
        console.warn("[hyperliquid] subscription skipped:", describe(err));
      }
    } else if (!wanted && has) {
      has();
      active.delete(key);
    }
  }

  function reconcile() {
    if (!started) return;
    const want = desired();
    const wantKeys = new Set<string>();
    knownCoins.clear();
    for (const m of registry.markets()) knownCoins.add(m.symbol);

    bboCoins.clear();
    for (const c of want.bbo) bboCoins.add(c);
    candleKeys.clear();
    for (const c of want.candles) candleKeys.add(`${c.coin}|${c.tf}`);

    for (const coin of want.bbo) {
      const key = `bbo:${coin}`;
      wantKeys.add(key);
      sync(key, true, () => socket.subscribe({ type: "bbo", coin }, onBbo(coin)));
    }
    for (const c of want.candles) {
      const key = `candle:${c.coin}:${c.tf}`;
      wantKeys.add(key);
      sync(key, true, () => socket.subscribe({ type: "candle", coin: c.coin, interval: c.tf }, onCandle(c.coin, c.tf)));
    }
    for (const dex of want.dexes) {
      const key = `mids:${dex}`;
      wantKeys.add(key);
      sync(key, true, () =>
        socket.subscribe(dex ? { type: "allMids", dex } : { type: "allMids" }, onMids(dex)),
      );
    }
    for (const key of [...active.keys()]) {
      if (!wantKeys.has(key)) sync(key, false, () => null);
    }
  }

  function rememberChart(symbol: string, timeframe: string) {
    const key = `${symbol}|${timeframe}`;
    chartKeys.delete(key);
    chartKeys.set(key, { symbol, timeframe });
    while (chartKeys.size > MAX_CHART_STREAMS) {
      const oldest = chartKeys.keys().next().value;
      if (oldest === undefined) break;
      chartKeys.delete(oldest);
    }
    reconcile();
  }

  // ── Registry helpers ────────────────────────────────────

  async function ensureRegistry(): Promise<void> {
    try {
      await registry.load();
    } catch (err) {
      throw new Error(`Could not load Hyperliquid markets: ${describe(err)}`);
    }
  }

  async function resolveMarket(symbol: string): Promise<HlMarket> {
    await ensureRegistry();
    const market = registry.bySymbol(symbol);
    if (!market) throw new Error(`Unknown Hyperliquid market "${symbol}".`);
    return market;
  }

  // ── History ─────────────────────────────────────────────

  async function fetchWindow(
    coin: string,
    timeframe: string,
    start: number,
    end: number | undefined,
  ): Promise<Candle[]> {
    const req = end === undefined
      ? { coin, interval: timeframe, startTime: Math.max(0, Math.floor(start)) }
      : { coin, interval: timeframe, startTime: Math.max(0, Math.floor(start)), endTime: Math.floor(end) };
    try {
      const raw = await info.candleSnapshot(req);
      return (Array.isArray(raw) ? raw : []).map(toCandle).filter(isValidCandle);
    } catch (err) {
      throw new Error(`Could not load ${coin} ${timeframe} candles: ${describe(err)}`);
    }
  }

  async function getCandles(request: CandleRequest): Promise<Candle[]> {
    const intervalMs = Object.hasOwn(TIMEFRAME_MS, request.timeframe)
      ? TIMEFRAME_MS[request.timeframe]
      : undefined;
    if (!intervalMs) {
      throw new Error(
        `Unsupported timeframe "${request.timeframe}". Hyperliquid supports ${Object.keys(TIMEFRAME_MS).join(", ")}.`,
      );
    }
    const market = await resolveMarket(request.symbol);
    const coin = market.coin;
    if (request.toMs === undefined) rememberChart(request.symbol, request.timeframe);

    const cap = Math.min(HL_MAX_CANDLES, Math.max(1, Math.floor(request.limit ?? DEFAULT_LIMIT)));
    const endExclusiveMs = request.toMs !== undefined ? Math.floor(request.toMs) : undefined;
    // HL's endTime is inclusive; toMs is exclusive.
    const endInclusive = endExclusiveMs !== undefined ? endExclusiveMs - 1 : undefined;
    const horizon = endInclusive ?? now();

    let rows: Candle[];
    if (request.fromMs !== undefined) {
      rows = await fetchWindow(coin, request.timeframe, request.fromMs, endInclusive);
    } else {
      // Ask for a window sized for `cap` bars; markets with gaps (weekends,
      // halts) may return fewer, so widen to HL's full reach once.
      const narrowStart = horizon - cap * intervalMs * 1.5;
      rows = await fetchWindow(coin, request.timeframe, narrowStart, endInclusive);
      if (rows.length < cap && narrowStart > 0) {
        rows = await fetchWindow(coin, request.timeframe, horizon - HL_MAX_CANDLES * intervalMs, endInclusive);
      }
    }

    const fromSec = request.fromMs !== undefined ? request.fromMs / 1000 : -Infinity;
    const toSec = endExclusiveMs !== undefined ? endExclusiveMs / 1000 : Infinity;
    const byTime = new Map<number, Candle>();
    for (const c of rows) {
      if (c.time >= fromSec && c.time < toSec) byTime.set(c.time, c);
    }
    const sorted = [...byTime.values()].sort((a, b) => a.time - b.time);
    return request.limit !== undefined || request.fromMs === undefined ? sorted.slice(-cap) : sorted;
  }

  // ── Symbols ─────────────────────────────────────────────

  let symbolsCache: { at: number; value: Promise<OcSymbol[]> } | null = null;

  async function loadSymbols(): Promise<OcSymbol[]> {
    await ensureRegistry();
    const markets = registry.markets();
    const dexes = [...new Set(markets.map((m) => m.dex))];
    const settled = await Promise.allSettled(dexes.map((d) => info.allMids(d || undefined)));
    const mids: Record<string, number> = {};
    for (const r of settled) {
      if (r.status !== "fulfilled") continue;
      for (const [coin, px] of Object.entries(r.value)) {
        const n = Number(px);
        if (Number.isFinite(n) && n > 0) mids[coin] = n;
      }
    }
    return toOpenChartsSymbols(markets, mids);
  }

  // ── Public surface ──────────────────────────────────────

  return {
    registry,
    info,
    socket,

    getSymbols(): Promise<OcSymbol[]> {
      const t = now();
      if (!symbolsCache || t - symbolsCache.at > SYMBOLS_TTL_MS) {
        const value = loadSymbols();
        const entry = { at: t, value };
        symbolsCache = entry;
        value.catch(() => {
          if (symbolsCache === entry) symbolsCache = null;
        });
      }
      return symbolsCache.value;
    },

    getCandles,

    async getQuote(symbol: string): Promise<Quote | null> {
      await ensureRegistry();
      const market = registry.bySymbol(symbol);
      if (!market) return null;
      try {
        const book = await info.l2Book(market.coin);
        const bid = Number(book.levels?.[0]?.[0]?.px);
        const ask = Number(book.levels?.[1]?.[0]?.px);
        if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
          return { symbol, bid, ask, timestamp: book.time ?? now() };
        }
        const mids = await info.allMids(market.dex || undefined);
        const mid = Number(mids[market.coin]);
        if (Number.isFinite(mid) && mid > 0) return { symbol, bid: mid, ask: mid, timestamp: now() };
        return null;
      } catch (err) {
        throw new Error(`Could not load a quote for ${symbol}: ${describe(err)}`);
      }
    },

    subscribe(handler: (event: MarketEvent) => void): Unsubscribe {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    connect(): void {
      started = true;
      socket.connect();
      reconcile();
      // Learn the full dex list so the idle watchlist can ride allMids.
      registry
        .load()
        .then(reconcile)
        .catch((err: unknown) => {
          console.warn("[hyperliquid] market list unavailable:", describe(err));
        });
    },

    disconnect(): void {
      started = false;
      for (const release of active.values()) release();
      active.clear();
      bboCoins.clear();
      candleKeys.clear();
      lastMid.clear();
      socket.disconnect();
    },

    onConnectionChange(handler: (state: ConnectionState) => void): Unsubscribe {
      return socket.onState(handler);
    },

    getConnectionState: () => socket.getState(),

    setSymbolInterest(symbols: string[]): void {
      interest = [...new Set(symbols)];
      reconcile();
    },
  };
}

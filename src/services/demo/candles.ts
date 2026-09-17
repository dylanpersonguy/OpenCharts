import type { Candle } from "../schemas.ts";

/**
 * Loads the bundled REAL OHLC history and serves it to the chart / feed.
 *
 * The series are imported lazily, one `<SYMBOL>_<tf>.json` chunk at a time.
 * Bundling all 48 files eagerly put ~4 MB of candle data into the entry chunk,
 * which every visitor downloaded before the terminal could paint — even though
 * a session typically touches two or three of them.
 *
 * History is time-shifted at runtime so the most recent bar aligns to the
 * current period, making the demo feel "live" while every OHLC value remains
 * genuine market data (never synthetic). The demo feed (feed.ts) then streams
 * replayed real ticks forward from "now".
 */

const loaders = import.meta.glob<{ default: Candle[] }>("./data/*.json");

/** Resolved series, keyed "BTCUSD_1h". */
const cache = new Map<string, Candle[]>();
/** In-flight loads, so concurrent callers share one network/chunk request. */
const inflight = new Map<string, Promise<Candle[]>>();

function isUsableBar(bar: unknown): bar is Candle {
  if (!bar || typeof bar !== "object") return false;
  const c = bar as Partial<Candle>;
  return (
    Number.isFinite(c.time) &&
    Number.isFinite(c.open) &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.close)
  );
}

function seriesKey(symbol: string, timeframe: string): string {
  return `${symbol}_${timeframe}`;
}

/**
 * Load one series, caching both the result and the in-flight promise. Missing
 * or corrupt bundles resolve to an empty series rather than rejecting — a
 * missing timeframe must not blank the terminal.
 */
export function loadSeries(symbol: string, timeframe: string): Promise<Candle[]> {
  const key = seriesKey(symbol, timeframe);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(key);
  if (pending) return pending;

  const loader = loaders[`./data/${key}.json`];
  if (!loader) {
    cache.set(key, []);
    return Promise.resolve([]);
  }

  const promise = loader()
    .then((mod) => {
      const bars = Array.isArray(mod.default) ? mod.default.filter(isUsableBar) : [];
      cache.set(key, bars);
      return bars;
    })
    .catch(() => {
      cache.set(key, []);
      return [] as Candle[];
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

const TF_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
};

/** Start of the current period (seconds) for a timeframe. */
function currentBucketSec(timeframe: string): number {
  const interval = TF_SECONDS[timeframe] ?? 60;
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec - (nowSec % interval);
}

/** Per-(symbol,timeframe) time delta that maps the last real bar onto "now". */
function shiftDelta(bars: Candle[], timeframe: string): number {
  if (bars.length === 0) return 0;
  const lastReal = bars[bars.length - 1]!.time;
  return currentBucketSec(timeframe) - lastReal;
}

export interface HistoryRange {
  /** Inclusive lower bound in epoch milliseconds. */
  fromMs?: number;
  /** Exclusive upper bound in epoch milliseconds. */
  toMs?: number;
}

/**
 * Real history for a symbol/timeframe, shifted so the last bar is the current
 * period. `range` narrows to a window (used by the chart's scroll-back
 * pagination); `limit` keeps the most recent N bars of whatever remains.
 */
export async function getHistory(
  symbol: string,
  timeframe: string,
  limit?: number,
  range?: HistoryRange,
): Promise<Candle[]> {
  const raw = await loadSeries(symbol, timeframe);
  if (raw.length === 0) return [];

  const delta = shiftDelta(raw, timeframe);
  let bars = raw.map((c) => ({ ...c, time: c.time + delta }));

  if (range) {
    const fromSec = range.fromMs != null ? Math.floor(range.fromMs / 1000) : null;
    const toSec = range.toMs != null ? Math.floor(range.toMs / 1000) : null;
    bars = bars.filter(
      (c) => (fromSec == null || c.time >= fromSec) && (toSec == null || c.time < toSec),
    );
  }

  if (limit != null && Number.isFinite(limit) && limit > 0 && limit < bars.length) {
    return bars.slice(-Math.floor(limit));
  }
  return bars;
}

/** Fine-grained close series (1m) the feed replays as ticks. Empty until loaded. */
export function getTickPrices(symbol: string): number[] {
  const bars = cache.get(seriesKey(symbol, "1m")) ?? [];
  return bars.map((c) => c.close).filter((price) => Number.isFinite(price) && price > 0);
}

/** Preload the 1m series the feed needs before it starts ticking. */
export async function primeTickPrices(symbols: readonly string[]): Promise<void> {
  await Promise.all(symbols.map((s) => loadSeries(s, "1m")));
}

/** Latest real close — seed price before the feed starts streaming. */
export function getSeedPrice(symbol: string): number {
  const prices = getTickPrices(symbol);
  return prices[prices.length - 1] ?? 0;
}

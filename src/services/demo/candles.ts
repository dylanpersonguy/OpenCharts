import type { Candle } from "../schemas.ts";

/**
 * Loads the bundled REAL OHLC history and serves it to the chart / feed.
 *
 * History is time-shifted at runtime so the most recent bar aligns to the
 * current period, making the demo feel "live" while every OHLC value remains
 * genuine market data (never synthetic). The demo feed (feed.ts) then streams
 * replayed real ticks forward from "now".
 */

// Eagerly bundle every data/<SYMBOL>_<tf>.json file.
const modules = import.meta.glob<{ default: Candle[] }>("./data/*.json", { eager: true });

const series = new Map<string, Candle[]>();
for (const [path, mod] of Object.entries(modules)) {
  const key = path.replace("./data/", "").replace(".json", ""); // e.g. "BTCUSD_1h"
  series.set(key, mod.default);
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

function rawSeries(symbol: string, timeframe: string): Candle[] {
  return series.get(`${symbol}_${timeframe}`) ?? [];
}

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

/** Real history for a symbol/timeframe, shifted so the last bar is the current period. */
export function getHistory(symbol: string, timeframe: string, limit?: number): Candle[] {
  const bars = rawSeries(symbol, timeframe);
  if (bars.length === 0) return [];
  const delta = shiftDelta(bars, timeframe);
  const shifted = bars.map((c) => ({ ...c, time: c.time + delta }));
  return limit && limit < shifted.length ? shifted.slice(-limit) : shifted;
}

/** Fine-grained close series (1m) used by the feed to replay real ticks. */
export function getTickPrices(symbol: string): number[] {
  const bars = rawSeries(symbol, "1m");
  return bars.map((c) => c.close);
}

/** Latest real close — seed price before the feed starts streaming. */
export function getSeedPrice(symbol: string): number {
  const prices = getTickPrices(symbol);
  return prices[prices.length - 1] ?? 0;
}

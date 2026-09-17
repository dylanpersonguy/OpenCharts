import type { Candle } from "../schemas.ts";
import { fetchBinanceKlines, symbolToBinancePair } from "./binance.ts";

/**
 * Loads the bundled REAL OHLC history and serves it to the chart / feed.
 * Dynamically fetches missing symbols from Binance on demand.
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

/** Dynamic on-demand candle fetcher for any cryptocurrency */
export async function ensureCandlesLoaded(
  symbol: string,
  timeframe: string,
  limit = 1000,
): Promise<Candle[]> {
  const existing = rawSeries(symbol, timeframe);
  if (existing.length > 0) {
    return getHistory(symbol, timeframe, limit);
  }

  const pair = symbolToBinancePair(symbol);
  try {
    const safeLimit = Math.min(Math.max(limit, 10), 1000);
    const fetched = await fetchBinanceKlines(pair, timeframe, safeLimit);
    if (fetched.length > 0) {
      series.set(`${symbol}_${timeframe}`, fetched);

      // Also ensure 1m tick series is available for tick simulator
      if (!series.has(`${symbol}_1m`)) {
        if (timeframe === "1m") {
          series.set(`${symbol}_1m`, fetched);
        } else {
          // Fetch 1m asynchronously in background without blocking chart load
          fetchBinanceKlines(pair, "1m", 1000)
            .then((m1) => {
              if (m1.length > 0) series.set(`${symbol}_1m`, m1);
            })
            .catch(() => {
              series.set(`${symbol}_1m`, fetched);
            });
        }
      }

      return getHistory(symbol, timeframe, limit);
    }
  } catch (err) {
    console.warn(`Failed to fetch on-demand candles for ${symbol} (${timeframe}):`, err);
  }
  return [];
}

/** Fine-grained close series (1m) used by the feed to replay real ticks. */
export function getTickPrices(symbol: string): number[] {
  const bars = rawSeries(symbol, "1m");
  if (bars.length > 0) {
    return bars.map((c) => c.close);
  }
  for (const [key, b] of series.entries()) {
    if (key.startsWith(`${symbol}_`) && b.length > 0) {
      return b.map((c) => c.close);
    }
  }
  return [];
}

/** Latest real close — seed price before the feed starts streaming. */
export function getSeedPrice(symbol: string): number {
  const prices = getTickPrices(symbol);
  return prices[prices.length - 1] ?? 0;
}

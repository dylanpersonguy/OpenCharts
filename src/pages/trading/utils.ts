import type { CandlestickData, Time } from "lightweight-charts";
import type { CandleData } from "../../lib/indicators.ts";
import { KNOWN_CURRENCIES } from "./constants.ts";
import type { Timeframe } from "./constants.ts";

/** Derive pip (decimal) precision from symbolInfo.tickSize or symbol name */
export function getPipDigits(
  symbolInfo?: { tickSize?: number | string },
  symbolName?: string,
): number {
  const symbolDecimals = _symbolNameDecimals(symbolName);
  if (symbolInfo?.tickSize) {
    const s = String(symbolInfo.tickSize);
    const tickDecimals = s.includes(".")
      ? s.split(".")[1]!.replace(/0+$/, "").length || s.split(".")[1]!.length
      : 0;
    // Use the higher of tick-derived or symbol-name-derived so forex pairs
    // (tickSize=0.0001) still show 5 decimal places instead of 4.
    return Math.max(tickDecimals, symbolDecimals, 2);
  }
  return symbolDecimals;
}

function _symbolNameDecimals(symbolName?: string): number {
  if (!symbolName) return 5;
  const n = symbolName.toUpperCase();
  if (n.includes("JPY") || n.includes("XAU") || n.includes("GOLD")) return 3;
  if (n.includes("BTC") || n.includes("ETH")) return 2;
  if (n.includes("US30") || n.includes("SPX") || n.includes("NAS") || n.includes("DAX")) return 2;
  return 5;
}

/** Get the minMove for lightweight-charts priceFormat from pip digits */
export function getMinMove(pipDigits: number): number {
  return Number((1 / Math.pow(10, pipDigits)).toFixed(pipDigits + 1));
}

/** Parse timestamp to unix seconds */
export function toUnixSeconds(ts: number | string | Date): number {
  if (typeof ts === "number") return ts > 1e12 ? Math.floor(ts / 1000) : ts;
  return Math.floor(new Date(ts).getTime() / 1000);
}

/** Normalise a numeric timestamp to unix milliseconds (accepts seconds or ms) */
export function toUnixMs(ts: number): number {
  return ts > 1e12 ? ts : ts * 1000;
}

/** Convert candles for indicator lib */
export function toIndicatorCandles(candles: CandlestickData<Time>[]): CandleData[] {
  return candles.map((c) => ({
    time: c.time as number,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: 0,
  }));
}

/** Format seconds remaining as M:SS or H:MM:SS */
export function formatCountdown(totalSec: number): string {
  if (totalSec <= 0) return "0:00";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Extract currency codes from a symbol name */
export function extractCurrencies(symbol: string): string[] {
  const upper = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  const found: string[] = [];
  for (const c of KNOWN_CURRENCIES) {
    if (upper.includes(c)) found.push(c);
  }
  if (found.length === 0 && upper.length >= 6) {
    found.push(upper.slice(0, 3), upper.slice(3, 6));
  }
  return [...new Set(found)];
}

/** Return the candle-bucket start (unix seconds) for a given timestamp */
export function getCandleBucketTime(timestampMs: number, tf: Timeframe): number {
  const SEC = 1000;
  const intervals: Record<Timeframe, number> = {
    "1m": 60 * SEC,
    "5m": 5 * 60 * SEC,
    "15m": 15 * 60 * SEC,
    "30m": 30 * 60 * SEC,
    "1h": 60 * 60 * SEC,
    "4h": 4 * 60 * 60 * SEC,
    "1d": 24 * 60 * 60 * SEC,
    "1w": 7 * 24 * 60 * 60 * SEC,
  };
  const ms = intervals[tf];
  return Math.floor((Math.floor(timestampMs / ms) * ms) / 1000);
}

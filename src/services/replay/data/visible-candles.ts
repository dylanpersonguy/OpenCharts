import { appendAggregate, aggregate, bucketStart, tfSeconds, type ReplayTimeframe } from "./aggregate.ts";
import type { BarSource } from "./bar-source.ts";
import type { Bar } from "./types.ts";

/** How many bars of each timeframe the chart window shows behind the cursor. */
export const LOOKBACK_BARS: Record<ReplayTimeframe, number> = {
  "15m": 2000,
  "30m": 2000,
  "1h": 2000,
  "4h": 1500,
  "1d": 1000,
  "1w": 500,
};

/** Extra lookback for markets with daily/weekend closures so the window stays full. */
const CLOSURE_FACTOR: Record<string, number> = { XAUUSD: 1.4 };

export interface CandleWindow {
  /** Bucket-aligned open time of the first bar the window may contain. */
  readonly anchor: number;
  readonly bars: readonly Bar[];
}

/** Start of the chart window for a cursor, aligned to a `tf` bucket. */
export function windowAnchor(cursorSec: number, tf: ReplayTimeframe, symbol: string): number {
  const factor = CLOSURE_FACTOR[symbol] ?? 1;
  return bucketStart(cursorSec - LOOKBACK_BARS[tf] * tfSeconds(tf) * factor, tf);
}

/**
 * Builds the chart window ending at the cursor (open time of the last revealed
 * 15m bar); the last bar is partial when the cursor is mid-bucket.
 * The caller must `await source.ensureRange(anchor - 1, cursorSec)` first.
 */
export function buildWindow(
  source: Pick<BarSource, "barsBetween"> & { readonly symbol?: string },
  tf: ReplayTimeframe,
  cursorSec: number,
): CandleWindow {
  const anchor = windowAnchor(cursorSec, tf, source.symbol ?? "");
  return { anchor, bars: aggregate(source.barsBetween(anchor - 1, cursorSec), tf) };
}

/** Advances a window with newly revealed 15m bars, sharing unchanged bars. */
export function extendWindow(window: CandleWindow, newBase: readonly Bar[], tf: ReplayTimeframe): CandleWindow {
  return { anchor: window.anchor, bars: appendAggregate(window.bars, newBase, tf) };
}

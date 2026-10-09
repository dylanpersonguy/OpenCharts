import type { Bar } from "./types.ts";

/** Timeframes available in replay; 15m is the stored base timeframe. */
export type ReplayTimeframe = "15m" | "30m" | "1h" | "4h" | "1d" | "1w";

export const REPLAY_TIMEFRAMES: readonly ReplayTimeframe[] = ["15m", "30m", "1h", "4h", "1d", "1w"];

const TF_SECONDS: Record<ReplayTimeframe, number> = {
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
};

/** Unix epoch was a Thursday; Monday 1970-01-05 00:00 UTC is 4 days later. */
const WEEK_OFFSET = 345600;

/** Length of one bar of `tf` in seconds. */
export function tfSeconds(tf: ReplayTimeframe): number {
  return TF_SECONDS[tf];
}

/** UTC open time of the `tf` bucket containing `timeSec`; weeks start Monday. */
export function bucketStart(timeSec: number, tf: ReplayTimeframe): number {
  const size = TF_SECONDS[tf];
  if (tf === "1w") return Math.floor((timeSec - WEEK_OFFSET) / size) * size + WEEK_OFFSET;
  return Math.floor(timeSec / size) * size;
}

/** Folds a later base bar into an aggregated bar of the same bucket. */
function merge(agg: Bar, next: Bar): Bar {
  return {
    time: agg.time,
    open: agg.open,
    high: Math.max(agg.high, next.high),
    low: Math.min(agg.low, next.low),
    close: next.close,
    volume: agg.volume + next.volume,
  };
}

/** Starts a new aggregated bar from a base bar. */
function open(base: Bar, tf: ReplayTimeframe): Bar {
  return { ...base, time: bucketStart(base.time, tf) };
}

/** Pushes base bars onto a (private, mutable) result array. */
function fold(out: Bar[], base: readonly Bar[], tf: ReplayTimeframe): Bar[] {
  for (const b of base) {
    const last = out[out.length - 1];
    if (last && last.time === bucketStart(b.time, tf)) {
      out[out.length - 1] = tf === "15m" ? b : merge(last, b);
    } else {
      out.push(tf === "15m" ? b : open(b, tf));
    }
  }
  return out;
}

/** Aggregates time-ordered 15m bars into `tf` bars (last bar may be partial). */
export function aggregate(base: readonly Bar[], tf: ReplayTimeframe): Bar[] {
  return fold([], base, tf);
}

/**
 * Appends newer 15m bars to an aggregated series. Returns a new array; bars
 * that did not change keep their object identity, the last bar is replaced
 * when it shares a bucket with new data. Never mutates its inputs.
 */
export function appendAggregate(prev: readonly Bar[], newBase: readonly Bar[], tf: ReplayTimeframe): Bar[] {
  return fold(prev.slice(), newBase, tf);
}

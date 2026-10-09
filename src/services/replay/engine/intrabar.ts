import type { Bar } from "./types.ts";

/** One monotonic leg of the intrabar path. */
export interface PathSegment {
  readonly from: number;
  readonly to: number;
}

/**
 * TradingView broker-emulator path: if the open is nearer the high (ties
 * included) price goes O→H→L→C, otherwise O→L→H→C.
 */
export function pricePath(bar: Bar): readonly [number, number, number, number] {
  const highFirst = bar.high - bar.open <= bar.open - bar.low;
  return highFirst
    ? [bar.open, bar.high, bar.low, bar.close]
    : [bar.open, bar.low, bar.high, bar.close];
}

/** The path as consecutive legs, dropping zero-length ones. */
export function pathSegments(bar: Bar): readonly PathSegment[] {
  const path = pricePath(bar);
  const legs: PathSegment[] = [];
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1]!;
    const to = path[i]!;
    if (from !== to) legs.push({ from, to });
  }
  return legs;
}

import { describe, it, expect } from "vitest";
import { LOOKBACK_BARS, windowAnchor, buildWindow, extendWindow } from "./visible-candles.ts";
import { aggregate, bucketStart } from "./aggregate.ts";
import type { Bar } from "./types.ts";

const MON = Date.UTC(2024, 0, 1) / 1000;

function series(start: number, count: number): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * 900,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
    volume: 1,
  }));
}

/** Minimal source over an in-memory array, matching BarSource.barsBetween semantics. */
function arraySource(bars: readonly Bar[]) {
  return {
    barsBetween: (fromExclusive: number, toInclusive: number) =>
      bars.filter((b) => b.time > fromExclusive && b.time <= toInclusive),
  };
}

describe("windowAnchor", () => {
  it("looks back LOOKBACK_BARS timeframe periods, bucket aligned", () => {
    const cursor = MON + 30 * 86400 + 900 * 7;
    expect(windowAnchor(cursor, "1h", "BTCUSD")).toBe(bucketStart(cursor - LOOKBACK_BARS["1h"] * 3600, "1h"));
    expect(windowAnchor(cursor, "1w", "BTCUSD") % 604800).toBe(345600);
  });

  it("extends further back for XAUUSD to cover market closures", () => {
    const cursor = MON + 400 * 86400;
    const btc = windowAnchor(cursor, "15m", "BTCUSD");
    const xau = windowAnchor(cursor, "15m", "XAUUSD");
    expect(xau).toBe(bucketStart(cursor - LOOKBACK_BARS["15m"] * 900 * 1.4, "15m"));
    expect(xau).toBeLessThan(btc);
  });
});

describe("buildWindow", () => {
  it("aggregates base bars up to and including the cursor with a partial last bar", () => {
    const base = series(MON, 400);
    const cursor = base[205]!.time; // 2 bars into an hour
    const win = buildWindow(arraySource(base), "1h", cursor);
    expect(win.anchor).toBe(windowAnchor(cursor, "1h", "BTCUSD"));
    const expected = aggregate(base.filter((b) => b.time <= cursor), "1h");
    expect(win.bars).toEqual(expected);
    expect(win.bars.at(-1)!.close).toBe(base[205]!.close);
  });

  it("excludes bars before the anchor", () => {
    const base = series(MON, 3000);
    const cursor = base[2999]!.time;
    const win = buildWindow(arraySource(base), "15m", cursor);
    expect(win.bars[0]!.time).toBeGreaterThanOrEqual(win.anchor);
    expect(win.bars).toHaveLength((cursor - win.anchor) / 900 + 1);
  });
});

describe("extendWindow", () => {
  it("matches a rebuilt window and keeps the anchor", () => {
    const base = series(MON, 300);
    const src = arraySource(base);
    const first = buildWindow(src, "4h", base[100]!.time);
    const extended = extendWindow(first, base.slice(101, 120), "4h");
    expect(extended.anchor).toBe(first.anchor);
    expect(extended.bars).toEqual(aggregate(base.slice(0, 120), "4h"));
    expect(extended.bars[0]).toBe(first.bars[0]);
    expect(first.bars).toEqual(aggregate(base.slice(0, 101), "4h"));
  });
});

import { describe, it, expect } from "vitest";
import { aggregate, appendAggregate, bucketStart, tfSeconds, REPLAY_TIMEFRAMES } from "./aggregate.ts";
import type { Bar } from "./types.ts";

const MON_2024_01_01 = 1704067200; // Monday 2024-01-01 00:00 UTC

function bar(time: number, open: number, high: number, low: number, close: number, volume = 1): Bar {
  return { time, open, high, low, close, volume };
}

/** Consecutive 15m bars starting at `start`; price drifts by +1 per bar. */
function series(start: number, count: number): Bar[] {
  return Array.from({ length: count }, (_, i) => bar(start + i * 900, 100 + i, 102 + i, 99 + i, 101 + i, i + 1));
}

describe("tfSeconds", () => {
  it("covers every replay timeframe", () => {
    expect(REPLAY_TIMEFRAMES).toEqual(["15m", "30m", "1h", "4h", "1d", "1w"]);
    expect(REPLAY_TIMEFRAMES.map(tfSeconds)).toEqual([900, 1800, 3600, 14400, 86400, 604800]);
  });
});

describe("bucketStart", () => {
  const t = MON_2024_01_01 + 2 * 86400 + 5 * 3600 + 47 * 60 + 13; // Wed 05:47:13

  it("floors intraday timeframes in UTC", () => {
    const day = MON_2024_01_01 + 2 * 86400;
    expect(bucketStart(t, "15m")).toBe(day + 5 * 3600 + 45 * 60);
    expect(bucketStart(t, "30m")).toBe(day + 5 * 3600 + 30 * 60);
    expect(bucketStart(t, "1h")).toBe(day + 5 * 3600);
    expect(bucketStart(t, "4h")).toBe(day + 4 * 3600);
    expect(bucketStart(t, "1d")).toBe(day);
  });

  it("aligns weeks to Monday 00:00 UTC", () => {
    expect(bucketStart(t, "1w")).toBe(MON_2024_01_01);
    expect(bucketStart(MON_2024_01_01, "1w")).toBe(MON_2024_01_01);
    expect(bucketStart(MON_2024_01_01 - 1, "1w")).toBe(MON_2024_01_01 - 7 * 86400);
    expect(new Date(bucketStart(1718000000, "1w") * 1000).getUTCDay()).toBe(1);
  });

  it("crosses year boundaries correctly", () => {
    const newYearsEve = Date.UTC(2023, 11, 31, 23, 59) / 1000; // Sunday
    expect(bucketStart(newYearsEve, "1d")).toBe(Date.UTC(2023, 11, 31) / 1000);
    expect(bucketStart(newYearsEve, "1w")).toBe(Date.UTC(2023, 11, 25) / 1000);
    expect(bucketStart(newYearsEve, "4h")).toBe(Date.UTC(2023, 11, 31, 20) / 1000);
  });
});

describe("aggregate", () => {
  it("returns a copy of 15m bars unchanged", () => {
    const base = series(MON_2024_01_01, 3);
    const out = aggregate(base, "15m");
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
  });

  it("combines OHLCV correctly", () => {
    const base = series(MON_2024_01_01, 8);
    const out = aggregate(base, "1h");
    expect(out).toEqual([
      bar(MON_2024_01_01, 100, 105, 99, 104, 1 + 2 + 3 + 4),
      bar(MON_2024_01_01 + 3600, 104, 109, 103, 108, 5 + 6 + 7 + 8),
    ]);
  });

  it("produces a partial last bar", () => {
    const out = aggregate(series(MON_2024_01_01, 6), "1h");
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual(bar(MON_2024_01_01 + 3600, 104, 107, 103, 106, 11));
  });

  it("skips weekend gaps without inventing bars", () => {
    const friday = MON_2024_01_01 + 4 * 86400 + 20 * 3600;
    const sunday = MON_2024_01_01 + 6 * 86400 + 23 * 3600;
    const base = [...series(friday, 4), ...series(sunday, 4)];
    const hourly = aggregate(base, "1h");
    expect(hourly.map((b) => b.time)).toEqual([friday, sunday]);
    const daily = aggregate(base, "1d");
    expect(daily.map((b) => b.time)).toEqual([MON_2024_01_01 + 4 * 86400, MON_2024_01_01 + 6 * 86400]);
    const weekly = aggregate(base, "1w");
    expect(weekly).toHaveLength(1);
    expect(weekly[0]!.time).toBe(MON_2024_01_01);
  });

  it("does not mutate its input", () => {
    const base = series(MON_2024_01_01, 4);
    const snapshot = JSON.stringify(base);
    aggregate(base, "1h");
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

describe("appendAggregate", () => {
  it("matches a full aggregate and shares unchanged bars", () => {
    const base = series(MON_2024_01_01, 10);
    const prev = aggregate(base.slice(0, 6), "1h");
    const next = appendAggregate(prev, base.slice(6), "1h");
    expect(next).toEqual(aggregate(base, "1h"));
    expect(next).not.toBe(prev);
    expect(next[0]).toBe(prev[0]);
    expect(next[1]).not.toBe(prev[1]);
  });

  it("replaces the last bar in the same bucket and appends new buckets", () => {
    const base = series(MON_2024_01_01, 5);
    const prev = aggregate(base.slice(0, 3), "1h");
    const sameBucket = appendAggregate(prev, [base[3]!], "1h");
    expect(sameBucket).toHaveLength(1);
    expect(sameBucket[0]).toEqual(bar(MON_2024_01_01, 100, 105, 99, 104, 10));
    const newBucket = appendAggregate(sameBucket, [base[4]!], "1h");
    expect(newBucket).toHaveLength(2);
    expect(newBucket[0]).toBe(sameBucket[0]);
  });

  it("never mutates prev or newBase", () => {
    const base = series(MON_2024_01_01, 6);
    const prev = Object.freeze(aggregate(base.slice(0, 2), "1h").map((b) => Object.freeze({ ...b })));
    const added = Object.freeze(base.slice(2));
    const snapshot = JSON.stringify(prev);
    expect(() => appendAggregate(prev, added, "1h")).not.toThrow();
    expect(JSON.stringify(prev)).toBe(snapshot);
    expect(prev).toHaveLength(1);
  });

  it("handles empty inputs", () => {
    const base = series(MON_2024_01_01, 2);
    expect(appendAggregate([], base, "1h")).toEqual(aggregate(base, "1h"));
    const prev = aggregate(base, "1h");
    const same = appendAggregate(prev, [], "1h");
    expect(same).toEqual(prev);
    expect(same).not.toBe(prev);
  });

  it("works at the base timeframe", () => {
    const base = series(MON_2024_01_01, 3);
    const out = appendAggregate(base.slice(0, 2), [base[2]!], "15m");
    expect(out).toEqual(base);
  });
});

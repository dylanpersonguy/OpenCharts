import { describe, expect, it } from "vitest";
import {
  atr,
  bollingerBands,
  ema,
  macd,
  rsi,
  sma,
  stochastic,
  vwap,
  type CandleData,
} from "@/lib/indicators";

/** Candles from a list of closes; high/low straddle the close by 1. */
function closes(values: number[]): CandleData[] {
  return values.map((close, i) => ({
    time: 1000 + i * 60,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 10,
  }));
}

const INVALID_PERIODS = [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY];

describe("sma", () => {
  it("averages a rolling window", () => {
    const out = sma(closes([1, 2, 3, 4, 5]), 3);
    expect(out.map((p) => p.value)).toEqual([2, 3, 4]);
  });

  it("stamps each point with the closing bar's time", () => {
    const candles = closes([1, 2, 3]);
    expect(sma(candles, 3)[0]?.time).toBe(candles[2]!.time);
  });

  it("returns nothing when there is not enough history", () => {
    expect(sma(closes([1, 2]), 5)).toEqual([]);
  });

  it.each(INVALID_PERIODS)("returns nothing for period %p instead of throwing", (period) => {
    expect(() => sma(closes([1, 2, 3]), period)).not.toThrow();
    expect(sma(closes([1, 2, 3]), period)).toEqual([]);
  });
});

describe("ema", () => {
  it("seeds from the SMA then applies the multiplier", () => {
    const out = ema(closes([1, 2, 3, 4]), 3);
    expect(out[0]?.value).toBe(2); // SMA seed of 1,2,3
    // k = 2/(3+1) = 0.5 → 4*0.5 + 2*0.5 = 3
    expect(out[1]?.value).toBe(3);
  });

  it.each(INVALID_PERIODS)("returns nothing for period %p", (period) => {
    expect(ema(closes([1, 2, 3]), period)).toEqual([]);
  });
});

describe("rsi", () => {
  it("is 100 when every bar gains", () => {
    const out = rsi(closes([1, 2, 3, 4, 5, 6]), 3);
    expect(out[0]?.value).toBe(100);
  });

  it("is 0 when every bar loses", () => {
    const out = rsi(closes([6, 5, 4, 3, 2, 1]), 3);
    expect(out[0]?.value).toBe(0);
  });

  it("is neutral, not overbought, on a flat series", () => {
    const out = rsi(closes([5, 5, 5, 5, 5, 5]), 3);
    expect(out[0]?.value).toBe(50);
  });

  it("stays within 0..100", () => {
    const out = rsi(closes([10, 12, 11, 15, 9, 14, 13, 18, 7, 20]), 4);
    for (const point of out) {
      expect(point.value).toBeGreaterThanOrEqual(0);
      expect(point.value).toBeLessThanOrEqual(100);
    }
  });

  it.each(INVALID_PERIODS)("returns nothing for period %p", (period) => {
    expect(rsi(closes([1, 2, 3, 4]), period)).toEqual([]);
  });
});

describe("macd", () => {
  it("lines up the histogram with macd minus signal", () => {
    const series = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const { macd: line, signal, histogram } = macd(closes(series), 12, 26, 9);

    expect(line.length).toBeGreaterThan(0);
    expect(signal.length).toBeGreaterThan(0);
    expect(histogram).toHaveLength(signal.length);

    const byTime = new Map(line.map((p) => [p.time, p.value]));
    for (const h of histogram) {
      const s = signal.find((p) => p.time === h.time)!;
      expect(h.value).toBeCloseTo(byTime.get(h.time)! - s.value, 10);
    }
  });

  it("returns empty series for an invalid period", () => {
    expect(macd(closes([1, 2, 3]), 0, 26, 9)).toEqual({ macd: [], signal: [], histogram: [] });
  });
});

describe("bollingerBands", () => {
  it("collapses the bands when price is flat", () => {
    const { upper, middle, lower } = bollingerBands(closes([5, 5, 5, 5, 5]), 3);
    expect(middle[0]?.value).toBe(5);
    expect(upper[0]?.value).toBe(5);
    expect(lower[0]?.value).toBe(5);
  });

  it("places the bands symmetrically around the mean", () => {
    const { upper, middle, lower } = bollingerBands(closes([1, 2, 3, 4, 5]), 3);
    for (let i = 0; i < middle.length; i += 1) {
      const spread = upper[i]!.value - middle[i]!.value;
      expect(middle[i]!.value - lower[i]!.value).toBeCloseTo(spread, 10);
    }
  });

  it.each(INVALID_PERIODS)("returns empty bands for period %p", (period) => {
    expect(bollingerBands(closes([1, 2, 3]), period)).toEqual({
      upper: [],
      middle: [],
      lower: [],
    });
  });
});

describe("atr", () => {
  it("measures the true range of a steady series", () => {
    // Each bar spans close±1 → true range 2 once the gap is included.
    const out = atr(closes([10, 10, 10, 10, 10]), 3);
    expect(out[0]?.value).toBeCloseTo(2, 10);
  });

  it("is never negative", () => {
    const out = atr(closes([10, 14, 9, 17, 6, 12, 11]), 3);
    for (const point of out) expect(point.value).toBeGreaterThanOrEqual(0);
  });

  it.each(INVALID_PERIODS)("returns nothing for period %p", (period) => {
    expect(atr(closes([1, 2, 3, 4]), period)).toEqual([]);
  });
});

describe("stochastic", () => {
  it("reads 100 when the close sits at the window high", () => {
    const candles = closes([1, 2, 3]);
    const last = candles[2]!;
    last.high = last.close; // close == highest high
    const { k } = stochastic(candles, 3, 2);
    expect(k[k.length - 1]?.value).toBeCloseTo(100, 6);
  });

  it("is neutral when the window has no range", () => {
    const flat: CandleData[] = [0, 1, 2].map((i) => ({
      time: 1000 + i,
      open: 5,
      high: 5,
      low: 5,
      close: 5,
      volume: 1,
    }));
    const { k } = stochastic(flat, 3, 2);
    expect(k[0]?.value).toBe(50);
  });

  it.each(INVALID_PERIODS)("returns empty lines for period %p", (period) => {
    expect(stochastic(closes([1, 2, 3, 4]), period)).toEqual({ k: [], d: [] });
  });
});

describe("vwap", () => {
  it("weights by volume", () => {
    const candles: CandleData[] = [
      { time: 1, open: 10, high: 10, low: 10, close: 10, volume: 1 },
      { time: 2, open: 20, high: 20, low: 20, close: 20, volume: 3 },
    ];
    // (10*1 + 20*3) / 4 = 17.5
    expect(vwap(candles)[1]?.value).toBeCloseTo(17.5, 10);
  });

  it("falls back to the typical price before any volume trades", () => {
    const candles: CandleData[] = [
      { time: 1, open: 9, high: 12, low: 6, close: 9, volume: 0 },
    ];
    const [point] = vwap(candles);
    expect(point?.value).toBeCloseTo(9, 10);
    expect(Number.isNaN(point!.value)).toBe(false);
  });

  it("never produces NaN for a zero-volume series", () => {
    const candles = closes([1, 2, 3]).map((c) => ({ ...c, volume: 0 }));
    for (const point of vwap(candles)) {
      expect(Number.isFinite(point.value)).toBe(true);
    }
  });
});

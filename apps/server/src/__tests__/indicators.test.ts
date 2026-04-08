import { describe, it, expect } from 'vitest';
import { computeIndicator } from '../services/indicators';
import type { OHLCV } from '@opencharts/common';

function makeBars(count: number, startPrice: number = 100): OHLCV[] {
  const bars: OHLCV[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const change = (Math.sin(i * 0.3) + 0.1) * 2;
    price += change;
    bars.push({
      time: 1000 + i * 60,
      open: price - 1,
      high: price + 2,
      low: price - 2,
      close: price,
      volume: 100 + i * 10,
    });
  }
  return bars;
}

describe('Indicators', () => {
  const bars = makeBars(50);

  describe('SMA', () => {
    it('computes SMA with correct period', () => {
      const result = computeIndicator('SMA', bars, { period: 5 });
      expect(result.sma).toHaveLength(50);
      // First 4 values should be null
      expect(result.sma[0]).toBeNull();
      expect(result.sma[3]).toBeNull();
      // 5th value should be the average of first 5 closes
      const expected = (bars[0].close + bars[1].close + bars[2].close + bars[3].close + bars[4].close) / 5;
      expect(result.sma[4]).toBeCloseTo(expected, 5);
    });
  });

  describe('EMA', () => {
    it('computes EMA with correct period', () => {
      const result = computeIndicator('EMA', bars, { period: 10 });
      expect(result.ema).toHaveLength(50);
      expect(result.ema[8]).toBeNull();
      expect(result.ema[9]).not.toBeNull();
    });
  });

  describe('RSI', () => {
    it('computes RSI in 0-100 range', () => {
      const result = computeIndicator('RSI', bars, { period: 14 });
      expect(result.rsi).toHaveLength(50);
      const validValues = result.rsi.filter((v): v is number => v !== null);
      validValues.forEach((v) => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('MACD', () => {
    it('returns macd, signal, and histogram series', () => {
      const result = computeIndicator('MACD', bars, { fast: 12, slow: 26, signal: 9 });
      expect(result.macd).toHaveLength(50);
      expect(result.signal).toHaveLength(50);
      expect(result.histogram).toHaveLength(50);
    });
  });

  describe('BBANDS', () => {
    it('returns upper, middle, lower bands', () => {
      const result = computeIndicator('BBANDS', bars, { period: 20, stddev: 2 });
      expect(result.upper).toHaveLength(50);
      expect(result.middle).toHaveLength(50);
      expect(result.lower).toHaveLength(50);
      // Upper should be above middle, lower below
      for (let i = 19; i < 50; i++) {
        expect(result.upper[i]!).toBeGreaterThan(result.middle[i]!);
        expect(result.lower[i]!).toBeLessThan(result.middle[i]!);
      }
    });
  });

  describe('VWAP', () => {
    it('computes VWAP', () => {
      const result = computeIndicator('VWAP', bars);
      expect(result.vwap).toHaveLength(50);
      expect(result.vwap[0]).not.toBeNull();
    });
  });
});

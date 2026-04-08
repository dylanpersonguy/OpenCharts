import { describe, it, expect, beforeEach } from 'vitest';
import { CandleAggregator, AggregatorManager } from '../services/candle-aggregator';
import type { MarketEvent } from '@opencharts/common';

function makeEvent(price: number, volume: number, timestampMs: number): MarketEvent {
  return {
    type: 'trade',
    symbol: 'BTC/USD',
    timestamp: timestampMs,
    price,
    volume,
    provider: 'test',
  };
}

describe('CandleAggregator', () => {
  let agg: CandleAggregator;

  beforeEach(() => {
    agg = new CandleAggregator('BTC/USD', '1m');
  });

  it('creates a new bar on first event', () => {
    const update = agg.process(makeEvent(100, 10, 60_000));
    expect(update.bar.open).toBe(100);
    expect(update.bar.high).toBe(100);
    expect(update.bar.low).toBe(100);
    expect(update.bar.close).toBe(100);
    expect(update.bar.volume).toBe(10);
    expect(update.isClosed).toBe(false);
  });

  it('updates OHLCV within the same candle', () => {
    agg.process(makeEvent(100, 10, 60_000));
    const update = agg.process(makeEvent(105, 5, 65_000));
    expect(update.bar.open).toBe(100);
    expect(update.bar.high).toBe(105);
    expect(update.bar.close).toBe(105);
    expect(update.bar.volume).toBe(15);
    expect(update.isClosed).toBe(false);
  });

  it('tracks low price correctly', () => {
    agg.process(makeEvent(100, 10, 60_000));
    agg.process(makeEvent(105, 5, 65_000));
    const update = agg.process(makeEvent(95, 3, 70_000));
    expect(update.bar.low).toBe(95);
    expect(update.bar.high).toBe(105);
  });

  it('starts a new candle when time crosses interval boundary', () => {
    agg.process(makeEvent(100, 10, 60_000));    // minute 1
    agg.process(makeEvent(105, 5, 90_000));     // still minute 1
    const update = agg.process(makeEvent(110, 7, 120_000)); // minute 2

    expect(update.isClosed).toBe(true);
    expect(update.bar.open).toBe(110);
    expect(update.bar.volume).toBe(7);
  });

  it('correctly aligns bucket timestamps to interval boundaries', () => {
    // Event at 90_000ms should round down to 60_000ms (minute 1)
    const update = agg.process(makeEvent(100, 10, 90_000));
    expect(update.bar.time).toBe(60); // 60_000ms / 1000 = 60 unix seconds
  });

  it('reset clears state', () => {
    agg.process(makeEvent(100, 10, 60_000));
    agg.reset();
    expect(agg.getCurrentBar()).toBeNull();
  });

  it('getCurrentBar returns a copy', () => {
    agg.process(makeEvent(100, 10, 60_000));
    const bar1 = agg.getCurrentBar();
    const bar2 = agg.getCurrentBar();
    expect(bar1).toEqual(bar2);
    expect(bar1).not.toBe(bar2); // different references
  });
});

describe('CandleAggregator 5-second resolution', () => {
  it('buckets events into 5-second candles', () => {
    const agg = new CandleAggregator('ETH/USD', '5s');
    agg.process(makeEvent(3000, 1, 5_000));  // bucket: 5s
    agg.process(makeEvent(3010, 2, 7_000));  // still 5s bucket
    const update = agg.process(makeEvent(3020, 3, 10_000)); // new bucket: 10s
    expect(update.isClosed).toBe(true);
    expect(update.bar.open).toBe(3020);
    expect(update.bar.time).toBe(10); // 10_000ms / 1000
  });
});

describe('AggregatorManager', () => {
  let manager: AggregatorManager;

  beforeEach(() => {
    manager = new AggregatorManager();
  });

  it('processes events across multiple resolutions', () => {
    const event = makeEvent(100, 10, 60_000);
    const updates = manager.processEvent(event, ['1m', '5m']);
    expect(updates).toHaveLength(2);
    expect(updates[0].resolution).toBe('1m');
    expect(updates[1].resolution).toBe('5m');
  });

  it('reuses the same aggregator for the same symbol+resolution', () => {
    const event1 = makeEvent(100, 10, 60_000);
    const event2 = makeEvent(105, 5, 65_000);
    manager.processEvent(event1, ['1m']);
    const updates = manager.processEvent(event2, ['1m']);
    expect(updates[0].bar.open).toBe(100); // same aggregator
    expect(updates[0].bar.close).toBe(105);
  });

  it('clear removes all aggregators', () => {
    manager.processEvent(makeEvent(100, 10, 60_000), ['1m']);
    manager.clear();
    // After clear, a new event starts fresh
    const updates = manager.processEvent(makeEvent(200, 5, 120_000), ['1m']);
    expect(updates[0].bar.open).toBe(200);
    expect(updates[0].isClosed).toBe(false);
  });
});

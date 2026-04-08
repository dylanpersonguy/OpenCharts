import type { MarketEvent, OHLCV, Resolution, PartialBarUpdate } from '@opencharts/common';
import { RESOLUTION_MS } from '@opencharts/common';

/**
 * CandleAggregator: accumulates raw market events into OHLCV candles
 * for a specific symbol + resolution pair.
 *
 * Thread-safe within a single Node process (single-threaded).
 * For horizontal scaling, partition by symbol.
 */
export class CandleAggregator {
  private currentBar: OHLCV | null = null;
  private currentBucketStart: number = 0;

  constructor(
    public readonly symbol: string,
    public readonly resolution: Resolution,
  ) {}

  private get intervalMs(): number {
    return RESOLUTION_MS[this.resolution];
  }

  /** Compute the bucket start timestamp (unix seconds) for a given event timestamp (unix ms) */
  private bucketStart(timestampMs: number): number {
    const intervalMs = this.intervalMs;
    const bucketMs = Math.floor(timestampMs / intervalMs) * intervalMs;
    return Math.floor(bucketMs / 1000);
  }

  /**
   * Process a market event. Returns a PartialBarUpdate indicating the
   * current state of the bar, and whether the previous bar just closed.
   */
  process(event: MarketEvent): PartialBarUpdate {
    const bucketStart = this.bucketStart(event.timestamp);
    let isClosed = false;

    if (this.currentBar === null || bucketStart > this.currentBucketStart) {
      // New candle period — the previous bar (if any) is now closed
      if (this.currentBar !== null) {
        isClosed = true;
      }
      this.currentBar = {
        time: bucketStart,
        open: event.price,
        high: event.price,
        low: event.price,
        close: event.price,
        volume: event.volume,
      };
      this.currentBucketStart = bucketStart;
    } else {
      // Same candle period — update OHLCV
      this.currentBar.high = Math.max(this.currentBar.high, event.price);
      this.currentBar.low = Math.min(this.currentBar.low, event.price);
      this.currentBar.close = event.price;
      this.currentBar.volume += event.volume;
    }

    return {
      symbol: this.symbol,
      resolution: this.resolution,
      bar: { ...this.currentBar },
      isClosed,
    };
  }

  /** Get the current in-progress bar */
  getCurrentBar(): OHLCV | null {
    return this.currentBar ? { ...this.currentBar } : null;
  }

  /** Reset the aggregator state */
  reset(): void {
    this.currentBar = null;
    this.currentBucketStart = 0;
  }
}

/**
 * Manages aggregators for multiple symbol/resolution combinations.
 */
export class AggregatorManager {
  private aggregators = new Map<string, CandleAggregator>();

  private key(symbol: string, resolution: Resolution): string {
    return `${symbol}:${resolution}`;
  }

  getOrCreate(symbol: string, resolution: Resolution): CandleAggregator {
    const k = this.key(symbol, resolution);
    let agg = this.aggregators.get(k);
    if (!agg) {
      agg = new CandleAggregator(symbol, resolution);
      this.aggregators.set(k, agg);
    }
    return agg;
  }

  /**
   * Process a market event through all relevant resolution aggregators.
   * Returns updates for each resolution.
   */
  processEvent(event: MarketEvent, resolutions: Resolution[]): PartialBarUpdate[] {
    return resolutions.map((res) => {
      const agg = this.getOrCreate(event.symbol, res);
      return agg.process(event);
    });
  }

  remove(symbol: string, resolution: Resolution): void {
    this.aggregators.delete(this.key(symbol, resolution));
  }

  clear(): void {
    this.aggregators.clear();
  }
}

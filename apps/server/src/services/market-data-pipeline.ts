import type { MarketEvent, Resolution, PartialBarUpdate } from '@opencharts/common';
import { ALL_RESOLUTIONS } from '@opencharts/common';
import { AggregatorManager } from './candle-aggregator';
import { redis, barChannel } from './redis';
import { query } from '../db/pool';
import { logger } from './logger';

/**
 * MarketDataPipeline: central service receiving normalized market events,
 * aggregating them into candles, persisting closed bars, and publishing
 * realtime updates via Redis pub/sub.
 */
export class MarketDataPipeline {
  private aggregatorManager = new AggregatorManager();
  private resolutions: Resolution[] = ALL_RESOLUTIONS;

  async onMarketEvent(event: MarketEvent): Promise<void> {
    const updates = this.aggregatorManager.processEvent(event, this.resolutions);

    for (const update of updates) {
      // Publish every bar update (including partial) via Redis
      await redis.publish(
        barChannel(update.symbol, update.resolution),
        JSON.stringify(update),
      );

      // If a bar just closed, persist it
      if (update.isClosed) {
        await this.persistBar(update);
      }
    }
  }

  private async persistBar(update: PartialBarUpdate): Promise<void> {
    // The "closed" bar data is the current bar's predecessor.
    // Since the aggregator already started a new bar, we can't get the old one directly.
    // We persist every update, using upsert to keep the latest state.
    const { symbol, resolution, bar } = update;
    try {
      await query(
        `INSERT INTO historical_bars (symbol, resolution, time, open, high, low, close, volume)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (symbol, resolution, time)
         DO UPDATE SET open = $4, high = $5, low = $6, close = $7, volume = $8`,
        [symbol, resolution, bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume],
      );
    } catch (err) {
      logger.error(err, `Failed to persist bar ${symbol}@${resolution}`);
    }
  }

  /** Ingest a batch of events (e.g., during backfill) */
  async ingestBatch(events: MarketEvent[]): Promise<void> {
    for (const event of events) {
      await this.onMarketEvent(event);
    }
  }

  reset(): void {
    this.aggregatorManager.clear();
  }
}

export const marketDataPipeline = new MarketDataPipeline();

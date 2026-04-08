import { Router, Request, Response } from 'express';
import { eq, and, gte, lte, asc, desc, sql } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { historicalBars } from '../db/schema';
import { logger } from '../services/logger';
import { MAX_BARS_PER_REQUEST, DEFAULT_BARS_COUNT } from '@opencharts/common';
import { RESOLUTION_MS } from '@opencharts/common';
import { computeIndicator } from '../services/indicators';
import type { OHLCV, IndicatorType, Resolution } from '@opencharts/common';

const router = Router();

function toBar(r: typeof historicalBars.$inferSelect): OHLCV {
  return {
    time: Number(r.time),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  };
}

/** Resolutions ordered from finest to coarsest */
const RES_ORDER: Resolution[] = ['1s', '5s', '15s', '1m', '5m', '15m', '1h', '4h', '1d', '1w'];

/** Find the best source resolution for aggregation — picks the one that yields the most bars */
async function findSourceResolution(symbol: string, target: Resolution): Promise<Resolution | null> {
  const targetIdx = RES_ORDER.indexOf(target);
  let bestRes: Resolution | null = null;
  let bestCount = 0;

  for (let i = 0; i < targetIdx; i++) {
    const res = RES_ORDER[i];
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(historicalBars)
      .where(and(eq(historicalBars.symbol, symbol), eq(historicalBars.resolution, res)));
    const count = row?.count ?? 0;
    if (count > bestCount) {
      bestCount = count;
      bestRes = res;
    }
  }
  return bestRes;
}

/** Aggregate fine-grained bars into target resolution */
function aggregateBars(sourceBars: OHLCV[], targetResMs: number): OHLCV[] {
  if (sourceBars.length === 0) return [];

  const targetResSec = targetResMs / 1000;
  const buckets = new Map<number, OHLCV>();

  for (const bar of sourceBars) {
    const bucketTime = Math.floor(bar.time / targetResSec) * targetResSec;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, { ...bar, time: bucketTime });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += bar.volume;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

async function fetchBars(
  symbol: string,
  resolution: string,
  limit: number,
  from?: number,
  to?: number,
): Promise<OHLCV[]> {
  let rows: (typeof historicalBars.$inferSelect)[];

  if (from && to) {
    rows = await db.select().from(historicalBars)
      .where(and(
        eq(historicalBars.symbol, symbol),
        eq(historicalBars.resolution, resolution),
        gte(historicalBars.time, from),
        lte(historicalBars.time, to),
      ))
      .orderBy(asc(historicalBars.time))
      .limit(limit);
  } else if (from) {
    rows = await db.select().from(historicalBars)
      .where(and(
        eq(historicalBars.symbol, symbol),
        eq(historicalBars.resolution, resolution),
        gte(historicalBars.time, from),
      ))
      .orderBy(asc(historicalBars.time))
      .limit(limit);
  } else {
    const descRows = await db.select().from(historicalBars)
      .where(and(
        eq(historicalBars.symbol, symbol),
        eq(historicalBars.resolution, resolution),
      ))
      .orderBy(desc(historicalBars.time))
      .limit(limit);
    rows = descRows.reverse();
  }

  return rows.map(toBar);
}

router.get('/:symbol/:resolution', async (req: Request, res: Response) => {
  const { symbol, resolution } = req.params;
  const from = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
  const to = req.query.to ? parseInt(req.query.to as string, 10) : undefined;
  const limit = Math.min(
    parseInt(req.query.limit as string, 10) || DEFAULT_BARS_COUNT,
    MAX_BARS_PER_REQUEST,
  );

  try {
    // First try direct match
    let bars = await fetchBars(symbol, resolution, limit, from, to);

    // If too few bars, try aggregating from a finer resolution
    if (bars.length < limit && resolution in RESOLUTION_MS) {
      const sourceRes = await findSourceResolution(symbol, resolution as Resolution);
      if (sourceRes && sourceRes !== resolution) {
        const targetMs = RESOLUTION_MS[resolution as Resolution];
        const sourceMultiplier = Math.ceil(targetMs / RESOLUTION_MS[sourceRes]);
        const sourceLimit = limit * sourceMultiplier;
        const sourceBars = await fetchBars(symbol, sourceRes, sourceLimit, from, to);
        const aggregated = aggregateBars(sourceBars, targetMs);
        // Only use aggregated if it gives us more bars
        if (aggregated.length > bars.length) {
          bars = aggregated;
        }
        if (bars.length > limit) {
          bars = bars.slice(bars.length - limit);
        }
      }
    }

    res.json({
      symbol,
      resolution,
      bars,
      count: bars.length,
    });
  } catch (err) {
    logger.error(err, 'Get bars error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Compute indicators on historical data */
router.post('/:symbol/:resolution/indicators', async (req: Request, res: Response) => {
  const { symbol, resolution } = req.params;
  const { indicators } = req.body as {
    indicators: { type: IndicatorType; params?: Record<string, number> }[];
  };

  if (!indicators?.length) {
    res.status(400).json({ error: 'indicators array required' });
    return;
  }

  try {
    let bars = await fetchBars(symbol, resolution, 500);

    // Aggregate from finer resolution if needed
    if (bars.length < 500 && resolution in RESOLUTION_MS) {
      const sourceRes = await findSourceResolution(symbol, resolution as Resolution);
      if (sourceRes && sourceRes !== resolution) {
        const targetMs = RESOLUTION_MS[resolution as Resolution];
        const sourceMultiplier = Math.ceil(targetMs / RESOLUTION_MS[sourceRes]);
        const sourceBars = await fetchBars(symbol, sourceRes, 500 * sourceMultiplier);
        bars = aggregateBars(sourceBars, targetMs);
        if (bars.length > 500) bars = bars.slice(bars.length - 500);
      }
    }

    const results = indicators.map((ind) => ({
      type: ind.type,
      series: computeIndicator(ind.type, bars, ind.params ?? {}),
    }));

    res.json({ indicators: results });
  } catch (err) {
    logger.error(err, 'Compute indicators error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { chartSnapshots } from '../db/schema';
import { logger } from '../services/logger';

const router = Router();

function generateShareCode(): string {
  return crypto.randomBytes(6).toString('base64url').slice(0, 8);
}

/** POST /api/snapshots — create a snapshot */
router.post('/', async (req: Request, res: Response) => {
  const { symbol, resolution, chartType, indicators, title, imageData, chartState } = req.body;

  if (!symbol || !resolution || !chartType) {
    res.status(400).json({ error: 'symbol, resolution, and chartType are required' });
    return;
  }

  const shareCode = generateShareCode();

  try {
    const [row] = await db.insert(chartSnapshots).values({
      shareCode,
      symbol,
      resolution,
      chartType,
      indicators: indicators ?? [],
      title: title ?? null,
      imageData: imageData ?? null,
      chartState: chartState ?? null,
    }).returning();

    res.status(201).json({
      id: row.id,
      shareCode: row.shareCode,
      url: `/s/${row.shareCode}`,
    });
  } catch (err) {
    logger.error({ err }, '[Snapshots] Create failed');
    res.status(500).json({ error: 'Failed to create snapshot' });
  }
});

/** GET /api/snapshots/:code — get a snapshot by share code */
router.get('/:code', async (req: Request, res: Response) => {
  const { code } = req.params;

  try {
    const rows = await db
      .select()
      .from(chartSnapshots)
      .where(eq(chartSnapshots.shareCode, code))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: 'Snapshot not found' });
      return;
    }

    const snap = rows[0];
    res.json({
      id: snap.id,
      shareCode: snap.shareCode,
      symbol: snap.symbol,
      resolution: snap.resolution,
      chartType: snap.chartType,
      indicators: snap.indicators,
      title: snap.title,
      imageData: snap.imageData,
      chartState: snap.chartState,
      createdAt: snap.createdAt,
    });
  } catch (err) {
    logger.error({ err }, '[Snapshots] Get failed');
    res.status(500).json({ error: 'Failed to get snapshot' });
  }
});

export default router;

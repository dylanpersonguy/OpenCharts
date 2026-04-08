import { Router, Response } from 'express';
import { eq, and, desc, asc } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { layouts, layoutDrawings } from '../db/schema';
import { logger } from '../services/logger';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select({
      id: layouts.id,
      name: layouts.name,
      symbol: layouts.symbol,
      resolution: layouts.resolution,
      chartType: layouts.chartType,
      indicators: layouts.indicators,
      createdAt: layouts.createdAt,
      updatedAt: layouts.updatedAt,
    }).from(layouts)
      .where(eq(layouts.userId, req.userId!))
      .orderBy(desc(layouts.updatedAt));
    res.json(rows);
  } catch (err) {
    logger.error(err, 'List layouts error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const [layout] = await db.select({
      id: layouts.id,
      name: layouts.name,
      symbol: layouts.symbol,
      resolution: layouts.resolution,
      chartType: layouts.chartType,
      indicators: layouts.indicators,
      createdAt: layouts.createdAt,
      updatedAt: layouts.updatedAt,
    }).from(layouts)
      .where(and(eq(layouts.id, req.params.id), eq(layouts.userId, req.userId!)))
      .limit(1);

    if (!layout) {
      res.status(404).json({ error: 'Layout not found' });
      return;
    }

    const drawings = await db.select({
      id: layoutDrawings.id,
      type: layoutDrawings.type,
      points: layoutDrawings.points,
      style: layoutDrawings.style,
      text: layoutDrawings.text,
      createdAt: layoutDrawings.createdAt,
      updatedAt: layoutDrawings.updatedAt,
    }).from(layoutDrawings)
      .where(eq(layoutDrawings.layoutId, req.params.id))
      .orderBy(asc(layoutDrawings.createdAt));

    res.json({ ...layout, drawings });
  } catch (err) {
    logger.error(err, 'Get layout error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const { name, symbol, resolution, chartType, indicators } = req.body;
  if (!name || !symbol) {
    res.status(400).json({ error: 'name and symbol are required' });
    return;
  }

  try {
    const [result] = await db.insert(layouts)
      .values({
        userId: req.userId!,
        name,
        symbol,
        resolution: resolution || '1m',
        chartType: chartType || 'candlestick',
        indicators: indicators || [],
      })
      .returning({ id: layouts.id });
    res.status(201).json({ id: result.id });
  } catch (err) {
    logger.error(err, 'Create layout error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  const { name, symbol, resolution, chartType, indicators } = req.body;
  try {
    const [existing] = await db.select({ id: layouts.id })
      .from(layouts)
      .where(and(eq(layouts.id, req.params.id), eq(layouts.userId, req.userId!)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: 'Layout not found' });
      return;
    }

    const updates: Partial<typeof layouts.$inferInsert> = { updatedAt: new Date() };
    if (name) updates.name = name;
    if (symbol) updates.symbol = symbol;
    if (resolution) updates.resolution = resolution;
    if (chartType) updates.chartType = chartType;
    if (indicators) updates.indicators = indicators;

    await db.update(layouts).set(updates).where(eq(layouts.id, req.params.id));

    res.json({ success: true });
  } catch (err) {
    logger.error(err, 'Update layout error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await db.delete(layouts)
      .where(and(eq(layouts.id, req.params.id), eq(layouts.userId, req.userId!)))
      .returning({ id: layouts.id });
    if (!deleted.length) {
      res.status(404).json({ error: 'Layout not found' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    logger.error(err, 'Delete layout error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

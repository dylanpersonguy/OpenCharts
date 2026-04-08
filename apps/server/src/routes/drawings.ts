import { Router, Response } from 'express';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { layouts, layoutDrawings } from '../db/schema';
import { logger } from '../services/logger';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

router.get('/layout/:layoutId', async (req: AuthRequest, res: Response) => {
  try {
    const [layout] = await db.select({ id: layouts.id })
      .from(layouts)
      .where(and(eq(layouts.id, req.params.layoutId), eq(layouts.userId, req.userId!)))
      .limit(1);
    if (!layout) {
      res.status(404).json({ error: 'Layout not found' });
      return;
    }

    const rows = await db.select({
      id: layoutDrawings.id,
      type: layoutDrawings.type,
      points: layoutDrawings.points,
      style: layoutDrawings.style,
      text: layoutDrawings.text,
      createdAt: layoutDrawings.createdAt,
      updatedAt: layoutDrawings.updatedAt,
    }).from(layoutDrawings)
      .where(eq(layoutDrawings.layoutId, req.params.layoutId))
      .orderBy(asc(layoutDrawings.createdAt));
    res.json(rows);
  } catch (err) {
    logger.error(err, 'List drawings error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const { layoutId, type, points, style, text } = req.body;
  if (!layoutId || !type || !points) {
    res.status(400).json({ error: 'layoutId, type, and points are required' });
    return;
  }

  try {
    const [layout] = await db.select({ id: layouts.id })
      .from(layouts)
      .where(and(eq(layouts.id, layoutId), eq(layouts.userId, req.userId!)))
      .limit(1);
    if (!layout) {
      res.status(404).json({ error: 'Layout not found' });
      return;
    }

    const [result] = await db.insert(layoutDrawings)
      .values({
        layoutId,
        type,
        points,
        style: style || {},
        text: text || null,
      })
      .returning({ id: layoutDrawings.id });
    res.status(201).json({ id: result.id });
  } catch (err) {
    logger.error(err, 'Create drawing error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  const { points, style, text } = req.body;
  try {
    // Verify ownership via layout join
    const [drawing] = await db.select({ layoutId: layoutDrawings.layoutId })
      .from(layoutDrawings)
      .innerJoin(layouts, eq(layouts.id, layoutDrawings.layoutId))
      .where(and(eq(layoutDrawings.id, req.params.id), eq(layouts.userId, req.userId!)))
      .limit(1);
    if (!drawing) {
      res.status(404).json({ error: 'Drawing not found' });
      return;
    }

    const updates: Partial<typeof layoutDrawings.$inferInsert> = { updatedAt: new Date() };
    if (points) updates.points = points;
    if (style) updates.style = style;
    if (text !== undefined) updates.text = text;

    await db.update(layoutDrawings).set(updates).where(eq(layoutDrawings.id, req.params.id));

    res.json({ success: true });
  } catch (err) {
    logger.error(err, 'Update drawing error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    // Verify ownership first, then delete
    const [drawing] = await db.select({ id: layoutDrawings.id })
      .from(layoutDrawings)
      .innerJoin(layouts, eq(layouts.id, layoutDrawings.layoutId))
      .where(and(eq(layoutDrawings.id, req.params.id), eq(layouts.userId, req.userId!)))
      .limit(1);
    if (!drawing) {
      res.status(404).json({ error: 'Drawing not found' });
      return;
    }

    await db.delete(layoutDrawings).where(eq(layoutDrawings.id, req.params.id));
    res.json({ success: true });
  } catch (err) {
    logger.error(err, 'Delete drawing error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

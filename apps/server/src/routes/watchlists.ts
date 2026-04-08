import { Router, Response } from 'express';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { watchlists, watchlistItems } from '../db/schema';
import { query } from '../db/pool';
import { logger } from '../services/logger';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    // Keep raw SQL for json_agg with FILTER — not expressible in Drizzle
    const result = await query(
      `SELECT w.id, w.name, w.created_at, w.updated_at,
              COALESCE(json_agg(
                json_build_object('id', wi.id, 'symbol', wi.symbol, 'sortOrder', wi.sort_order)
                ORDER BY wi.sort_order
              ) FILTER (WHERE wi.id IS NOT NULL), '[]') as items
       FROM watchlists w
       LEFT JOIN watchlist_items wi ON wi.watchlist_id = w.id
       WHERE w.user_id = $1
       GROUP BY w.id
       ORDER BY w.created_at`,
      [req.userId],
    );
    res.json(result.rows);
  } catch (err) {
    logger.error(err, 'List watchlists error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const { name, symbols } = req.body;
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  try {
    const [wl] = await db.insert(watchlists)
      .values({ userId: req.userId!, name })
      .returning({ id: watchlists.id });

    if (symbols?.length) {
      await db.insert(watchlistItems).values(
        symbols.map((sym: string, i: number) => ({
          watchlistId: wl.id,
          symbol: sym,
          sortOrder: i,
        })),
      );
    }

    res.status(201).json({ id: wl.id, name, symbols: symbols || [] });
  } catch (err) {
    logger.error(err, 'Create watchlist error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  const { name, symbols } = req.body;
  try {
    const [wl] = await db.select({ id: watchlists.id })
      .from(watchlists)
      .where(and(eq(watchlists.id, req.params.id), eq(watchlists.userId, req.userId!)))
      .limit(1);
    if (!wl) {
      res.status(404).json({ error: 'Watchlist not found' });
      return;
    }

    if (name) {
      await db.update(watchlists)
        .set({ name, updatedAt: new Date() })
        .where(eq(watchlists.id, req.params.id));
    }

    if (symbols) {
      await db.delete(watchlistItems).where(eq(watchlistItems.watchlistId, req.params.id));
      if (symbols.length) {
        await db.insert(watchlistItems).values(
          symbols.map((sym: string, i: number) => ({
            watchlistId: req.params.id,
            symbol: sym,
            sortOrder: i,
          })),
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    logger.error(err, 'Update watchlist error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await db.delete(watchlists)
      .where(and(eq(watchlists.id, req.params.id), eq(watchlists.userId, req.userId!)))
      .returning({ id: watchlists.id });
    if (!deleted.length) {
      res.status(404).json({ error: 'Watchlist not found' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    logger.error(err, 'Delete watchlist error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

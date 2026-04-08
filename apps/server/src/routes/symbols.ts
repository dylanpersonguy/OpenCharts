import { Router, Request, Response } from 'express';
import { eq, ilike, or, asc } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { symbols } from '../db/schema';
import { logger } from '../services/logger';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await db.select({
      ticker: symbols.ticker,
      name: symbols.name,
      description: symbols.description,
      exchange: symbols.exchange,
      assetClass: symbols.assetClass,
      minTick: symbols.minTick,
      pricescale: symbols.pricescale,
    }).from(symbols).orderBy(asc(symbols.ticker));
    res.json(rows);
  } catch (err) {
    logger.error(err, 'List symbols error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/search', async (req: Request, res: Response) => {
  const q = (req.query.q as string || '').trim();
  if (!q) {
    res.json([]);
    return;
  }
  try {
    const pattern = `%${q}%`;
    const rows = await db.select({
      ticker: symbols.ticker,
      name: symbols.name,
      exchange: symbols.exchange,
      assetClass: symbols.assetClass,
    })
      .from(symbols)
      .where(or(
        ilike(symbols.ticker, pattern),
        ilike(symbols.name, pattern),
        ilike(symbols.description, pattern),
      ))
      .orderBy(asc(symbols.ticker))
      .limit(20);
    res.json(rows);
  } catch (err) {
    logger.error(err, 'Search symbols error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:ticker', async (req: Request, res: Response) => {
  try {
    const [symbol] = await db.select().from(symbols).where(eq(symbols.ticker, req.params.ticker)).limit(1);
    if (!symbol) {
      res.status(404).json({ error: 'Symbol not found' });
      return;
    }
    res.json(symbol);
  } catch (err) {
    logger.error(err, 'Resolve symbol error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

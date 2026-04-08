import { Router, Request, Response } from 'express';
import { exchangeAggregator, ExchangeConfig } from '../services/exchange-aggregator';
import { logger } from '../services/logger';

const router = Router();

/** GET /api/exchanges — list all exchange statuses */
router.get('/', (_req: Request, res: Response) => {
  res.json(exchangeAggregator.getStatus());
});

/** GET /api/exchanges/orderbook/:symbol — aggregated order book */
router.get('/orderbook/:symbol', async (req: Request, res: Response) => {
  const { symbol } = req.params;
  const depth = Math.min(parseInt(req.query.depth as string, 10) || 20, 100);

  try {
    const book = await exchangeAggregator.getAggregatedOrderBook(symbol, depth);
    res.json(book);
  } catch (err) {
    logger.error({ err, symbol }, '[ExchangeRoute] Order book error');
    res.status(500).json({ error: 'Failed to fetch aggregated order book' });
  }
});

/** GET /api/exchanges/ticker/:symbol — aggregated VWAP ticker */
router.get('/ticker/:symbol', (req: Request, res: Response) => {
  const { symbol } = req.params;
  const ticker = exchangeAggregator.getAggregatedTicker(symbol);
  if (!ticker) {
    res.status(404).json({ error: 'No ticker data for symbol' });
    return;
  }
  res.json(ticker);
});

/** POST /api/exchanges — add a new exchange */
router.post('/', async (req: Request, res: Response) => {
  const { id, symbols, pollIntervalMs, options } = req.body as ExchangeConfig;
  if (!id || !Array.isArray(symbols) || symbols.length === 0) {
    res.status(400).json({ error: 'id and symbols[] are required' });
    return;
  }

  try {
    await exchangeAggregator.addExchange({ id, symbols, pollIntervalMs, options });
    res.status(201).json({ status: 'added', exchange: id });
  } catch (err) {
    logger.error({ err, exchange: id }, '[ExchangeRoute] Add exchange error');
    res.status(400).json({ error: (err as Error).message });
  }
});

/** DELETE /api/exchanges/:id — remove an exchange */
router.delete('/:id', (req: Request, res: Response) => {
  exchangeAggregator.removeExchange(req.params.id);
  res.json({ status: 'removed', exchange: req.params.id });
});

export default router;

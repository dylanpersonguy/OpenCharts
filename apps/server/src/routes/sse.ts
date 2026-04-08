import { Request, Response, Router } from 'express';
import IORedis from 'ioredis';
import { config } from '../config';
import { logger } from '../services/logger';

/**
 * SSE (Server-Sent Events) fallback transport.
 *
 * Provides the same bar-update feed as WebSocket but via HTTP SSE
 * for environments where WebSocket is blocked (corporate proxies,
 * restrictive firewalls, etc.).
 *
 * GET /api/sse/bars?symbols=BTC/USD:1m,ETH/USD:5m
 */

const router = Router();

router.get('/bars', (req: Request, res: Response) => {
  const symbolsParam = (req.query.symbols as string) || '';
  const subscriptions = symbolsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (subscriptions.length === 0) {
    res.status(400).json({ error: 'symbols query param required (e.g. BTC/USD:1m)' });
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx SSE support
  });

  res.write(':ok\n\n');

  // Create a dedicated Redis subscriber for this SSE connection
  const sub = new IORedis(config.redis.url, { maxRetriesPerRequest: null });

  const channels = subscriptions.map((s) => `bar:${s}`);

  sub.subscribe(...channels, (err) => {
    if (err) {
      logger.error({ err, channels }, '[SSE] Subscribe failed');
      res.end();
      return;
    }
    logger.info({ channels, clientIp: req.ip }, '[SSE] Client connected');
  });

  sub.on('message', (channel, message) => {
    res.write(`event: bar\ndata: ${message}\n\n`);
  });

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 30_000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    sub.unsubscribe(...channels).catch(() => {});
    sub.disconnect();
    logger.info({ channels }, '[SSE] Client disconnected');
  });
});

export default router;

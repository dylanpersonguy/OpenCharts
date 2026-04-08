import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { config } from './config';
import { redis, redisSub } from './services/redis';
import { wsServer } from './ws/server';
import { simulatedProvider } from './services/simulated-provider';
import { CcxtProvider } from './services/ccxt-provider';
import { createAlpacaProvider } from './services/alpaca-provider';
import { scheduleAlertSweep, closeQueues } from './services/queues';
import { logger } from './services/logger';
import { rateLimitApi, rateLimitAuth } from './middleware/rate-limit';
import authRoutes from './routes/auth';
import symbolRoutes from './routes/symbols';
import barRoutes from './routes/bars';
import watchlistRoutes from './routes/watchlists';
import layoutRoutes from './routes/layouts';
import drawingRoutes from './routes/drawings';
import transpileRoutes from './routes/transpile';
import exchangeRoutes from './routes/exchanges';
import calendarRoutes from './routes/calendar';
import snapshotRoutes from './routes/snapshots';
import pluginRoutes from './routes/plugins';
import sseRoutes from './routes/sse';
import { exchangeAggregator } from './services/exchange-aggregator';

import { readFileSync } from 'fs';
import { join } from 'path';

const app = express();

app.use(helmet());
app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  const wsStats = wsServer.getStats();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    ws: wsStats,
  });
});

// OpenAPI spec
app.get('/api/openapi.json', (_req, res) => {
  try {
    const spec = readFileSync(join(__dirname, '../../openapi.json'), 'utf-8');
    res.setHeader('Content-Type', 'application/json');
    res.send(spec);
  } catch {
    res.status(404).json({ error: 'OpenAPI spec not found' });
  }
});

// Routes
app.use('/api/auth', rateLimitAuth, authRoutes);
app.use('/api/symbols', rateLimitApi, symbolRoutes);
app.use('/api/bars', rateLimitApi, barRoutes);
app.use('/api/watchlists', rateLimitApi, watchlistRoutes);
app.use('/api/layouts', rateLimitApi, layoutRoutes);
app.use('/api/drawings', rateLimitApi, drawingRoutes);
app.use('/api/transpile', rateLimitApi, transpileRoutes);
app.use('/api/exchanges', rateLimitApi, exchangeRoutes);
app.use('/api/calendar', rateLimitApi, calendarRoutes);
app.use('/api/snapshots', rateLimitApi, snapshotRoutes);
app.use('/api/plugins', rateLimitApi, pluginRoutes);
app.use('/api/sse', sseRoutes);

const server = createServer(app);

// Attach WebSocket server
wsServer.attach(server);

async function start() {
  // Connect Redis
  await redis.connect();
  await redisSub.connect();
  logger.info('Redis connected');

  server.listen(config.port, () => {
    logger.info({ port: config.port }, 'OpenCharts server running');
    logger.info({ ws: `ws://localhost:${config.port}/ws` }, 'WebSocket endpoint');
  });

  // Start market data provider
  if (config.ccxt.exchange) {
    // Use real exchange data via CCXT
    const ccxtProvider = new CcxtProvider({
      exchangeId: config.ccxt.exchange,
      symbols: config.ccxt.symbols,
      pollIntervalMs: config.ccxt.pollIntervalMs,
      exchangeOptions: {
        ...(config.ccxt.apiKey ? { apiKey: config.ccxt.apiKey, secret: config.ccxt.secret } : {}),
      },
    });
    await ccxtProvider.init();
    ccxtProvider.start();
    logger.info({ exchange: config.ccxt.exchange }, 'Using CCXT provider');
  } else if (config.alpaca.keyId) {
    // Use Alpaca for real equities + crypto
    const alpacaProvider = createAlpacaProvider();
    if (alpacaProvider) {
      await alpacaProvider.start();
      logger.info('Using Alpaca provider');
    }
  } else if (config.nodeEnv === 'development') {
    // Fall back to simulated data in development
    simulatedProvider.start(1000);
  }

  // Start multi-exchange aggregator if configured
  if (config.exchanges.length > 0) {
    for (const exCfg of config.exchanges) {
      await exchangeAggregator.addExchange(exCfg);
    }
    exchangeAggregator.start();
    logger.info({ count: config.exchanges.length }, 'Multi-exchange aggregator started');
  }

  // Schedule repeatable alert sweep
  await scheduleAlertSweep();
  logger.info('BullMQ alert sweep scheduled');
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  simulatedProvider.stop();
  exchangeAggregator.stop();
  wsServer.shutdown();
  await closeQueues();
  server.close();
  redis.disconnect();
  redisSub.disconnect();
});

start().catch((err) => {
  logger.fatal(err, 'Failed to start server');
  process.exit(1);
});

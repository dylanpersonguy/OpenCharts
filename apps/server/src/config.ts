import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    url: process.env.DATABASE_URL || 'postgresql://opencharts:opencharts@localhost:5432/opencharts',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  },
  ccxt: {
    exchange: process.env.CCXT_EXCHANGE || '',
    symbols: (process.env.CCXT_SYMBOLS || '').split(',').filter(Boolean),
    pollIntervalMs: parseInt(process.env.CCXT_POLL_INTERVAL_MS || '2000', 10),
    apiKey: process.env.CCXT_API_KEY || '',
    secret: process.env.CCXT_SECRET || '',
  },
  alpaca: {
    keyId: process.env.ALPACA_KEY_ID || '',
    secretKey: process.env.ALPACA_SECRET_KEY || '',
    paper: process.env.ALPACA_PAPER !== 'false',
    dataFeed: (process.env.ALPACA_DATA_FEED as 'iex' | 'sip') || 'iex',
  },
  /** Multi-exchange aggregation: JSON array of { id, symbols, pollIntervalMs? } */
  exchanges: parseExchanges(),
} as const;

function parseExchanges(): { id: string; symbols: string[]; pollIntervalMs?: number }[] {
  const raw = process.env.EXCHANGES;
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

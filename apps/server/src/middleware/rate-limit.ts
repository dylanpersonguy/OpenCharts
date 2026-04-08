import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import IORedis from 'ioredis';
import { config } from '../config';
import { logger } from '../services/logger';

const redisClient = new IORedis(config.redis.url, { enableOfflineQueue: false });

// ── General API limiter: 100 req / 15s per IP ────────
const apiLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'rl:api',
  points: 100,
  duration: 15,
});

// ── Auth limiter: 10 req / 60s per IP (login/register) ──
const authLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'rl:auth',
  points: 10,
  duration: 60,
});

function createMiddleware(limiter: RateLimiterRedis) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await limiter.consume(req.ip ?? '127.0.0.1');
      next();
    } catch (rlRes) {
      if (rlRes instanceof Error) {
        // Redis down — allow request through but log
        logger.warn(rlRes, 'Rate limiter Redis error, allowing request');
        next();
        return;
      }
      const retryAfter = Math.ceil((rlRes as { msBeforeNext: number }).msBeforeNext / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Too many requests, please try again later' });
    }
  };
}

export const rateLimitApi = createMiddleware(apiLimiter);
export const rateLimitAuth = createMiddleware(authLimiter);

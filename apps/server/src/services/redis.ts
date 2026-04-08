import Redis from 'ioredis';
import { config } from '../config';
import { logger } from './logger';

export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

export const redisSub = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('error', (err) => logger.error(err, 'Redis error'));
redisSub.on('error', (err) => logger.error(err, 'Redis sub error'));

export function barChannel(symbol: string, resolution: string): string {
  return `bar:${symbol}:${resolution}`;
}

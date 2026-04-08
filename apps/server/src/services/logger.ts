import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: process.env.LOG_LEVEL || (config.nodeEnv === 'production' ? 'info' : 'debug'),
  transport:
    config.nodeEnv !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
      : undefined,
});

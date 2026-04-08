import type { Resolution } from './types/candle';

export const ALL_RESOLUTIONS: Resolution[] = [
  '1s', '5s', '15s', '1m', '5m', '15m', '1h', '4h', '1d', '1w',
];

export const WS_HEARTBEAT_INTERVAL = 30_000;
export const WS_RECONNECT_DELAY = 3_000;
export const WS_MAX_RECONNECT_ATTEMPTS = 10;

export const DEFAULT_RESOLUTION: Resolution = '1m';
export const DEFAULT_CHART_TYPE = 'candlestick' as const;

export const MAX_BARS_PER_REQUEST = 5000;
export const DEFAULT_BARS_COUNT = 300;

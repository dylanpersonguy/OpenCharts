export type Resolution =
  | '1s' | '5s' | '15s'
  | '1m' | '5m' | '15m'
  | '1h' | '4h'
  | '1d' | '1w';

/** Maps resolution to its duration in milliseconds */
export const RESOLUTION_MS: Record<Resolution, number> = {
  '1s': 1_000,
  '5s': 5_000,
  '15s': 15_000,
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

export interface OHLCV {
  time: number;   // unix seconds (Lightweight Charts convention)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Bar extends OHLCV {
  symbol: string;
  resolution: Resolution;
}

export interface PartialBarUpdate {
  symbol: string;
  resolution: Resolution;
  bar: OHLCV;
  isClosed: boolean;
}

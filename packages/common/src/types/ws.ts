import type { OHLCV, Resolution } from './candle';

/** Client → Server messages */
export type WsClientMessage =
  | { type: 'subscribe'; symbol: string; resolution: Resolution }
  | { type: 'unsubscribe'; symbol: string; resolution: Resolution }
  | { type: 'pong' };

/** Server → Client messages */
export type WsServerMessage =
  | { type: 'bar_update'; symbol: string; resolution: Resolution; bar: OHLCV; isClosed: boolean }
  | { type: 'snapshot'; symbol: string; resolution: Resolution; bars: OHLCV[] }
  | { type: 'ping' }
  | { type: 'error'; message: string }
  | { type: 'subscribed'; symbol: string; resolution: Resolution }
  | { type: 'unsubscribed'; symbol: string; resolution: Resolution };

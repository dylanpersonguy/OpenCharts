import type {
  Account,
  Candle,
  ClosedPosition,
  Order,
  PlaceOrderInput,
  Position,
  Symbol,
} from "../services/schemas.ts";

/**
 * The OpenCharts adapter contract.
 *
 * This is the whole surface the terminal needs from a data and trading
 * backend. Implement it and pass it to `<OpenChartsProvider adapter={...}>` —
 * there is no need to fork the project or edit any file inside it.
 *
 * Only `marketData` is required. Without `trading` the terminal runs as a
 * read-only chart; without `storage` drawings and templates stay in the
 * browser's localStorage.
 */

export type Unsubscribe = () => void;

export type ConnectionState = "connected" | "connecting" | "reconnecting" | "disconnected";

export interface CandleRequest {
  symbol: string;
  /** "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w" */
  timeframe: string;
  /** Most recent N bars. Omitted means "whatever you have". */
  limit?: number;
  /** Inclusive lower bound, epoch ms. Sent when the user scrolls back. */
  fromMs?: number;
  /** Exclusive upper bound, epoch ms. */
  toMs?: number;
}

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: number;
}

/** Pushed by `marketData.subscribe`. */
export type MarketEvent =
  | { type: "tick"; symbol: string; bid: number; ask: number; timestamp?: number }
  | {
      type: "candle";
      symbol: string;
      timeframe: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      timestamp: number;
    };

export interface MarketDataSource {
  /** Instruments the terminal may chart and trade. */
  getSymbols(): Promise<Symbol[]>;

  /**
   * Historical bars, oldest first.
   *
   * Honour `fromMs`/`toMs` when present — the chart's scroll-back pagination
   * walks backwards with them, and ignoring the window makes it loop.
   */
  getCandles(request: CandleRequest): Promise<Candle[]>;

  /** Current top of book, used to prime a symbol before the first tick. */
  getQuote?(symbol: string): Promise<Quote | null>;

  /** Live prices and bar updates. Return an unsubscribe function. */
  subscribe(handler: (event: MarketEvent) => void): Unsubscribe;

  /** Open the connection. Called once when the terminal mounts. */
  connect?(): void | Promise<void>;
  disconnect?(): void;

  /** Report transport health; drives the connection indicator. */
  onConnectionChange?(handler: (state: ConnectionState) => void): Unsubscribe;
  /** Current transport state, if the source tracks one. */
  getConnectionState?(): ConnectionState;

  /** Which symbols are on screen, so a feed can narrow its subscriptions. */
  setSymbolInterest?(symbols: string[]): void;
}

/** Pushed by `trading.subscribe`. `entity` carries the full record when available. */
export type TradingEvent =
  | { type: "position.opened"; accountId: string; positionId: string; entity?: Position }
  | {
      type: "position.updated";
      accountId: string;
      positionId: string;
      entity?: Position;
      unrealizedPnl?: number;
      quantity?: number;
      averagePrice?: number;
    }
  | { type: "position.closed"; accountId: string; positionId: string }
  | {
      type: "order.placed" | "order.filled" | "order.canceled" | "order.rejected";
      accountId: string;
      orderId: string;
      entity?: Order;
    }
  | {
      type: "account.updated";
      accountId: string;
      equity?: number;
      balance?: number;
      freeMargin?: number;
      marginUsed?: number;
    };

export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PositionModification {
  takeProfit?: number | null;
  stopLoss?: number | null;
}

export interface OrderModification {
  price?: number;
  stopPrice?: number;
  quantity?: number;
  takeProfit?: number | null;
  stopLoss?: number | null;
}

export interface TradingGateway {
  getAccounts(): Promise<Account[]>;
  getPositions(accountId: string): Promise<Position[]>;
  getOrders(accountId: string, status?: string): Promise<Order[]>;
  getClosedPositions(accountId: string, page?: number): Promise<Page<ClosedPosition>>;

  /**
   * Submit an order. Reject with an Error whose `message` explains why — the
   * terminal shows it to the trader verbatim.
   */
  placeOrder(input: PlaceOrderInput): Promise<Order>;
  modifyOrder(orderId: string, modification: OrderModification): Promise<Order>;
  cancelOrder(orderId: string): Promise<void>;
  cancelAllOrders(accountId?: string): Promise<void>;

  closePosition(positionId: string, quantity?: number): Promise<void>;
  closeAllPositions(accountId?: string): Promise<void>;
  modifyPosition(positionId: string, modification: PositionModification): Promise<Position>;

  /** Position, order and account updates. Return an unsubscribe function. */
  subscribe(handler: (event: TradingEvent) => void): Unsubscribe;
}

/**
 * Where per-user chart state is kept: drawings, chart templates and journal
 * entries. Implement it to sync a trader's work to your own backend instead of
 * their browser. Values are JSON strings.
 *
 * Device-local preferences (sound mute, panel sizes, watchlist favourites) are
 * deliberately not routed here — they belong to the device, not the account.
 */
export interface StorageDriver {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
}

export interface OpenChartsAdapter {
  /** Shown in diagnostics; helps when several adapters are in play. */
  name?: string;
  marketData: MarketDataSource;
  trading?: TradingGateway;
  storage?: StorageDriver;
}

export type {
  Account,
  Candle,
  ClosedPosition,
  Order,
  PlaceOrderInput,
  Position,
  Symbol,
};

import type { Order, Position } from "../../schemas.ts";

/**
 * Types for the pure bar-replay trading engine. All time is unix seconds taken
 * from bars (never the wall clock) and every price on a bar is the BID; the
 * ask is always bid + spread.
 */

export type ReplaySymbol = "BTCUSD" | "XAUUSD";

/** One OHLCV bar. `time` is the bar OPEN in unix seconds; prices are bid. */
export interface Bar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface EngineConfig {
  readonly accountId: string;
  readonly symbol: ReplaySymbol;
  readonly contractSize: number;
  readonly tickSize: number;
  /** Spread in price units: ask = bid + spread. */
  readonly spread: number;
  readonly commissionPerLotPerSide: number;
  readonly leverage: number;
  readonly startingBalance: number;
}

export type ExitReason = "SL" | "TP" | "MANUAL" | "STOP_OUT";
export type PositionSide = "LONG" | "SHORT";
export type OrderSide = "BUY" | "SELL";

/** Open position; a superset of the schemas `Position` so existing UI renders it. */
export type ReplayPosition = Readonly<
  Position & {
    currentPrice: number;
    contractSize: number;
    /** Unix seconds of the bar the position was filled on. */
    entryTime: number;
    initialStopLoss: number | null;
    /** Entry-side commission already debited, prorated on partial closes. */
    entryCommission: number;
    /** Max adverse excursion since entry, as a price distance (>= 0). */
    mae: number;
    /** Max favorable excursion since entry, as a price distance (>= 0). */
    mfe: number;
  }
>;

/** Resting LIMIT/STOP order (status "PENDING"), or a MARKET/filled order in events. */
export type ReplayOrder = Readonly<
  Order & {
    /** Unix seconds of the cursor when the order was placed. */
    placedTime: number;
  }
>;

export interface ClosedTrade {
  readonly id: string;
  readonly positionId: string;
  readonly symbol: ReplaySymbol;
  readonly side: PositionSide;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly entryTime: number;
  readonly exitTime: number;
  readonly exitReason: ExitReason;
  readonly grossPnl: number;
  /** Entry share + exit commission for this slice. */
  readonly commission: number;
  readonly netPnl: number;
  readonly initialStopLoss: number | null;
  readonly takeProfit: number | null;
  readonly rMultiple: number | null;
  readonly mae: number;
  readonly mfe: number;
  readonly isPartial: boolean;
}

export interface EngineState {
  readonly cursorTime: number | null;
  readonly lastClose: number | null;
  readonly balance: number;
  readonly positions: readonly ReplayPosition[];
  readonly orders: readonly ReplayOrder[];
  readonly closedTrades: readonly ClosedTrade[];
}

export interface AccountSnapshot {
  readonly balance: number;
  readonly equity: number;
  readonly margin: number;
  readonly freeMargin: number;
}

export type EngineEvent =
  | { readonly type: "order-placed"; readonly order: ReplayOrder }
  | { readonly type: "order-filled"; readonly order: ReplayOrder; readonly position: ReplayPosition }
  | { readonly type: "order-canceled"; readonly orderId: string }
  | { readonly type: "order-modified"; readonly order: ReplayOrder }
  | { readonly type: "position-opened"; readonly position: ReplayPosition }
  | { readonly type: "position-updated"; readonly position: ReplayPosition }
  | { readonly type: "position-closed"; readonly position: ReplayPosition; readonly trade: ClosedTrade }
  | {
      readonly type: "position-partially-closed";
      /** The remaining (still open) position. */
      readonly position: ReplayPosition;
      readonly trade: ClosedTrade;
    }
  | ({ readonly type: "equity" } & AccountSnapshot);

export type EngineErrorCode =
  | "NO_PRICE"
  | "INVALID_QUANTITY"
  | "INVALID_PRICE"
  | "INVALID_STOP_LOSS"
  | "INVALID_TAKE_PROFIT"
  | "INSUFFICIENT_MARGIN"
  | "NOT_FOUND"
  | "INVALID_BAR";

export interface EngineError {
  readonly code: EngineErrorCode;
  readonly message: string;
}

export type EngineResult =
  | { readonly ok: true; readonly state: EngineState; readonly events: readonly EngineEvent[] }
  | { readonly ok: false; readonly error: EngineError };

export interface EngineDeps {
  readonly newId: () => string;
}

export interface PlaceOrderInput {
  readonly side: OrderSide;
  readonly type: "MARKET" | "LIMIT" | "STOP";
  readonly quantity: number;
  readonly price?: number;
  readonly stopPrice?: number;
  readonly takeProfit?: number;
  readonly stopLoss?: number;
}

/** `undefined` = unchanged, `null` = clear. */
export interface OrderMods {
  readonly price?: number;
  readonly stopPrice?: number;
  readonly takeProfit?: number | null;
  readonly stopLoss?: number | null;
}

/** `undefined` = unchanged, `null` = clear. */
export interface PositionMods {
  readonly takeProfit?: number | null;
  readonly stopLoss?: number | null;
}

export interface ClosePositionInput {
  readonly positionId: string;
  /** Omitted or >= position quantity closes the whole position. */
  readonly quantity?: number;
  readonly reason?: ExitReason;
  /** Exit price; defaults to the exit side (bid long / ask short) of lastClose. */
  readonly price?: number;
  /** Exit time; defaults to cursorTime. */
  readonly time?: number;
}

import { marginFor, markPosition } from "./equity.ts";
import { exitPriceAt, isoFromUnix, roundMoney, roundPrice } from "./price.ts";
import type { EngineConfig, EngineDeps, EngineEvent, EngineState, ReplayOrder, ReplayPosition } from "./types.ts";

/** A state transition plus the events it produced. */
export interface Step {
  readonly state: EngineState;
  readonly events: readonly EngineEvent[];
}

/** Updates MAE/MFE (price distances from entry) for a bid the position has seen. */
export function applyExcursion(pos: ReplayPosition, bid: number, cfg: EngineConfig): ReplayPosition {
  const exit = exitPriceAt(pos.side, bid, cfg);
  const favorable = roundPrice(pos.side === "LONG" ? exit - pos.entryPrice : pos.entryPrice - exit, cfg);
  return {
    ...pos,
    mfe: Math.max(pos.mfe, favorable),
    mae: Math.max(pos.mae, -favorable),
  };
}

function newPosition(order: ReplayOrder, fillPrice: number, time: number, cfg: EngineConfig, id: string): ReplayPosition {
  return {
    id,
    accountId: cfg.accountId,
    symbolName: cfg.symbol,
    side: order.side === "BUY" ? "LONG" : "SHORT",
    quantity: order.quantity,
    entryPrice: fillPrice,
    currentPrice: fillPrice,
    unrealizedPnl: 0,
    margin: marginFor(fillPrice, order.quantity, cfg),
    contractSize: cfg.contractSize,
    openedAt: isoFromUnix(time),
    takeProfit: order.takeProfit,
    stopLoss: order.stopLoss,
    entryTime: time,
    initialStopLoss: order.stopLoss,
    entryCommission: roundMoney(cfg.commissionPerLotPerSide * order.quantity),
    mae: 0,
    mfe: 0,
  };
}

/**
 * Fills `order` at `fillPrice`, opening a new (hedged, never netted) position
 * that inherits the order's SL/TP. Entry commission is debited immediately.
 * `bid` is the bid at the moment of the fill, used for the initial mark.
 */
export function fillOrder(
  state: EngineState,
  cfg: EngineConfig,
  order: ReplayOrder,
  fillPrice: number,
  time: number,
  bid: number,
  deps: EngineDeps,
): Step {
  const opened = newPosition(order, fillPrice, time, cfg, deps.newId());
  const position = applyExcursion(markPosition(opened, bid, cfg), bid, cfg);
  const filled: ReplayOrder = {
    ...order,
    status: "FILLED",
    filledQuantity: order.quantity,
    avgFillPrice: fillPrice,
    updatedAt: isoFromUnix(time),
  };
  const next: EngineState = {
    ...state,
    balance: roundMoney(state.balance - position.entryCommission),
    orders: state.orders.filter((o) => o.id !== order.id),
    positions: [...state.positions, position],
  };
  return {
    state: next,
    events: [
      { type: "order-filled", order: filled, position },
      { type: "position-opened", position },
    ],
  };
}

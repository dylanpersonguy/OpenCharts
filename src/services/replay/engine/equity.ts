import { exitPriceAt, roundMoney } from "./price.ts";
import type { AccountSnapshot, EngineConfig, EngineEvent, EngineState, ReplayPosition } from "./types.ts";

/** Gross P&L of `quantity` units of `pos` closed at `exitPrice`. */
export function grossPnl(pos: ReplayPosition, exitPrice: number, quantity: number, cfg: EngineConfig): number {
  const dir = pos.side === "LONG" ? 1 : -1;
  return roundMoney((exitPrice - pos.entryPrice) * quantity * cfg.contractSize * dir);
}

/** Margin held for a position at `price`: notional / leverage. */
export function marginFor(price: number, quantity: number, cfg: EngineConfig): number {
  return roundMoney((price * quantity * cfg.contractSize) / cfg.leverage);
}

/** Position marked at a bid (longs at bid, shorts at ask). */
export function markPosition(pos: ReplayPosition, bid: number, cfg: EngineConfig): ReplayPosition {
  const currentPrice = exitPriceAt(pos.side, bid, cfg);
  return { ...pos, currentPrice, unrealizedPnl: grossPnl(pos, currentPrice, pos.quantity, cfg) };
}

/** Balance/equity/margin, marking open positions at lastClose when known. */
export function accountSnapshot(state: EngineState, cfg: EngineConfig): AccountSnapshot {
  let unrealized = 0;
  let margin = 0;
  for (const p of state.positions) {
    const marked = state.lastClose == null ? p : markPosition(p, state.lastClose, cfg);
    unrealized += marked.unrealizedPnl;
    margin += p.margin;
  }
  const equity = roundMoney(state.balance + unrealized);
  return { balance: state.balance, equity, margin: roundMoney(margin), freeMargin: roundMoney(equity - margin) };
}

export function equityEvent(state: EngineState, cfg: EngineConfig): EngineEvent {
  return { type: "equity", ...accountSnapshot(state, cfg) };
}

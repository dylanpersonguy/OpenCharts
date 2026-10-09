import { equityEvent, grossPnl, marginFor } from "./equity.ts";
import type { Step } from "./fill.ts";
import { exitPriceAt, isValidQuantity, roundMoney, roundQuantity } from "./price.ts";
import { fail, ok } from "./result.ts";
import type {
  ClosePositionInput,
  ClosedTrade,
  EngineConfig,
  EngineDeps,
  EngineResult,
  EngineState,
  ExitReason,
  ReplayPosition,
} from "./types.ts";

/** Parameters for closing (part of) a position at a known price and time. */
export interface CloseFill {
  readonly quantity: number;
  readonly price: number;
  readonly time: number;
  readonly reason: ExitReason;
}

function rMultiple(pos: ReplayPosition, netPnl: number, quantity: number, cfg: EngineConfig): number | null {
  if (pos.initialStopLoss == null) return null;
  const risk = Math.abs(pos.entryPrice - pos.initialStopLoss) * quantity * cfg.contractSize;
  return risk > 0 ? netPnl / risk : null;
}

function buildTrade(pos: ReplayPosition, fill: CloseFill, entryShare: number, cfg: EngineConfig, id: string): ClosedTrade {
  const gross = grossPnl(pos, fill.price, fill.quantity, cfg);
  const commission = roundMoney(entryShare + cfg.commissionPerLotPerSide * fill.quantity);
  const netPnl = roundMoney(gross - commission);
  return {
    id,
    positionId: pos.id,
    symbol: cfg.symbol,
    side: pos.side,
    quantity: fill.quantity,
    entryPrice: pos.entryPrice,
    exitPrice: fill.price,
    entryTime: pos.entryTime,
    exitTime: fill.time,
    exitReason: fill.reason,
    grossPnl: gross,
    commission,
    netPnl,
    initialStopLoss: pos.initialStopLoss,
    takeProfit: pos.takeProfit,
    rMultiple: rMultiple(pos, netPnl, fill.quantity, cfg),
    mae: pos.mae,
    mfe: pos.mfe,
    isPartial: fill.quantity < pos.quantity,
  };
}

/**
 * Closes `fill.quantity` of `pos` (full close when >= its size) without
 * validation or an equity event. Entry commission was debited on fill, so the
 * balance moves by gross P&L minus the exit commission only.
 */
export function applyClose(state: EngineState, cfg: EngineConfig, pos: ReplayPosition, fill: CloseFill, deps: EngineDeps): Step {
  const full = fill.quantity >= pos.quantity;
  const quantity = full ? pos.quantity : roundQuantity(fill.quantity);
  const entryShare = full ? pos.entryCommission : roundMoney((pos.entryCommission * quantity) / pos.quantity);
  const trade = buildTrade(pos, { ...fill, quantity }, entryShare, cfg, deps.newId());
  const exitCommission = roundMoney(trade.commission - entryShare);
  const balance = roundMoney(state.balance + trade.grossPnl - exitCommission);
  const closedTrades = [...state.closedTrades, trade];
  if (full) {
    const position = { ...pos, currentPrice: fill.price, unrealizedPnl: 0 };
    const positions = state.positions.filter((p) => p.id !== pos.id);
    return { state: { ...state, balance, positions, closedTrades }, events: [{ type: "position-closed", position, trade }] };
  }
  const remainingQty = roundQuantity(pos.quantity - quantity);
  const remaining: ReplayPosition = {
    ...pos,
    quantity: remainingQty,
    entryCommission: roundMoney(pos.entryCommission - entryShare),
    margin: marginFor(pos.entryPrice, remainingQty, cfg),
    unrealizedPnl: grossPnl(pos, pos.currentPrice, remainingQty, cfg),
  };
  const positions = state.positions.map((p) => (p.id === pos.id ? remaining : p));
  return {
    state: { ...state, balance, positions, closedTrades },
    events: [{ type: "position-partially-closed", position: remaining, trade }],
  };
}

/** Manually (or with an explicit reason/price/time) closes all or part of a position. */
export function closePosition(state: EngineState, cfg: EngineConfig, input: ClosePositionInput, deps: EngineDeps): EngineResult {
  const pos = state.positions.find((p) => p.id === input.positionId);
  if (!pos) return fail("NOT_FOUND", `Position ${input.positionId} not found`);
  const qty = input.quantity ?? pos.quantity;
  if (!(qty > 0) || (qty < pos.quantity && !isValidQuantity(qty))) {
    return fail("INVALID_QUANTITY", "Close quantity must be positive and a multiple of 0.01");
  }
  const time = input.time ?? state.cursorTime;
  const price = input.price ?? (state.lastClose == null ? null : exitPriceAt(pos.side, state.lastClose, cfg));
  if (time == null || price == null) return fail("NO_PRICE", "No price yet: advance at least one bar first");
  const step = applyClose(state, cfg, pos, { quantity: qty, price, time, reason: input.reason ?? "MANUAL" }, deps);
  return ok(step.state, [...step.events, equityEvent(step.state, cfg)]);
}

/** Closes every open position at the exit side of `bid`, without an equity event. */
export function closeEvery(state: EngineState, cfg: EngineConfig, bid: number, time: number, reason: ExitReason, deps: EngineDeps): Step {
  return state.positions.reduce<Step>(
    (acc, pos) => {
      const fill = { quantity: pos.quantity, price: exitPriceAt(pos.side, bid, cfg), time, reason };
      const next = applyClose(acc.state, cfg, pos, fill, deps);
      return { state: next.state, events: [...acc.events, ...next.events] };
    },
    { state, events: [] },
  );
}

/** Closes every open position at the current price with one trailing equity event. */
export function closeAll(state: EngineState, cfg: EngineConfig, deps: EngineDeps, reason: ExitReason = "MANUAL"): EngineResult {
  if (state.positions.length === 0) return ok(state, []);
  if (state.lastClose == null || state.cursorTime == null) {
    return fail("NO_PRICE", "No price yet: advance at least one bar first");
  }
  const step = closeEvery(state, cfg, state.lastClose, state.cursorTime, reason, deps);
  return ok(step.state, [...step.events, equityEvent(step.state, cfg)]);
}

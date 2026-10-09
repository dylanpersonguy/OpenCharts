import { roundPrice } from "./price.ts";
import type { EngineConfig, EngineState, ReplayOrder, ReplayPosition } from "./types.ts";

/**
 * Converts resting orders and position SL/TP into bid-space triggers so the
 * bar walker only ever compares against bid prices. Ask-side conditions are
 * shifted down by the spread.
 */

export type TriggerKind = "SL" | "TP" | "ORDER";
export type TriggerDir = "up" | "down";

export interface Trigger {
  readonly itemId: string;
  readonly kind: TriggerKind;
  /** Bid level at which the trigger fires. */
  readonly level: number;
  /** Fires when the bid moves up to >= level, or down to <= level. */
  readonly dir: TriggerDir;
  /** Fill/exit price when hit exactly at `level`. */
  readonly fillPrice: number;
  /** fillPrice - level: spread for ask-side triggers, else 0. */
  readonly offset: number;
  /** Deterministic tie-break: lower first (SL, TP, then orders; by list order). */
  readonly rank: number;
}

const KIND_RANK: Record<TriggerKind, number> = { SL: 0, TP: 1, ORDER: 2 };

function makeTrigger(
  itemId: string,
  kind: TriggerKind,
  fillPrice: number,
  askSide: boolean,
  dir: TriggerDir,
  index: number,
  cfg: EngineConfig,
): Trigger {
  const offset = askSide ? cfg.spread : 0;
  const level = roundPrice(fillPrice - offset, cfg);
  return { itemId, kind, level, dir, fillPrice, offset, rank: KIND_RANK[kind] * 1e6 + index };
}

/** Bid-space trigger for a resting LIMIT/STOP order, or null for other types. */
export function orderTrigger(order: ReplayOrder, cfg: EngineConfig, index = 0): Trigger | null {
  const isBuy = order.side === "BUY";
  if (order.type === "LIMIT" && order.price != null) {
    return makeTrigger(order.id, "ORDER", order.price, isBuy, isBuy ? "down" : "up", index, cfg);
  }
  if (order.type === "STOP" && order.stopPrice != null) {
    return makeTrigger(order.id, "ORDER", order.stopPrice, isBuy, isBuy ? "up" : "down", index, cfg);
  }
  return null;
}

/** SL/TP triggers for an open position (longs exit on the bid, shorts on the ask). */
export function positionTriggers(pos: ReplayPosition, cfg: EngineConfig, index = 0): readonly Trigger[] {
  const isLong = pos.side === "LONG";
  const out: Trigger[] = [];
  if (pos.stopLoss != null) {
    out.push(makeTrigger(pos.id, "SL", pos.stopLoss, !isLong, isLong ? "down" : "up", index, cfg));
  }
  if (pos.takeProfit != null) {
    out.push(makeTrigger(pos.id, "TP", pos.takeProfit, !isLong, isLong ? "up" : "down", index, cfg));
  }
  return out;
}

/** All live triggers for the current state. */
export function collectTriggers(state: EngineState, cfg: EngineConfig): readonly Trigger[] {
  const exits = state.positions.flatMap((p, i) => positionTriggers(p, cfg, i));
  const entries = state.orders.flatMap((o, i) => {
    const t = orderTrigger(o, cfg, i);
    return t ? [t] : [];
  });
  return [...exits, ...entries];
}

/** True if the trigger's condition already holds at bid `price`. */
export function isCrossed(trigger: Trigger, price: number): boolean {
  return trigger.dir === "up" ? price >= trigger.level : price <= trigger.level;
}

import { MAX_QUANTITY, isValidQuantity } from "./price.ts";
import type { EngineError, OrderSide } from "./types.ts";

/** Order/position validation. Each check returns an error or null. */

function err(code: EngineError["code"], message: string): EngineError {
  return { code, message };
}

function isPositivePrice(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function checkQuantity(quantity: number): EngineError | null {
  return isValidQuantity(quantity)
    ? null
    : err("INVALID_QUANTITY", `Quantity must be > 0, <= ${MAX_QUANTITY} and a multiple of 0.01`);
}

/** Entry price for a LIMIT/STOP must be a positive number. */
export function checkPositive(value: number | null | undefined, label: string): EngineError | null {
  return isPositivePrice(value) ? null : err("INVALID_PRICE", `${label} must be a positive number`);
}

/** Buy limit < ask, buy stop > ask, sell limit > bid, sell stop < bid. */
export function checkPendingPrice(
  side: OrderSide,
  type: "LIMIT" | "STOP",
  price: number,
  bid: number,
  ask: number,
): EngineError | null {
  if (side === "BUY" && type === "LIMIT" && !(price < ask)) {
    return err("INVALID_PRICE", `Buy limit ${price} must be below the ask ${ask}`);
  }
  if (side === "BUY" && type === "STOP" && !(price > ask)) {
    return err("INVALID_PRICE", `Buy stop ${price} must be above the ask ${ask}`);
  }
  if (side === "SELL" && type === "LIMIT" && !(price > bid)) {
    return err("INVALID_PRICE", `Sell limit ${price} must be above the bid ${bid}`);
  }
  if (side === "SELL" && type === "STOP" && !(price < bid)) {
    return err("INVALID_PRICE", `Sell stop ${price} must be below the bid ${bid}`);
  }
  return null;
}

/**
 * Long: SL < ref < TP; short: TP < ref < SL. `null`/`undefined` levels are
 * skipped. `ref` is the entry price, or the exit-side price for open positions.
 */
export function checkBrackets(
  isLong: boolean,
  ref: number,
  stopLoss: number | null | undefined,
  takeProfit: number | null | undefined,
): EngineError | null {
  if (stopLoss != null) {
    if (!isPositivePrice(stopLoss)) return err("INVALID_STOP_LOSS", "Stop loss must be a positive number");
    if (isLong ? !(stopLoss < ref) : !(stopLoss > ref)) {
      return err("INVALID_STOP_LOSS", `Stop loss ${stopLoss} must be ${isLong ? "below" : "above"} ${ref}`);
    }
  }
  if (takeProfit != null) {
    if (!isPositivePrice(takeProfit)) return err("INVALID_TAKE_PROFIT", "Take profit must be a positive number");
    if (isLong ? !(takeProfit > ref) : !(takeProfit < ref)) {
      return err("INVALID_TAKE_PROFIT", `Take profit ${takeProfit} must be ${isLong ? "above" : "below"} ${ref}`);
    }
  }
  return null;
}

import { accountSnapshot, equityEvent, marginFor } from "./equity.ts";
import { fillOrder } from "./fill.ts";
import { askOf, exitPriceAt, isoFromUnix, roundPrice } from "./price.ts";
import { fail, ok } from "./result.ts";
import type {
  EngineConfig,
  EngineDeps,
  EngineError,
  EngineResult,
  EngineState,
  OrderMods,
  PlaceOrderInput,
  PositionMods,
  ReplayOrder,
  ReplayPosition,
} from "./types.ts";
import { checkBrackets, checkPendingPrice, checkPositive, checkQuantity } from "./validation.ts";

/** Order placement, modification and cancellation, plus position SL/TP edits. */

const NO_PRICE_MESSAGE = "No price yet: advance at least one bar first";

/** Rounds a level to tick; passes `null`/`undefined` through. */
function roundLevel<T extends number | null | undefined>(value: T, cfg: EngineConfig): T {
  return (typeof value === "number" ? roundPrice(value, cfg) : value) as T;
}

/** Entry price for the order; undefined when a required LIMIT/STOP price is missing. */
function entryPriceOf(input: PlaceOrderInput, bid: number, cfg: EngineConfig): number | undefined {
  if (input.type === "MARKET") return input.side === "BUY" ? askOf(bid, cfg) : bid;
  return roundLevel(input.type === "LIMIT" ? input.price : input.stopPrice, cfg);
}

interface Placement {
  readonly entry: number;
  readonly stopLoss: number | null;
  readonly takeProfit: number | null;
}

/** Validates quantity, entry price, brackets and margin; returns the normalized levels. */
function validatePlacement(state: EngineState, cfg: EngineConfig, input: PlaceOrderInput, bid: number): Placement | EngineError {
  const qtyError = checkQuantity(input.quantity);
  if (qtyError) return qtyError;
  const entry = entryPriceOf(input, bid, cfg);
  if (input.type !== "MARKET") {
    const label = input.type === "LIMIT" ? "Limit price" : "Stop price";
    const priceError = checkPositive(entry, label) ?? checkPendingPrice(input.side, input.type, entry!, bid, askOf(bid, cfg));
    if (priceError) return priceError;
  }
  if (entry == null) return { code: "INVALID_PRICE", message: "Missing entry price" };
  const stopLoss = roundLevel(input.stopLoss, cfg) ?? null;
  const takeProfit = roundLevel(input.takeProfit, cfg) ?? null;
  const bracketError = checkBrackets(input.side === "BUY", entry, stopLoss, takeProfit);
  if (bracketError) return bracketError;
  const required = marginFor(entry, input.quantity, cfg);
  const free = accountSnapshot(state, cfg).freeMargin;
  if (required > free) {
    return {
      code: "INSUFFICIENT_MARGIN",
      message: `Required margin ${required.toFixed(2)} exceeds free margin ${free.toFixed(2)}`,
    };
  }
  return { entry, stopLoss, takeProfit };
}

function buildOrder(input: PlaceOrderInput, levels: Placement, time: number, cfg: EngineConfig, id: string): ReplayOrder {
  const iso = isoFromUnix(time);
  return {
    id,
    accountId: cfg.accountId,
    symbolName: cfg.symbol,
    side: input.side,
    type: input.type,
    quantity: input.quantity,
    price: input.type === "LIMIT" ? levels.entry : null,
    stopPrice: input.type === "STOP" ? levels.entry : null,
    takeProfit: levels.takeProfit,
    stopLoss: levels.stopLoss,
    status: "PENDING",
    filledQuantity: 0,
    avgFillPrice: null,
    comment: null,
    createdAt: iso,
    updatedAt: iso,
    placedTime: time,
  };
}

/**
 * Places an order. MARKET buys fill at lastClose + spread, sells at lastClose;
 * LIMIT/STOP orders rest until the bar walker triggers them.
 */
export function placeOrder(state: EngineState, cfg: EngineConfig, input: PlaceOrderInput, deps: EngineDeps): EngineResult {
  const bid = state.lastClose;
  const time = state.cursorTime;
  if (bid == null || time == null) return fail("NO_PRICE", NO_PRICE_MESSAGE);
  const levels = validatePlacement(state, cfg, input, bid);
  if ("code" in levels) return { ok: false, error: levels };
  const order = buildOrder(input, levels, time, cfg, deps.newId());
  if (input.type !== "MARKET") {
    return ok({ ...state, orders: [...state.orders, order] }, [{ type: "order-placed", order }]);
  }
  const filled = fillOrder(state, cfg, order, levels.entry, time, bid, deps);
  return ok(filled.state, [{ type: "order-placed", order }, ...filled.events, equityEvent(filled.state, cfg)]);
}

export function cancelOrder(state: EngineState, _cfg: EngineConfig, orderId: string): EngineResult {
  if (!state.orders.some((o) => o.id === orderId)) return fail("NOT_FOUND", `Order ${orderId} not found`);
  return ok({ ...state, orders: state.orders.filter((o) => o.id !== orderId) }, [{ type: "order-canceled", orderId }]);
}

function pick<T>(mod: T | undefined, current: T): T {
  return mod === undefined ? current : mod;
}

/** Changes a resting order's price/stopPrice/SL/TP, re-validating all of them. */
export function modifyOrder(state: EngineState, cfg: EngineConfig, orderId: string, mods: OrderMods): EngineResult {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return fail("NOT_FOUND", `Order ${orderId} not found`);
  const bid = state.lastClose;
  if (bid == null || state.cursorTime == null) return fail("NO_PRICE", NO_PRICE_MESSAGE);
  const type = order.type === "STOP" ? "STOP" : "LIMIT";
  const entry = roundLevel(type === "LIMIT" ? pick(mods.price, order.price) : pick(mods.stopPrice, order.stopPrice), cfg);
  const priceError =
    checkPositive(entry, type === "LIMIT" ? "Limit price" : "Stop price") ??
    checkPendingPrice(order.side, type, entry!, bid, askOf(bid, cfg));
  if (priceError) return { ok: false, error: priceError };
  const stopLoss = roundLevel(pick(mods.stopLoss, order.stopLoss), cfg);
  const takeProfit = roundLevel(pick(mods.takeProfit, order.takeProfit), cfg);
  const bracketError = checkBrackets(order.side === "BUY", entry!, stopLoss, takeProfit);
  if (bracketError) return { ok: false, error: bracketError };
  const updated: ReplayOrder = {
    ...order,
    price: type === "LIMIT" ? entry : null,
    stopPrice: type === "STOP" ? entry : null,
    stopLoss,
    takeProfit,
    updatedAt: isoFromUnix(state.cursorTime),
  };
  const orders = state.orders.map((o) => (o.id === orderId ? updated : o));
  return ok({ ...state, orders }, [{ type: "order-modified", order: updated }]);
}

/**
 * Sets/clears a position's SL/TP. Changed levels are validated against the
 * current exit-side price; the first SL ever set becomes the initial stop.
 */
export function modifyPosition(state: EngineState, cfg: EngineConfig, positionId: string, mods: PositionMods): EngineResult {
  const pos = state.positions.find((p) => p.id === positionId);
  if (!pos) return fail("NOT_FOUND", `Position ${positionId} not found`);
  if (state.lastClose == null) return fail("NO_PRICE", NO_PRICE_MESSAGE);
  const stopLoss = roundLevel(mods.stopLoss, cfg);
  const takeProfit = roundLevel(mods.takeProfit, cfg);
  const ref = exitPriceAt(pos.side, state.lastClose, cfg);
  const error = checkBrackets(pos.side === "LONG", ref, stopLoss, takeProfit);
  if (error) return { ok: false, error };
  const nextStop = pick(stopLoss, pos.stopLoss);
  const updated: ReplayPosition = {
    ...pos,
    stopLoss: nextStop,
    takeProfit: pick(takeProfit, pos.takeProfit),
    initialStopLoss: pos.initialStopLoss ?? nextStop,
  };
  const positions = state.positions.map((p) => (p.id === positionId ? updated : p));
  return ok({ ...state, positions }, [{ type: "position-updated", position: updated }]);
}

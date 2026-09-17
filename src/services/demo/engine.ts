import { uid } from "../../lib/uid.ts";
import type { Account, ClosedPosition, Fill, Order, Position, Symbol } from "../schemas.ts";
import { DEMO_CHANNELS, publish } from "./bus.ts";
import { getDemoSymbol } from "./instruments.ts";

/**
 * In-browser paper-trading engine. The single source of truth for the demo
 * account, positions and orders.
 *
 * Order lifecycle mirrors a real broker:
 *   MARKET        fills immediately at the current bid/ask mid.
 *   LIMIT / STOP  rest as PENDING until a tick crosses their trigger price,
 *                 then fill (limits at their price or better, stops at the
 *                 market price that triggered them, i.e. with slippage).
 *
 * Positions are marked to market on every tick and stop-loss / take-profit are
 * evaluated there. State is ephemeral (memory only) — a refresh starts a fresh
 * session.
 */

const STARTING_BALANCE = 100_000;
const DEFAULT_LEVERAGE = 100;
/** Guard against absurd input (fat-finger, scripted abuse) opening 1e308 lots. */
const MAX_QUANTITY = 1_000_000;

/** Engine rejections carry a stable `code` so callers can branch without string matching. */
export class EngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

const account: Account = {
  id: uid(),
  userId: "demo-user",
  templateId: "demo",
  label: "Demo Account",
  status: "ACTIVE",
  balance: STARTING_BALANCE,
  equity: STARTING_BALANCE,
  margin: 0,
  freeMargin: STARTING_BALANCE,
  phase: "LIVE",
  startDate: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isHftMode: false,
  template: { name: "Demo Account", startingBalance: STARTING_BALANCE, instrumentType: "CRYPTO" },
};

const positions: Position[] = [];
const orders: Order[] = [];
const closed: ClosedPosition[] = [];
const fills: Fill[] = [];
const lastPrice = new Map<string, number>();

// ── Numeric helpers ───────────────────────────────────────────────────────

/** Round money to cents so repeated adds don't drift into 0.30000000000000004. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Snap a price to the instrument's tick size (avoids un-representable prices). */
function toTick(price: number, tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return price;
  const snapped = Math.round(price / tickSize) * tickSize;
  // Tick sizes are decimal (0.01, 0.0001); re-round to kill FP dust.
  const decimals = Math.min(10, Math.max(0, Math.ceil(-Math.log10(tickSize))));
  return Number(snapped.toFixed(decimals));
}

// ── Read models (always copies — callers must not mutate engine state) ────

export function getAccount(): Account {
  return { ...account };
}
export function getAccounts(): Account[] {
  return [getAccount()];
}
export function getPositions(): Position[] {
  return positions.map((p) => ({ ...p }));
}
export function getOrders(): Order[] {
  return orders.map((o) => ({ ...o }));
}
export function getClosedPositions(): ClosedPosition[] {
  return closed.map((c) => ({ ...c }));
}
export function getFills(): Fill[] {
  return fills.map((f) => ({ ...f }));
}
export function getLastPrice(symbol: string): number {
  return lastPrice.get(symbol) ?? 0;
}

export function getClosedPositionsSummary(): {
  realizedPnl: number;
  trades: number;
  wins: number;
  losses: number;
} {
  let realizedPnl = 0;
  let wins = 0;
  let losses = 0;
  for (const c of closed) {
    realizedPnl += c.realizedPnl;
    if (c.realizedPnl > 0) wins += 1;
    else if (c.realizedPnl < 0) losses += 1;
  }
  return { realizedPnl: money(realizedPnl), trades: closed.length, wins, losses };
}

// ── Validation ────────────────────────────────────────────────────────────

function requireSymbol(name: string): Symbol {
  const symbol = getDemoSymbol(name);
  if (!symbol) throw new EngineError("UNKNOWN_SYMBOL", `Unknown symbol: ${name}`);
  return symbol;
}

function requireQuantity(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new EngineError("INVALID_QUANTITY", "Quantity must be a positive number");
  }
  if (quantity > MAX_QUANTITY) {
    throw new EngineError("INVALID_QUANTITY", `Quantity exceeds the ${MAX_QUANTITY} limit`);
  }
  return quantity;
}

function requirePrice(price: number | undefined, label: string): number {
  if (price == null || !Number.isFinite(price) || price <= 0) {
    throw new EngineError("INVALID_PRICE", `${label} must be a positive number`);
  }
  return price;
}

function requireMarketPrice(symbolName: string): number {
  const price = lastPrice.get(symbolName);
  if (price == null || !Number.isFinite(price) || price <= 0) {
    throw new EngineError(
      "NO_MARKET_PRICE",
      `No price for ${symbolName} yet — wait for the feed to connect`,
    );
  }
  return price;
}

/**
 * A take-profit must sit beyond the reference price in the profitable
 * direction and a stop-loss behind it, otherwise the position would close on
 * the very next tick.
 */
function validateProtection(
  side: "BUY" | "SELL",
  reference: number,
  takeProfit?: number | null,
  stopLoss?: number | null,
): void {
  const isLong = side === "BUY";
  if (takeProfit != null) {
    if (!Number.isFinite(takeProfit) || takeProfit <= 0) {
      throw new EngineError("INVALID_PRICE", "Take-profit must be a positive number");
    }
    if (isLong ? takeProfit <= reference : takeProfit >= reference) {
      throw new EngineError(
        "INVALID_TAKE_PROFIT",
        `Take-profit must be ${isLong ? "above" : "below"} ${reference}`,
      );
    }
  }
  if (stopLoss != null) {
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
      throw new EngineError("INVALID_PRICE", "Stop-loss must be a positive number");
    }
    if (isLong ? stopLoss >= reference : stopLoss <= reference) {
      throw new EngineError(
        "INVALID_STOP_LOSS",
        `Stop-loss must be ${isLong ? "below" : "above"} ${reference}`,
      );
    }
  }
}

// ── Account maths ─────────────────────────────────────────────────────────

function notional(symbol: string, qty: number, price: number): number {
  const contractSize = getDemoSymbol(symbol)?.contractSize ?? 1;
  return price * qty * contractSize;
}

function marginFor(symbol: string, qty: number, price: number): number {
  return notional(symbol, qty, price) / DEFAULT_LEVERAGE;
}

function pnlOf(pos: Position, price: number): number {
  const contractSize = getDemoSymbol(pos.symbolName)?.contractSize ?? 1;
  const dir = pos.side === "LONG" ? 1 : -1;
  return (price - pos.entryPrice) * pos.quantity * contractSize * dir;
}

function recomputeEquity(): void {
  let unrealized = 0;
  let margin = 0;
  for (const p of positions) {
    const price = lastPrice.get(p.symbolName) ?? p.entryPrice;
    p.currentPrice = price;
    p.unrealizedPnl = pnlOf(p, price);
    unrealized += p.unrealizedPnl;
    margin += p.margin;
  }
  account.margin = money(margin);
  account.equity = money(account.balance + unrealized);
  account.freeMargin = money(account.equity - account.margin);
  account.updatedAt = new Date().toISOString();
}

function emitEquity(): void {
  publish(DEMO_CHANNELS.account, {
    eventType: "EquityUpdated",
    accountId: account.id,
    equity: account.equity,
    balance: account.balance,
    freeMargin: account.freeMargin,
    marginUsed: account.margin,
  });
}

/** Recompute + broadcast once per batch of changes, never per position. */
function settle(): void {
  recomputeEquity();
  emitEquity();
}

// ── Positions ─────────────────────────────────────────────────────────────

function openPosition(
  symbol: string,
  side: "BUY" | "SELL",
  qty: number,
  price: number,
  tp?: number | null,
  sl?: number | null,
): Position {
  const isLong = side === "BUY";
  const pos: Position = {
    id: uid(),
    accountId: account.id,
    symbolName: symbol,
    side: isLong ? "LONG" : "SHORT",
    quantity: qty,
    entryPrice: price,
    currentPrice: price,
    unrealizedPnl: 0,
    margin: money(marginFor(symbol, qty, price)),
    contractSize: getDemoSymbol(symbol)?.contractSize ?? 1,
    openedAt: new Date().toISOString(),
    takeProfit: tp ?? null,
    stopLoss: sl ?? null,
  };
  positions.push(pos);
  publish(DEMO_CHANNELS.positions, {
    eventType: "PositionOpened",
    accountId: account.id,
    positionId: pos.id,
    _entity: { ...pos },
  });
  return pos;
}

function recordClose(pos: Position, qty: number, exitPrice: number, realized: number): void {
  const now = new Date().toISOString();
  closed.unshift({
    id: uid(),
    accountId: account.id,
    symbolName: pos.symbolName,
    side: pos.side,
    quantity: qty,
    entryPrice: pos.entryPrice,
    exitPrice,
    realizedPnl: realized,
    commission: 0,
    swap: 0,
    openedAt: pos.openedAt,
    closedAt: now,
    isPartialClose: qty < pos.quantity,
  });
  fills.unshift({
    id: uid(),
    orderId: pos.id,
    accountId: account.id,
    symbolName: pos.symbolName,
    side: pos.side === "LONG" ? "SELL" : "BUY",
    quantity: qty,
    price: exitPrice,
    commission: 0,
    realizedPnl: realized,
    createdAt: now,
  });
}

/**
 * Close all or part of a position at `exitPrice`. Returns the realized P&L.
 * Does NOT settle — callers batch that so a burst of closes emits once.
 */
function closeAt(pos: Position, qty: number, exitPrice: number): number {
  const idx = positions.indexOf(pos);
  const realized = money(pnlOf({ ...pos, quantity: qty }, exitPrice));
  account.balance = money(account.balance + realized);
  recordClose(pos, qty, exitPrice, realized);

  if (qty >= pos.quantity) {
    if (idx >= 0) positions.splice(idx, 1);
    publish(DEMO_CHANNELS.positions, {
      eventType: "PositionClosed",
      accountId: account.id,
      positionId: pos.id,
    });
  } else {
    // Release margin proportionally to the closed size — otherwise a partial
    // close keeps reserving margin for units that are no longer held.
    const remaining = pos.quantity - qty;
    pos.margin = money(pos.margin * (remaining / pos.quantity));
    pos.quantity = remaining;
    publish(DEMO_CHANNELS.positions, {
      eventType: "PositionUpdated",
      accountId: account.id,
      positionId: pos.id,
      unrealizedPnl: pos.unrealizedPnl,
      quantity: pos.quantity,
      averagePrice: pos.entryPrice,
    });
  }
  return realized;
}

export function closePosition(positionId: string, quantity?: number): { success: boolean } {
  const pos = positions.find((p) => p.id === positionId);
  if (!pos) throw new EngineError("POSITION_NOT_FOUND", "Position not found");

  let qty = pos.quantity;
  if (quantity != null) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new EngineError("INVALID_QUANTITY", "Close quantity must be a positive number");
    }
    qty = Math.min(quantity, pos.quantity);
  }

  const price = lastPrice.get(pos.symbolName) ?? pos.currentPrice ?? pos.entryPrice;
  closeAt(pos, qty, price);
  settle();
  return { success: true };
}

export function closeAllPositions(): { success: boolean } {
  if (positions.length === 0) return { success: true };
  for (const p of [...positions]) {
    const price = lastPrice.get(p.symbolName) ?? p.currentPrice ?? p.entryPrice;
    closeAt(p, p.quantity, price);
  }
  settle();
  return { success: true };
}

export function modifyPosition(
  positionId: string,
  mods: { takeProfit?: number | null; stopLoss?: number | null },
): Position {
  const pos = positions.find((p) => p.id === positionId);
  if (!pos) throw new EngineError("POSITION_NOT_FOUND", "Position not found");

  const reference = lastPrice.get(pos.symbolName) ?? pos.currentPrice ?? pos.entryPrice;
  validateProtection(
    pos.side === "LONG" ? "BUY" : "SELL",
    reference,
    mods.takeProfit,
    mods.stopLoss,
  );

  if (mods.takeProfit !== undefined) pos.takeProfit = mods.takeProfit;
  if (mods.stopLoss !== undefined) pos.stopLoss = mods.stopLoss;
  publish(DEMO_CHANNELS.positions, {
    eventType: "PositionUpdated",
    accountId: account.id,
    positionId,
    unrealizedPnl: pos.unrealizedPnl,
    quantity: pos.quantity,
    averagePrice: pos.entryPrice,
  });
  return { ...pos };
}

// ── Orders ────────────────────────────────────────────────────────────────

export type PlaceOrderArgs = {
  accountId: string;
  symbol: string;
  side: string;
  type: string;
  quantity: number;
  price?: number;
  stopPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
};

export type OrderModifications = {
  price?: number;
  stopPrice?: number;
  quantity?: number;
  takeProfit?: number | null;
  stopLoss?: number | null;
};

const ORDER_TYPES = new Set(["MARKET", "LIMIT", "STOP"]);

function publishOrder(eventType: string, order: Order): void {
  publish(DEMO_CHANNELS.orders, {
    eventType,
    accountId: account.id,
    orderId: order.id,
    _entity: { ...order },
  });
}

function newOrder(
  input: PlaceOrderArgs,
  side: "BUY" | "SELL",
  type: "MARKET" | "LIMIT" | "STOP",
  qty: number,
  limitPrice: number | null,
  stopPrice: number | null,
): Order {
  const now = new Date().toISOString();
  return {
    id: uid(),
    accountId: account.id,
    symbolName: input.symbol,
    side,
    type,
    quantity: qty,
    price: limitPrice,
    stopPrice,
    takeProfit: input.takeProfit ?? null,
    stopLoss: input.stopLoss ?? null,
    status: "PENDING",
    filledQuantity: 0,
    avgFillPrice: null,
    comment: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Fill a resting or market order at `price`, opening the position. */
function fillOrder(order: Order, price: number): void {
  order.status = "FILLED";
  order.filledQuantity = order.quantity;
  order.avgFillPrice = price;
  order.updatedAt = new Date().toISOString();
  publishOrder("OrderFilled", order);
  openPosition(order.symbolName, order.side, order.quantity, price, order.takeProfit, order.stopLoss);
}

export function placeOrder(input: PlaceOrderArgs): Order {
  const symbol = requireSymbol(input.symbol);
  const qty = requireQuantity(input.quantity);

  const side: "BUY" | "SELL" = input.side === "SELL" ? "SELL" : "BUY";
  if (input.side !== "BUY" && input.side !== "SELL") {
    throw new EngineError("INVALID_SIDE", `Unknown order side: ${input.side}`);
  }

  const type = (input.type || "MARKET").toUpperCase();
  if (!ORDER_TYPES.has(type)) {
    throw new EngineError("INVALID_ORDER_TYPE", `Unsupported order type: ${input.type}`);
  }
  const orderType = type as "MARKET" | "LIMIT" | "STOP";

  const market = requireMarketPrice(symbol.name);

  let limitPrice: number | null = null;
  let stopPrice: number | null = null;
  let reference = market;

  if (orderType === "LIMIT") {
    limitPrice = toTick(requirePrice(input.price, "Limit price"), symbol.tickSize);
    reference = limitPrice;
  } else if (orderType === "STOP") {
    stopPrice = toTick(requirePrice(input.stopPrice, "Stop price"), symbol.tickSize);
    reference = stopPrice;
    // A buy stop sits above the market and a sell stop below it; the inverse
    // is a limit order and would trigger instantly.
    if (side === "BUY" ? stopPrice <= market : stopPrice >= market) {
      throw new EngineError(
        "INVALID_STOP_PRICE",
        `A ${side} stop must be ${side === "BUY" ? "above" : "below"} the market (${market})`,
      );
    }
  }

  validateProtection(side, reference, input.takeProfit, input.stopLoss);

  const order = newOrder(input, side, orderType, qty, limitPrice, stopPrice);
  orders.unshift(order);
  publishOrder("OrderPlaced", order);

  if (orderType === "MARKET") {
    const required = marginFor(symbol.name, qty, market);
    if (required > account.freeMargin) {
      order.status = "REJECTED";
      order.updatedAt = new Date().toISOString();
      publishOrder("OrderRejected", order);
      throw new EngineError(
        "INSUFFICIENT_MARGIN",
        `Order needs ${required.toFixed(2)} margin, only ${account.freeMargin.toFixed(2)} free`,
      );
    }
    fillOrder(order, market);
    settle();
    return { ...order };
  }

  // LIMIT / STOP rest until a tick crosses their trigger price.
  const limit = limitPrice;
  if (limit != null && (side === "BUY" ? market <= limit : market >= limit)) {
    // Marketable on arrival — fill straight away at the better of the two.
    const fillPrice = side === "BUY" ? Math.min(market, limit) : Math.max(market, limit);
    fillOrder(order, fillPrice);
    settle();
  }
  return { ...order };
}

export function modifyOrder(orderId: string, mods: OrderModifications): Order {
  const order = orders.find((o) => o.id === orderId);
  if (!order) throw new EngineError("ORDER_NOT_FOUND", "Order not found");
  if (order.status !== "PENDING") {
    throw new EngineError("ORDER_NOT_PENDING", `Cannot modify a ${order.status.toLowerCase()} order`);
  }

  const symbol = requireSymbol(order.symbolName);
  const market = lastPrice.get(order.symbolName) ?? order.price ?? order.stopPrice ?? 0;

  if (mods.quantity !== undefined) order.quantity = requireQuantity(mods.quantity);
  if (mods.price !== undefined && order.type === "LIMIT") {
    order.price = toTick(requirePrice(mods.price, "Limit price"), symbol.tickSize);
  }
  if (mods.stopPrice !== undefined && order.type === "STOP") {
    order.stopPrice = toTick(requirePrice(mods.stopPrice, "Stop price"), symbol.tickSize);
  }

  const reference = order.price ?? order.stopPrice ?? market;
  const takeProfit = mods.takeProfit !== undefined ? mods.takeProfit : order.takeProfit;
  const stopLoss = mods.stopLoss !== undefined ? mods.stopLoss : order.stopLoss;
  validateProtection(order.side, reference, takeProfit, stopLoss);
  order.takeProfit = takeProfit;
  order.stopLoss = stopLoss;

  order.updatedAt = new Date().toISOString();
  publishOrder("OrderModified", order);
  return { ...order };
}

export function cancelOrder(orderId: string): { success: boolean } {
  const order = orders.find((o) => o.id === orderId);
  if (!order) throw new EngineError("ORDER_NOT_FOUND", "Order not found");
  if (order.status !== "PENDING") {
    throw new EngineError(
      "ORDER_NOT_PENDING",
      `Cannot cancel a ${order.status.toLowerCase()} order`,
    );
  }
  order.status = "CANCELED";
  order.updatedAt = new Date().toISOString();
  publishOrder("OrderCanceled", order);
  return { success: true };
}

export function cancelAllOrders(): { success: boolean } {
  for (const order of orders) {
    if (order.status !== "PENDING") continue;
    order.status = "CANCELED";
    order.updatedAt = new Date().toISOString();
    publishOrder("OrderCanceled", order);
  }
  return { success: true };
}

/** Pending orders whose trigger price the current tick has reached. */
function triggeredOrders(symbolName: string, price: number): Order[] {
  return orders.filter((o) => {
    if (o.status !== "PENDING" || o.symbolName !== symbolName) return false;
    if (o.type === "LIMIT" && o.price != null) {
      return o.side === "BUY" ? price <= o.price : price >= o.price;
    }
    if (o.type === "STOP" && o.stopPrice != null) {
      return o.side === "BUY" ? price >= o.stopPrice : price <= o.stopPrice;
    }
    return false;
  });
}

function fillTriggered(symbolName: string, price: number): boolean {
  const triggered = triggeredOrders(symbolName, price);
  let filledAny = false;
  for (const order of triggered) {
    const required = marginFor(symbolName, order.quantity, price);
    if (required > account.freeMargin) {
      // Not enough margin at trigger time — reject rather than fill into a
      // negative-equity position, matching broker behaviour.
      order.status = "REJECTED";
      order.updatedAt = new Date().toISOString();
      publishOrder("OrderRejected", order);
      continue;
    }
    // A limit fills at its price or better; a stop becomes a market order and
    // fills at whatever the tick is, which may be worse (slippage).
    const fillPrice =
      order.type === "LIMIT" && order.price != null
        ? order.side === "BUY"
          ? Math.min(price, order.price)
          : Math.max(price, order.price)
        : price;
    fillOrder(order, fillPrice);
    filledAny = true;
  }
  return filledAny;
}

/**
 * Exit price when SL/TP triggers. A take-profit is a resting limit, so it
 * fills at its own price even if the tick gapped past it; a stop-loss becomes
 * a market order and fills at the tick, which may be worse than the level.
 */
function stopExit(pos: Position, price: number): number | null {
  const isLong = pos.side === "LONG";
  if (pos.takeProfit != null && (isLong ? price >= pos.takeProfit : price <= pos.takeProfit)) {
    return pos.takeProfit;
  }
  if (pos.stopLoss != null && (isLong ? price <= pos.stopLoss : price >= pos.stopLoss)) {
    return price;
  }
  return null;
}

/** Called by the feed on every replayed tick: fills pending orders, marks positions, fires SL/TP. */
export function mark(symbol: string, price: number): void {
  if (!Number.isFinite(price) || price <= 0) return;
  lastPrice.set(symbol, price);

  let changed = fillTriggered(symbol, price);

  // Iterate a snapshot: closing a position mutates `positions` mid-loop.
  for (const pos of positions.filter((p) => p.symbolName === symbol)) {
    const exit = stopExit(pos, price);
    if (exit != null) {
      closeAt(pos, pos.quantity, exit);
      changed = true;
      continue;
    }
    pos.currentPrice = price;
    pos.unrealizedPnl = pnlOf(pos, price);
    changed = true;
    publish(DEMO_CHANNELS.positions, {
      eventType: "PositionUpdated",
      accountId: account.id,
      positionId: pos.id,
      unrealizedPnl: pos.unrealizedPnl,
      quantity: pos.quantity,
      averagePrice: pos.entryPrice,
    });
  }

  if (changed) settle();
}

/** Test seam: reset every engine mutable so suites start from a clean account. */
export function __resetForTests(): void {
  positions.length = 0;
  orders.length = 0;
  closed.length = 0;
  fills.length = 0;
  lastPrice.clear();
  account.balance = STARTING_BALANCE;
  account.equity = STARTING_BALANCE;
  account.margin = 0;
  account.freeMargin = STARTING_BALANCE;
}

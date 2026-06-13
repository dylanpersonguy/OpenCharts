import type { Account, ClosedPosition, Fill, Order, Position } from "../schemas.ts";
import { publish } from "./bus.ts";
import { getDemoSymbol } from "./instruments.ts";

/**
 * In-browser paper-trading engine. The single source of truth for the demo
 * account, positions and orders. Market orders fill instantly at the latest
 * replayed price; positions are marked-to-market on every tick. State is
 * ephemeral (memory only) — a refresh starts a fresh demo session.
 */

const STARTING_BALANCE = 100_000;
const DEFAULT_LEVERAGE = 100;

const account: Account = {
  id: crypto.randomUUID(),
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

function notional(symbol: string, qty: number, price: number): number {
  const contractSize = getDemoSymbol(symbol)?.contractSize ?? 1;
  return price * qty * contractSize;
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
  account.margin = margin;
  account.equity = account.balance + unrealized;
  account.freeMargin = account.equity - margin;
  account.updatedAt = new Date().toISOString();
}

function emitEquity(): void {
  publish("account", {
    eventType: "EquityUpdated",
    accountId: account.id,
    equity: account.equity,
    balance: account.balance,
    freeMargin: account.freeMargin,
    marginUsed: account.margin,
  });
}

function openPosition(symbol: string, side: string, qty: number, price: number, tp?: number, sl?: number): Position {
  const isLong = side === "BUY";
  const pos: Position = {
    id: crypto.randomUUID(),
    accountId: account.id,
    symbolName: symbol,
    side: isLong ? "LONG" : "SHORT",
    quantity: qty,
    entryPrice: price,
    currentPrice: price,
    unrealizedPnl: 0,
    margin: notional(symbol, qty, price) / DEFAULT_LEVERAGE,
    contractSize: getDemoSymbol(symbol)?.contractSize ?? 1,
    openedAt: new Date().toISOString(),
    takeProfit: tp ?? null,
    stopLoss: sl ?? null,
  };
  positions.push(pos);
  publish("positions", { eventType: "PositionOpened", accountId: account.id, positionId: pos.id, _entity: { ...pos } });
  return pos;
}

function makeFilledOrder(input: PlaceOrderArgs, price: number): Order {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    accountId: account.id,
    symbolName: input.symbol,
    side: input.side === "BUY" ? "BUY" : "SELL",
    type: (input.type as Order["type"]) ?? "MARKET",
    quantity: input.quantity,
    price: input.price ?? null,
    stopPrice: input.stopPrice ?? null,
    takeProfit: input.takeProfit ?? null,
    stopLoss: input.stopLoss ?? null,
    status: "FILLED",
    filledQuantity: input.quantity,
    avgFillPrice: price,
    comment: null,
    createdAt: now,
    updatedAt: now,
  };
}

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

/** Market orders fill instantly at the latest price; an open position is created. */
export function placeOrder(input: PlaceOrderArgs): Order {
  const price = input.price ?? lastPrice.get(input.symbol) ?? 0;
  const order = makeFilledOrder(input, price);
  orders.unshift(order);
  publish("orders", { eventType: "OrderPlaced", accountId: account.id, orderId: order.id, _entity: { ...order } });
  publish("orders", { eventType: "OrderFilled", accountId: account.id, orderId: order.id, _entity: { ...order } });
  openPosition(input.symbol, input.side, input.quantity, price, input.takeProfit, input.stopLoss);
  recomputeEquity();
  emitEquity();
  return order;
}

function recordClose(pos: Position, qty: number, exitPrice: number, realized: number): void {
  const now = new Date().toISOString();
  closed.unshift({
    id: crypto.randomUUID(),
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
    id: crypto.randomUUID(),
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

export function closePosition(positionId: string, quantity?: number): { success: boolean } {
  const idx = positions.findIndex((p) => p.id === positionId);
  if (idx < 0) return { success: false };
  const pos = positions[idx]!;
  const price = lastPrice.get(pos.symbolName) ?? pos.entryPrice;
  const qty = quantity && quantity < pos.quantity ? quantity : pos.quantity;
  const realized = pnlOf({ ...pos, quantity: qty }, price);
  account.balance += realized;
  recordClose(pos, qty, price, realized);
  if (qty >= pos.quantity) {
    positions.splice(idx, 1);
    publish("positions", { eventType: "PositionClosed", accountId: account.id, positionId });
  } else {
    pos.quantity -= qty;
    publish("positions", { eventType: "PositionUpdated", accountId: account.id, positionId, quantity: pos.quantity });
  }
  recomputeEquity();
  emitEquity();
  return { success: true };
}

export function closeAllPositions(): { success: boolean } {
  for (const p of [...positions]) closePosition(p.id);
  return { success: true };
}

export function modifyPosition(
  positionId: string,
  mods: { takeProfit?: number | null; stopLoss?: number | null },
): Position | undefined {
  const pos = positions.find((p) => p.id === positionId);
  if (!pos) return undefined;
  if (mods.takeProfit !== undefined) pos.takeProfit = mods.takeProfit;
  if (mods.stopLoss !== undefined) pos.stopLoss = mods.stopLoss;
  publish("positions", {
    eventType: "PositionUpdated",
    accountId: account.id,
    positionId,
    unrealizedPnl: pos.unrealizedPnl,
    quantity: pos.quantity,
    averagePrice: pos.entryPrice,
  });
  return { ...pos };
}

export function cancelOrder(orderId: string): { success: boolean } {
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx >= 0) orders.splice(idx, 1);
  publish("orders", { eventType: "OrderCanceled", accountId: account.id, orderId });
  return { success: true };
}

function checkStops(pos: Position, price: number): boolean {
  const hitTp = pos.takeProfit != null && (pos.side === "LONG" ? price >= pos.takeProfit : price <= pos.takeProfit);
  const hitSl = pos.stopLoss != null && (pos.side === "LONG" ? price <= pos.stopLoss : price >= pos.stopLoss);
  return hitTp || hitSl;
}

/** Called by the feed on every replayed tick: marks positions, fires SL/TP. */
export function mark(symbol: string, price: number): void {
  lastPrice.set(symbol, price);
  const affected = positions.filter((p) => p.symbolName === symbol);
  if (affected.length === 0) return;
  for (const pos of affected) {
    if (checkStops(pos, price)) {
      closePosition(pos.id);
      continue;
    }
    pos.currentPrice = price;
    pos.unrealizedPnl = pnlOf(pos, price);
    publish("positions", {
      eventType: "PositionUpdated",
      accountId: account.id,
      positionId: pos.id,
      unrealizedPnl: pos.unrealizedPnl,
      quantity: pos.quantity,
      averagePrice: pos.entryPrice,
    });
  }
  recomputeEquity();
  emitEquity();
}

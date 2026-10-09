import type { Account, ClosedPosition, Order, Position } from "../schemas.ts";
import type { PlaceOrderArgs } from "./engine.ts";

/**
 * Routes trading calls to a registered replay (backtesting) account when the
 * account, position or order belongs to it; otherwise callers fall through to
 * the live demo engine. The UI keeps calling the same `api` methods either way.
 */

export interface OrderModifications {
  price?: number;
  stopPrice?: number;
  quantity?: number;
  takeProfit?: number | null;
  stopLoss?: number | null;
}

export interface PositionModifications {
  takeProfit?: number | null;
  stopLoss?: number | null;
}

/** The trading surface a replay session exposes to the demo api. Rejected promises carry user-facing messages. */
export interface TradingBackend {
  readonly accountId: string;
  placeOrder(input: PlaceOrderArgs): Promise<Order>;
  cancelOrder(orderId: string): Promise<{ success: boolean }>;
  modifyOrder(orderId: string, mods: OrderModifications): Promise<Order | undefined>;
  getOrders(): Order[];
  getPositions(): Position[];
  closePosition(positionId: string, quantity?: number): Promise<{ success: boolean }>;
  closeAllPositions(): Promise<{ success: boolean }>;
  modifyPosition(positionId: string, mods: PositionModifications): Promise<Position | undefined>;
  getClosedPositions(): ClosedPosition[];
  getAccount(): Account;
  ownsPosition(positionId: string): boolean;
  ownsOrder(orderId: string): boolean;
}

let backends: ReadonlyMap<string, TradingBackend> = new Map();

/** Register a replay backend; returns an unregister function. Re-registering the same account replaces it. */
export function registerReplayBackend(backend: TradingBackend): () => void {
  backends = new Map(backends).set(backend.accountId, backend);
  return () => {
    if (backends.get(backend.accountId) !== backend) return;
    const next = new Map(backends);
    next.delete(backend.accountId);
    backends = next;
  };
}

export function backendForAccount(accountId: string | null | undefined): TradingBackend | null {
  return accountId ? (backends.get(accountId) ?? null) : null;
}

export function backendForPosition(positionId: string): TradingBackend | null {
  for (const b of backends.values()) if (b.ownsPosition(positionId)) return b;
  return null;
}

export function backendForOrder(orderId: string): TradingBackend | null {
  for (const b of backends.values()) if (b.ownsOrder(orderId)) return b;
  return null;
}

/** Test helper: drop every registration. */
export function resetReplayBackends(): void {
  backends = new Map();
}

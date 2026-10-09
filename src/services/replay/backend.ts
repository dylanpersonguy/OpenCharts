import type { PlaceOrderArgs } from "../demo/engine.ts";
import type {
  OrderModifications,
  PositionModifications,
  TradingBackend,
} from "../demo/replay-router.ts";
import type { Account, ClosedPosition, Order, Position } from "../schemas.ts";
import { accountSnapshot } from "./engine/equity.ts";
import type { ReplayEngine } from "./engine/create-engine.ts";
import type { ClosedTrade, EngineConfig, EngineResult, PlaceOrderInput } from "./engine/types.ts";
import type { ReplaySession } from "./session-types.ts";

/** Adapts a replay engine to the demo api's trading surface (see demo/replay-router.ts). */

const iso = (sec: number) => new Date(sec * 1000).toISOString();

export function toClosedPosition(t: ClosedTrade, accountId: string): ClosedPosition {
  return {
    id: t.id,
    accountId,
    symbolName: t.symbol,
    side: t.side,
    quantity: t.quantity,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    realizedPnl: t.netPnl,
    commission: t.commission,
    swap: 0,
    openedAt: iso(t.entryTime),
    closedAt: iso(t.exitTime),
    isPartialClose: t.isPartial,
  };
}

function toEngineInput(input: PlaceOrderArgs): PlaceOrderInput {
  return {
    side: input.side === "SELL" ? "SELL" : "BUY",
    type: input.type === "LIMIT" || input.type === "STOP" ? input.type : "MARKET",
    quantity: input.quantity,
    // The live UI sends a stop's trigger as `price` in some paths (mobile panel).
    price: input.type === "LIMIT" ? input.price : undefined,
    stopPrice: input.type === "STOP" ? (input.stopPrice ?? input.price) : undefined,
    takeProfit: input.takeProfit,
    stopLoss: input.stopLoss,
  };
}

/** Resolve an engine result into a promise; rejections carry the engine's user-facing message. */
function settle<T>(result: EngineResult, pick: (r: Extract<EngineResult, { ok: true }>) => T): Promise<T> {
  return result.ok ? Promise.resolve(pick(result)) : Promise.reject(new Error(result.error.message));
}

export function createReplayBackend(
  engine: ReplayEngine,
  cfg: EngineConfig,
  session: Pick<ReplaySession, "name" | "startingBalance" | "createdAt">,
): TradingBackend {
  const accountId = cfg.accountId;
  const state = () => engine.getState();

  const getAccount = (): Account => {
    const snap = accountSnapshot(state(), cfg);
    return {
      id: accountId,
      userId: "demo-user",
      templateId: "replay",
      label: session.name,
      status: "ACTIVE",
      balance: snap.balance,
      equity: snap.equity,
      margin: snap.margin,
      freeMargin: snap.freeMargin,
      phase: "REPLAY",
      startDate: session.createdAt,
      createdAt: session.createdAt,
      updatedAt: session.createdAt,
      isHftMode: false,
      template: { name: "Backtest", startingBalance: session.startingBalance, instrumentType: "CRYPTO" },
    };
  };

  return {
    accountId,
    placeOrder: (input) => {
      const result = engine.placeOrder(toEngineInput(input));
      return settle(result, (r) => {
        const placed = r.events.find((e) => e.type === "order-placed" || e.type === "order-filled");
        return (placed && "order" in placed ? placed.order : undefined) as Order;
      });
    },
    cancelOrder: (orderId) => settle(engine.cancelOrder(orderId), () => ({ success: true })),
    modifyOrder: (orderId, mods: OrderModifications) =>
      settle(
        engine.modifyOrder(orderId, {
          price: mods.price,
          stopPrice: mods.stopPrice,
          takeProfit: mods.takeProfit,
          stopLoss: mods.stopLoss,
        }),
        (r) => r.state.orders.find((o) => o.id === orderId) as Order | undefined,
      ),
    getOrders: () => [...state().orders],
    getPositions: () => [...state().positions] as Position[],
    closePosition: (positionId, quantity) =>
      settle(engine.closePosition(positionId, quantity), () => ({ success: true })),
    closeAllPositions: () => settle(engine.closeAll(), () => ({ success: true })),
    modifyPosition: (positionId, mods: PositionModifications) =>
      settle(engine.modifyPosition(positionId, mods), (r) => r.state.positions.find((p) => p.id === positionId)),
    getClosedPositions: () =>
      [...state().closedTrades].sort((a, b) => b.exitTime - a.exitTime).map((t) => toClosedPosition(t, accountId)),
    getAccount,
    ownsPosition: (id) => state().positions.some((p) => p.id === id),
    ownsOrder: (id) => state().orders.some((o) => o.id === id),
  };
}

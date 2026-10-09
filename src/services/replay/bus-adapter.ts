import { publish } from "../demo/bus.ts";
import type { ReplayEngine } from "./engine/create-engine.ts";
import type { EngineEvent } from "./engine/types.ts";

/**
 * Bridges replay engine events onto the in-process bus using the same event
 * shapes the live demo engine publishes, so MarketDataBridge patches the
 * replay account's query caches exactly like a live account's.
 */

/** Above this many events in one advance (a long jump), refetch instead of replaying each event. */
export const BULK_EVENT_THRESHOLD = 200;

function publishOne(ev: EngineEvent, accountId: string): void {
  switch (ev.type) {
    case "order-placed":
      publish("orders", { eventType: "OrderPlaced", accountId, orderId: ev.order.id, _entity: ev.order });
      return;
    case "order-filled":
      publish("orders", { eventType: "OrderFilled", accountId, orderId: ev.order.id, _entity: ev.order });
      return;
    case "order-canceled":
      publish("orders", { eventType: "OrderCanceled", accountId, orderId: ev.orderId });
      return;
    case "order-modified":
      // No `_entity` upsert path for modifications — the bridge refetches the order list.
      publish("orders", { eventType: "OrderModified", accountId, orderId: ev.order.id });
      return;
    case "position-opened":
      publish("positions", { eventType: "PositionOpened", accountId, positionId: ev.position.id, _entity: ev.position });
      return;
    case "position-updated":
    case "position-partially-closed":
      publish("positions", {
        eventType: "PositionUpdated",
        accountId,
        positionId: ev.position.id,
        unrealizedPnl: ev.position.unrealizedPnl,
        quantity: ev.position.quantity,
        averagePrice: ev.position.entryPrice,
        currentPrice: ev.position.currentPrice,
        stopLoss: ev.position.stopLoss,
        takeProfit: ev.position.takeProfit,
      });
      return;
    case "position-closed":
      publish("positions", { eventType: "PositionClosed", accountId, positionId: ev.position.id });
      return;
    case "equity":
      publish("account", {
        eventType: "EquityUpdated",
        accountId,
        equity: ev.equity,
        balance: ev.balance,
        freeMargin: ev.freeMargin,
        marginUsed: ev.margin,
      });
      return;
  }
}

/**
 * Subscribe the bus to an engine. `onBulk` is called instead of per-event
 * publishing when a single advance produced a flood of events.
 */
export function bindEngineToBus(engine: ReplayEngine, accountId: string, onBulk: () => void): () => void {
  return engine.subscribe((events) => {
    if (events.length > BULK_EVENT_THRESHOLD) {
      onBulk();
      return;
    }
    // Position snapshots repeat every bar; only the last one per position matters.
    const lastUpdate = new Map<string, number>();
    let lastEquity = -1;
    events.forEach((ev, i) => {
      if (ev.type === "position-updated") lastUpdate.set(ev.position.id, i);
      if (ev.type === "equity") lastEquity = i;
    });
    events.forEach((ev, i) => {
      if (ev.type === "position-updated" && lastUpdate.get(ev.position.id) !== i) return;
      if (ev.type === "equity" && i !== lastEquity) return;
      publishOne(ev, accountId);
    });
  });
}

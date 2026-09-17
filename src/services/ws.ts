import { getAdapter, hasAdapter, onAdapterChange } from "../adapter/registry.ts";
import type { ConnectionState, MarketEvent, TradingEvent, Unsubscribe } from "../adapter/types.ts";
import { publish, subscribeChannel, type ChannelHandler } from "./demo/bus.ts";

/**
 * Streaming client.
 *
 * Adapters expose one `subscribe` per concern (market data, trading). The
 * terminal consumes four named channels — `market-data`, `positions`, `orders`
 * and `account` — so this translates between the two, and owns the connection
 * lifecycle. It exposes the same surface the app has always used, so no
 * consumer had to change when the adapter layer landed.
 */

export type { ConnectionState };
export type WsHandler = ChannelHandler;

const TRADING_EVENT_CHANNEL: Record<TradingEvent["type"], string> = {
  "position.opened": "positions",
  "position.updated": "positions",
  "position.closed": "positions",
  "order.placed": "orders",
  "order.filled": "orders",
  "order.canceled": "orders",
  "order.rejected": "orders",
  "account.updated": "account",
};

/** Public event types → the legacy names the bridge and store match on. */
const LEGACY_EVENT_NAME: Record<TradingEvent["type"], string> = {
  "position.opened": "PositionOpened",
  "position.updated": "PositionUpdated",
  "position.closed": "PositionClosed",
  "order.placed": "OrderPlaced",
  "order.filled": "OrderFilled",
  "order.canceled": "OrderCanceled",
  "order.rejected": "OrderRejected",
  "account.updated": "EquityUpdated",
};

function toChannelEvent(event: TradingEvent): Record<string, unknown> {
  const base = { eventType: LEGACY_EVENT_NAME[event.type], accountId: event.accountId };
  if (event.type === "account.updated") {
    return {
      ...base,
      equity: event.equity,
      balance: event.balance,
      freeMargin: event.freeMargin,
      marginUsed: event.marginUsed,
    };
  }
  if (event.type.startsWith("order.")) {
    const order = event as Extract<TradingEvent, { orderId: string }>;
    return { ...base, orderId: order.orderId, _entity: order.entity };
  }
  const position = event as Extract<TradingEvent, { positionId: string }>;
  return {
    ...base,
    positionId: position.positionId,
    _entity: "entity" in position ? position.entity : undefined,
    unrealizedPnl: "unrealizedPnl" in position ? position.unrealizedPnl : undefined,
    quantity: "quantity" in position ? position.quantity : undefined,
    averagePrice: "averagePrice" in position ? position.averagePrice : undefined,
  };
}

class AdapterWsClient {
  private _state: ConnectionState = "disconnected";
  private stateListeners = new Set<(s: ConnectionState) => void>();
  private teardown: Unsubscribe[] = [];
  private connected = false;

  constructor() {
    // Swapping the adapter mid-session reconnects the streams.
    onAdapterChange(() => {
      if (!this.connected) return;
      this.detach();
      this.attach();
    });
  }

  get state(): ConnectionState {
    return this._state;
  }

  private setState(next: ConnectionState): void {
    if (this._state === next) return;
    this._state = next;
    for (const cb of [...this.stateListeners]) {
      try {
        cb(next);
      } catch (err) {
        console.error("[ws] connection listener threw", err);
      }
    }
  }

  private attach(): void {
    if (!hasAdapter()) return;
    const adapter = getAdapter();

    this.teardown.push(
      adapter.marketData.subscribe((event: MarketEvent) => {
        if (event.type === "tick") {
          publish("market-data", {
            eventType: "MarketTick",
            symbol: event.symbol,
            bid: event.bid,
            ask: event.ask,
            occurredAt: event.timestamp ?? Date.now(),
          });
          return;
        }
        publish("market-data", {
          eventType: "CandleUpdate",
          symbol: event.symbol,
          timeframe: event.timeframe,
          open: event.open,
          high: event.high,
          low: event.low,
          close: event.close,
          volume: event.volume,
          timestamp: event.timestamp,
        });
      }),
    );

    if (adapter.trading) {
      this.teardown.push(
        adapter.trading.subscribe((event: TradingEvent) => {
          const channel = TRADING_EVENT_CHANNEL[event.type];
          if (channel) publish(channel, toChannelEvent(event));
        }),
      );
    }

    if (adapter.marketData.onConnectionChange) {
      this.teardown.push(adapter.marketData.onConnectionChange((s) => this.setState(s)));
    }

    void adapter.marketData.connect?.();

    // Sources that do not report health are treated as connected once attached.
    if (!adapter.marketData.onConnectionChange) {
      setTimeout(() => this.setState("connected"), 0);
    }
  }

  private detach(): void {
    for (const off of this.teardown.splice(0)) {
      try {
        off();
      } catch (err) {
        console.error("[ws] failed to unsubscribe", err);
      }
    }
  }

  connect(_token?: string): void {
    if (this.connected) return;
    this.connected = true;
    this.setState("connecting");
    this.attach();
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.detach();
    if (hasAdapter()) getAdapter().marketData.disconnect?.();
    this.setState("disconnected");
  }

  reauthenticate(_token: string): void {
    // Identity belongs to the host application; nothing to refresh here.
  }

  subscribe(channel: string, handler: WsHandler): () => void {
    return subscribeChannel(channel, handler);
  }

  subscribeAccounts(_accountIds: string[]): void {
    // Account events arrive on the "account" channel for whichever accounts the
    // gateway reports on; no per-account registration in the contract.
  }

  setSymbolInterest(symbols: string[]): void {
    if (!hasAdapter()) return;
    getAdapter().marketData.setSymbolInterest?.(symbols);
  }

  onStateChange(cb: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(cb);
    cb(this._state);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  /** Push an event onto a channel directly (used by tests and tooling). */
  emit(channel: string, event: unknown): void {
    publish(channel, event);
  }
}

export const wsClient = new AdapterWsClient();

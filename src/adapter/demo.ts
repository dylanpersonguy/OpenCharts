import { safeStorage } from "../lib/safe-storage.ts";
import { DEMO_CHANNELS, subscribeChannel } from "../services/demo/bus.ts";
import { getHistory } from "../services/demo/candles.ts";
import * as engine from "../services/demo/engine.ts";
import { startDemoFeed, stopDemoFeed } from "../services/demo/feed.ts";
import { DEMO_SYMBOLS } from "../services/demo/instruments.ts";
import type { Order, PlaceOrderInput, Position } from "../services/schemas.ts";
import type {
  CandleRequest,
  MarketEvent,
  OpenChartsAdapter,
  OrderModification,
  PositionModification,
  TradingEvent,
  Unsubscribe,
} from "./types.ts";

/**
 * The bundled demo backend, expressed through the public adapter contract.
 *
 * It is the reference implementation: real historical OHLC replayed as a tick
 * stream, and an in-browser paper-trading engine. Everything the terminal shows
 * comes through the same interface a third-party adapter implements, so if the
 * demo can be built on this contract, so can a real backend.
 */

// The demo layer publishes on an internal bus using the legacy event shapes;
// these translate them to the public event types.
type LegacyPositionEvent = {
  eventType: string;
  accountId: string;
  positionId: string;
  _entity?: Position;
  unrealizedPnl?: number;
  quantity?: number;
  averagePrice?: number;
};

type LegacyOrderEvent = {
  eventType: string;
  accountId: string;
  orderId: string;
  _entity?: Order;
};

type LegacyAccountEvent = {
  eventType: string;
  accountId: string;
  equity?: number;
  balance?: number;
  freeMargin?: number;
  marginUsed?: number;
};

type LegacyTickEvent = {
  eventType: string;
  symbol: string;
  bid: number;
  ask: number;
  occurredAt?: number;
};

const POSITION_EVENTS: Record<string, TradingEvent["type"]> = {
  PositionOpened: "position.opened",
  PositionUpdated: "position.updated",
  PositionClosed: "position.closed",
};

const ORDER_EVENTS: Record<string, TradingEvent["type"]> = {
  OrderPlaced: "order.placed",
  OrderFilled: "order.filled",
  OrderCanceled: "order.canceled",
  OrderRejected: "order.rejected",
  OrderModified: "order.placed",
};

export function createDemoAdapter(): OpenChartsAdapter {
  return {
    name: "demo",

    marketData: {
      getSymbols: () => Promise.resolve(DEMO_SYMBOLS),

      getCandles: ({ symbol, timeframe, limit, fromMs, toMs }: CandleRequest) =>
        getHistory(
          symbol,
          timeframe,
          limit,
          fromMs != null || toMs != null ? { fromMs, toMs } : undefined,
        ),

      getQuote: (symbol: string) => {
        const price = engine.getLastPrice(symbol);
        if (!price) return Promise.resolve(null);
        return Promise.resolve({ symbol, bid: price, ask: price, timestamp: Date.now() });
      },

      connect: () => startDemoFeed(),
      disconnect: () => stopDemoFeed(),

      subscribe: (handler: (event: MarketEvent) => void): Unsubscribe =>
        subscribeChannel(DEMO_CHANNELS.ticks, (raw) => {
          const event = raw as LegacyTickEvent;
          if (event.eventType !== "MarketTick") return;
          handler({
            type: "tick",
            symbol: event.symbol,
            bid: event.bid,
            ask: event.ask,
            timestamp: event.occurredAt,
          });
        }),
    },

    trading: {
      getAccounts: () => Promise.resolve(engine.getAccounts()),
      getPositions: () => Promise.resolve(engine.getPositions()),
      getOrders: (_accountId: string, status?: string) => {
        const all = engine.getOrders();
        return Promise.resolve(status ? all.filter((o) => o.status === status) : all);
      },
      getClosedPositions: (_accountId: string, page = 1) => {
        const rows = engine.getClosedPositions();
        const pageSize = 50;
        const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
        const start = (safePage - 1) * pageSize;
        return Promise.resolve({
          data: rows.slice(start, start + pageSize),
          total: rows.length,
          page: safePage,
          pageSize,
          totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
        });
      },

      // The engine throws EngineError with a trader-readable message. These are
      // `async` so that surfaces as a rejected promise: the contract says every
      // method returns one, and a synchronous throw would skip a caller's
      // `.catch()` entirely.
      placeOrder: async (input: PlaceOrderInput) =>
        engine.placeOrder(input as engine.PlaceOrderArgs),
      modifyOrder: async (orderId: string, modification: OrderModification) =>
        engine.modifyOrder(orderId, modification),
      cancelOrder: async (orderId: string) => {
        engine.cancelOrder(orderId);
      },
      cancelAllOrders: async () => {
        engine.cancelAllOrders();
      },
      closePosition: async (positionId: string, quantity?: number) => {
        engine.closePosition(positionId, quantity);
      },
      closeAllPositions: async () => {
        engine.closeAllPositions();
      },
      modifyPosition: async (positionId: string, modification: PositionModification) =>
        engine.modifyPosition(positionId, modification),

      subscribe: (handler: (event: TradingEvent) => void): Unsubscribe => {
        const unsubPositions = subscribeChannel(DEMO_CHANNELS.positions, (raw) => {
          const event = raw as LegacyPositionEvent;
          const type = POSITION_EVENTS[event.eventType];
          if (!type) return;
          handler({
            type,
            accountId: event.accountId,
            positionId: event.positionId,
            entity: event._entity,
            unrealizedPnl: event.unrealizedPnl,
            quantity: event.quantity,
            averagePrice: event.averagePrice,
          } as TradingEvent);
        });

        const unsubOrders = subscribeChannel(DEMO_CHANNELS.orders, (raw) => {
          const event = raw as LegacyOrderEvent;
          const type = ORDER_EVENTS[event.eventType];
          if (!type) return;
          handler({
            type,
            accountId: event.accountId,
            orderId: event.orderId,
            entity: event._entity,
          } as TradingEvent);
        });

        const unsubAccount = subscribeChannel(DEMO_CHANNELS.account, (raw) => {
          const event = raw as LegacyAccountEvent;
          if (event.eventType !== "EquityUpdated") return;
          handler({
            type: "account.updated",
            accountId: event.accountId,
            equity: event.equity,
            balance: event.balance,
            freeMargin: event.freeMargin,
            marginUsed: event.marginUsed,
          });
        });

        return () => {
          unsubPositions();
          unsubOrders();
          unsubAccount();
        };
      },
    },

    // Drawings, templates and journal entries persist to this device. Swap in
    // your own driver to keep them with the user's account instead.
    storage: {
      get: (key: string) => safeStorage.getItem(key),
      set: (key: string, value: string) => {
        safeStorage.setItem(key, value);
      },
      remove: (key: string) => {
        safeStorage.removeItem(key);
      },
    },
  };
}

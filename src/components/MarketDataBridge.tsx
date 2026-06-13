import { useEffect, startTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore, useTradingStore } from "../services/store.tsx";
import { wsClient } from "../services/ws.ts";
import { queryKeys } from "../services/queries.ts";
import type { Position, Order } from "../services/schemas.ts";

/**
 * Global WebSocket subscriber. Owns all market-data / account / positions /
 * orders subscriptions for the app.
 *
 * Why: Subscriptions used to live inside Layout / MobileShell, both rendered
 * BELOW the global ErrorBoundary. When any subtree threw (e.g. a lazy chunk
 * failed to load), ErrorBoundary unmounted the route tree → useEffect cleanups
 * ran → unsub() removed the market-data handler → every subsequent tick was
 * silently dropped. Hosting the subscription here, ABOVE the ErrorBoundary,
 * means subtree errors no longer kill the live data stream.
 */

type MarketDataEvent =
  | {
      eventType: "MarketTick";
      symbol: string;
      bid: number;
      ask: number;
      occurredAt?: number | string;
    }
  | {
      eventType: "CandleUpdate";
      symbol: string;
      timeframe: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      timestamp: number;
    }
  | { eventType: "CandleClosed"; symbol: string; timeframe: string }
  | {
      eventType: "ReplayStateChanged";
      action?: string;
      speed?: number;
      userId?: string;
      cursorTimestamp?: number;
    };

// Position WS event types — enriched server-side with _entity for direct cache updates
type PositionWsEvent = {
  eventType: "PositionOpened" | "PositionUpdated" | "PositionClosed";
  accountId: string;
  positionId: string;
  // PositionUpdated fields (surgical patch — no DB lookup needed)
  unrealizedPnl?: number;
  quantity?: number;
  averagePrice?: number;
  // Attached by ws-handler enrichment (PositionOpened only)
  _entity?: Position;
};

type OrderWsEvent = {
  eventType: "OrderPlaced" | "OrderFilled" | "OrderCanceled" | "OrderAccepted" | string;
  accountId: string;
  orderId?: string;
  // Attached by ws-handler enrichment
  _entity?: Order;
};

// ── Coalescing invalidation ───────────────────────────────────────
// Module-level debounce map: collapses rapid-fire WS events (e.g. 5 fills
// in 100ms) into a single REST refetch per key, eliminating race conditions.
const _invalidateTimers = new Map<string, ReturnType<typeof setTimeout>>();

function coalesceInvalidation(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: readonly unknown[],
  delayMs = 150,
) {
  const key = JSON.stringify(queryKey);
  const existing = _invalidateTimers.get(key);
  if (existing) clearTimeout(existing);
  _invalidateTimers.set(
    key,
    setTimeout(() => {
      _invalidateTimers.delete(key);
      queryClient.invalidateQueries({ queryKey: queryKey as unknown[] });
    }, delayMs),
  );
}

// ── PositionOpened 50ms batch buffer (G) ─────────────────────────────────
// HFT burst fills emit multiple PositionOpened events in rapid succession.
// Instead of calling setQueryData once per event (N renders), we collect all
// entities that arrive within 50ms for the same account and flush them in one
// setQueryData call → one render cycle.
//
// Also handles optimistic placeholder cleanup (D): when the real entity
// arrives, any optimistic position with the same symbolName+side whose ID
// starts with "opt-" is evicted so there's no duplicate flash.
const _positionBatchBuffers = new Map<string, Position[]>();
const _positionBatchTimers = new Map<string, ReturnType<typeof setTimeout>>();

function bufferPositionOpened(
  accountId: string,
  entity: Position,
  queryClient: ReturnType<typeof useQueryClient>,
  posKey: readonly unknown[],
) {
  const existing = _positionBatchBuffers.get(accountId) ?? [];
  existing.push(entity);
  _positionBatchBuffers.set(accountId, existing);

  // Reset the flush timer on each new arrival
  const prev = _positionBatchTimers.get(accountId);
  if (prev) clearTimeout(prev);
  _positionBatchTimers.set(
    accountId,
    setTimeout(() => {
      const entities = _positionBatchBuffers.get(accountId) ?? [];
      _positionBatchBuffers.delete(accountId);
      _positionBatchTimers.delete(accountId);
      if (entities.length === 0) return;

      startTransition(() => {
        queryClient.setQueryData<Position[]>(posKey, (old) => {
          let next = [...(old ?? [])];
          for (const e of entities) {
            // Evict any optimistic placeholder for this symbol+side (D cleanup)
            next = next.filter(
              (p) => !(p.id.startsWith("opt-") && p.symbolName === e.symbolName && p.side === e.side),
            );
            // Upsert: replace if already present (safety for duplicate events), else append
            const idx = next.findIndex((p) => p.id === e.id);
            if (idx >= 0) {
              const arr = [...next];
              arr[idx] = e;
              next = arr;
            } else {
              next = [...next, e];
            }
          }
          return next;
        });
      });
    }, 50),
  );
}

type AccountWsEvent = {
  eventType: string;
  accountId?: string;
  equity?: number;
  balance?: number;
  freeMargin?: number;
  marginUsed?: number;
};

function toTimestamp(value: number | string | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }
  return Date.now();
}

export function MarketDataBridge() {
  const updateTick = useTradingStore((s) => s.updateTick);
  const updateLiveTick = useTradingStore((s) => s.updateLiveTick);
  const updateCandleFromWs = useTradingStore((s) => s.updateCandleFromWs);
  const onReplayStateChanged = useTradingStore((s) => s.onReplayStateChanged);
  const updateAccountInStore = useTradingStore((s) => s.updateAccountInStore);
  const loadAccounts = useTradingStore((s) => s.loadAccounts);
  const queryClient = useQueryClient();

  // Market-data: ticks, candles, replay.
  useEffect(() => {
    const unsub = wsClient.subscribe("market-data", (event) => {
      const wsEvent = event as MarketDataEvent;
      if (wsEvent.eventType === "MarketTick") {
        updateTick(wsEvent.symbol, wsEvent.bid, wsEvent.ask, toTimestamp(wsEvent.occurredAt));
      } else if ((wsEvent as { eventType: string }).eventType === "HftLiveTick") {
        const liveTick = wsEvent as unknown as { symbol: string; bid: number; ask: number; occurredAt?: number | string };
        updateLiveTick(liveTick.symbol, liveTick.bid, liveTick.ask, toTimestamp(liveTick.occurredAt));
      } else if (wsEvent.eventType === "CandleUpdate") {
        updateCandleFromWs(wsEvent.symbol, wsEvent.timeframe, {
          open: wsEvent.open,
          high: wsEvent.high,
          low: wsEvent.low,
          close: wsEvent.close,
          volume: wsEvent.volume,
          timestamp: wsEvent.timestamp,
        });
      } else if (wsEvent.eventType === "CandleClosed") {
        queryClient.invalidateQueries({
          queryKey: queryKeys.market.candles(wsEvent.symbol, wsEvent.timeframe),
        });
      } else if (wsEvent.eventType === "ReplayStateChanged") {
        const currentUserId = useAuthStore.getState().user?.id;
        if (wsEvent.userId && currentUserId && wsEvent.userId !== currentUserId) return;
        onReplayStateChanged(wsEvent.action || "started", {
          speed: wsEvent.speed,
          cursorTimestamp: wsEvent.cursorTimestamp,
        });
        queryClient.invalidateQueries({ queryKey: ["candles"] });
      }
    });
    return () => {
      unsub();
    };
  }, [updateTick, updateLiveTick, updateCandleFromWs, onReplayStateChanged, queryClient]);

  // Account/equity events.
  useEffect(() => {
    const unsub = wsClient.subscribe("account", (event) => {
      const wsEvent = event as AccountWsEvent;
      if (wsEvent.eventType === "EquityUpdated" && wsEvent.accountId) {
        updateAccountInStore({
          id: wsEvent.accountId,
          equity: wsEvent.equity,
          balance: wsEvent.balance,
          freeMargin: wsEvent.freeMargin,
          margin: wsEvent.marginUsed,
        });
        // Live equity/balance is already in the zustand store — no HTTP refetch needed.
        // Invalidating here caused a 429 flood (one refetch per market tick per second).
      }
      if (["AccountFailed", "AccountPassed", "AccountFrozen"].includes(wsEvent.eventType)) {
        loadAccounts();
      }
    });
    return unsub;
  }, [loadAccounts, updateAccountInStore, queryClient]);

  // ── Positions — direct cache surgery, zero REST roundtrip ───────────────
  //
  // Strategy per event type:
  //   PositionOpened  — ws-handler attaches full position as _entity; we append
  //                     directly to the cache. If _entity is absent (DB lookup
  //                     failed), fall back to 150ms coalesced invalidation.
  //   PositionUpdated — event carries unrealizedPnl/quantity/averagePrice; patch
  //                     the cached entry in place (no _entity / no DB needed).
  //   PositionClosed  — remove by positionId; tombstone only, no DB needed.
  //   unknown types   — coalesced invalidation as safety net.
  //
  // startTransition marks every cache write as non-urgent so React can yield
  // to user input (scroll, tap) mid-render and batch updates.
  useEffect(() => {
    const unsub = wsClient.subscribe("positions", (event) => {
      const ev = event as PositionWsEvent;
      if (!ev.accountId) return;

      const posKey = queryKeys.trading.positions(ev.accountId);

      if (ev.eventType === "PositionOpened") {
        if (ev._entity) {
          // Route through the 50ms batch buffer so a burst of fills (G)
          // collapses into one setQueryData and one render, and optimistic
          // placeholders are cleaned up atomically (D).
          bufferPositionOpened(ev.accountId, ev._entity, queryClient, posKey);
        } else {
          // _entity absent (DB lookup failed) — fall back to REST
          coalesceInvalidation(queryClient, posKey);
        }
        return;
      }

      if (ev.eventType === "PositionUpdated") {
        startTransition(() => {
          queryClient.setQueryData<Position[]>(posKey, (old) =>
            (old ?? []).map((p) =>
              p.id === ev.positionId
                ? {
                    ...p,
                    unrealizedPnl: ev.unrealizedPnl ?? p.unrealizedPnl,
                    quantity: ev.quantity ?? p.quantity,
                    entryPrice: ev.averagePrice ?? p.entryPrice,
                  }
                : p,
            ),
          );
        });
        return;
      }

      if (ev.eventType === "PositionClosed") {
        startTransition(() => {
          queryClient.setQueryData<Position[]>(posKey, (old) =>
            (old ?? []).filter((p) => p.id !== ev.positionId),
          );
        });
        // Closed positions list needs a refresh — coalesced so burst closes → 1 fetch
        coalesceInvalidation(queryClient, ["closedPositions", ev.accountId]);
        return;
      }

      // Unknown event type — coalesced invalidation
      coalesceInvalidation(queryClient, posKey);
    });
    return unsub;
  }, [queryClient]);

  // ── Orders — entity-enriched cache updates with coalesced REST fallback ──
  //
  //   OrderPlaced/OrderFilled/OrderCanceled — ws-handler attaches _entity;
  //                                           update the orders cache directly.
  //   Everything else — coalesced 150ms invalidation.
  //
  // Orders cache key includes an optional status segment; we use the base key
  // ["orders", accountId] to match all status variants at once.
  useEffect(() => {
    const unsub = wsClient.subscribe("orders", (event) => {
      const ev = event as OrderWsEvent;
      if (!ev.accountId) return;

      const ordKey = queryKeys.trading.orders(ev.accountId);

      if (
        ev._entity &&
        (ev.eventType === "OrderPlaced" ||
          ev.eventType === "OrderFilled" ||
          ev.eventType === "OrderCanceled")
      ) {
        const entity = ev._entity;
        startTransition(() => {
          // Upsert: replace if exists, append if new
          queryClient.setQueryData<Order[]>(ordKey, (old) => {
            if (!old) return [entity];
            const idx = old.findIndex((o) => o.id === entity.id);
            if (idx >= 0) {
              const next = [...old];
              next[idx] = entity;
              return next;
            }
            return [entity, ...old];
          });
        });
        return;
      }

      // Fallback for unrecognised events or missing enrichment
      coalesceInvalidation(queryClient, ordKey);
    });
    return unsub;
  }, [queryClient]);

  // Gap-fill on WS reconnect: refetch caches so anything that happened
  // while the socket was down lands instantly.
  useEffect(() => {
    let wasConnected = wsClient.state === "connected";
    return wsClient.onStateChange((state) => {
      if (state === "connected" && !wasConnected) {
        queryClient.invalidateQueries({ queryKey: ["candles"] });
        queryClient.invalidateQueries({ queryKey: ["positions"] });
        queryClient.invalidateQueries({ queryKey: ["orders"] });
        queryClient.invalidateQueries({ queryKey: ["accounts"] });
      }
      wasConnected = state === "connected";
    });
  }, [queryClient]);

  return null;
}

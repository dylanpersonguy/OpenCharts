import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { JournalEntriesResponse } from "./api/journal";
import type { MarketDataCandlesPayload } from "./api/market-data";
import type {
  Candle,
  ClosedPosition,
  Order,
  PlaceOrderInput,
  Position,
  Symbol,
} from "./schemas";

// ── Query Key Factories ─────────────────────────────────

export const queryKeys = {
  accounts: {
    all: ["accounts"] as const,
    mine: () => [...queryKeys.accounts.all, "mine"] as const,
    detail: (id: string) => [...queryKeys.accounts.all, id] as const,
    stats: (id: string) => [...queryKeys.accounts.all, id, "stats"] as const,
    ledger: (id: string, page: number) => [...queryKeys.accounts.all, id, "ledger", page] as const,
    equity: (id: string) => [...queryKeys.accounts.all, id, "equity"] as const,
  },
  trading: {
    positions: (accountId: string) => ["positions", accountId] as const,
    orders: (accountId: string, status?: string) => ["orders", accountId, status] as const,
    fills: (accountId: string, page: number) => ["fills", accountId, page] as const,
    closedPositions: (accountId: string, page: number) =>
      ["closedPositions", accountId, page] as const,
  },
  market: {
    symbols: ["symbols"] as const,
    candles: (symbol: string, tf: string) => ["candles", symbol, tf] as const,
    economicCalendar: (currencies: string[]) => ["economicCalendar", ...currencies] as const,
  },
  replay: {
    session: (accountId: string, date: string) => ["replay", "session", accountId, date] as const,
  },
} as const;

export function usePositions(accountId: string | null) {
  return useQuery<Position[]>({
    queryKey: queryKeys.trading.positions(accountId!),
    queryFn: () => api.getPositions(accountId!),
    enabled: !!accountId,
    // WS push (MarketDataBridge setQueryData) is the primary update path.
    // 10s staleTime prevents the cache from being considered stale during burst fills,
    // so rapid invalidations don't all trigger fresh fetches.
    // 30s refetchInterval is a safety-net sync in case a WS event is missed; it is
    // NOT the primary update mechanism and must not be lowered back to 2s.
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

/** Cross-account total open position count */

export function useOrders(accountId: string | null, status?: string) {
  return useQuery<Order[]>({
    queryKey: queryKeys.trading.orders(accountId!, status),
    queryFn: () => api.getOrders(accountId!, status),
    enabled: !!accountId,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useClosedPositions(accountId: string | null, page = 1) {
  return useQuery<{
    data: ClosedPosition[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }>({
    queryKey: queryKeys.trading.closedPositions(accountId!, page),
    queryFn: () => api.getClosedPositions(accountId!, page),
    enabled: !!accountId,
    staleTime: 30_000,
  });
}

export function useSymbols() {
  return useQuery<Symbol[]>({
    queryKey: queryKeys.market.symbols,
    queryFn: () => api.getSymbols(),
    staleTime: 5 * 60_000, // 5min
  });
}

export interface EconomicCalendarEvent {
  id: string;
  time: string;
  currency: string;
  impact: "low" | "medium" | "high";
  event: string;
  forecast?: string;
  previous?: string;
  actual?: string;
  country: string;
}

export function useEconomicCalendar(currencies: string[]) {
  return useQuery<EconomicCalendarEvent[]>({
    queryKey: queryKeys.market.economicCalendar(currencies),
    queryFn: async () => {
      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - 14);
      const to = new Date(now);
      to.setDate(to.getDate() + 14);
      const res = await api.getEconomicCalendar(
        currencies,
        from.toISOString().split("T")[0],
        to.toISOString().split("T")[0],
      );
      return res as EconomicCalendarEvent[];
    },
    enabled: currencies.length > 0,
    staleTime: 10 * 60_000, // refresh every 10min
  });
}

export function useCandles(
  symbol: string,
  timeframe: string,
  limit?: number,
  replayVersion?: number,
) {
  return useQuery<MarketDataCandlesPayload, Error, Candle[]>({
    // Include replayVersion in the query key so each replay session forces a
    // completely fresh query — React Query won't reuse structural sharing or
    // stale cache from a previous replay / normal session.
    queryKey: [...queryKeys.market.candles(symbol, timeframe), limit ?? "auto", replayVersion ?? 0],
    queryFn: () => api.getCandlesWithMeta(symbol, timeframe, limit),
    // Extract just the candles array for consumers — raw payload (with isPartial)
    // is still accessible via query.state.data inside refetchInterval below.
    select: (data) => data.candles,
    staleTime: 30_000,
    // Keep previously-fetched candles visible while a new depth query (different
    // limit in the key) is in-flight. Without this, switching from firstPaint
    // → deep limit causes a momentary empty array, which lets a live WS candle
    // paint as the only bar before history arrives.
    placeholderData: (prev) => prev,
    // When the server signals the response is partial (backfill queued), poll
    // at 3 s until data fills in. Otherwise use the 5-min safety-net cadence.
    refetchInterval: (query) => (query.state.data?.metadata?.isPartial ? 3_000 : 5 * 60_000),
  });
}

export function useAccountMetrics(accountId: string | null) {
  return useQuery({
    queryKey: ["account-metrics", accountId] as const,
    queryFn: () => api.getAccountMetrics(accountId!),
    enabled: !!accountId,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useMarketDataHealth() {
  return useQuery({
    queryKey: ["market-data-health"] as const,
    queryFn: () => api.getMarketDataHealth(),
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
}

export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlaceOrderInput) => api.placeOrder(input),
    onSuccess: (_data, vars) => {
      // Optimistically refetch orders and positions
      qc.invalidateQueries({
        queryKey: queryKeys.trading.orders(vars.accountId),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.trading.positions(vars.accountId),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.accounts.detail(vars.accountId),
      });
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId }: { orderId: string; accountId: string }) => api.cancelOrder(orderId),
    onMutate: async ({ orderId, accountId }) => {
      // Optimistic update: remove order from list
      await qc.cancelQueries({ queryKey: queryKeys.trading.orders(accountId) });
      const prev = qc.getQueryData<Order[]>(queryKeys.trading.orders(accountId));
      if (prev) {
        qc.setQueryData(
          queryKeys.trading.orders(accountId),
          prev.map((o) => (o.id === orderId ? { ...o, status: "CANCELLED" } : o)),
        );
      }
      return { prev };
    },
    onError: (_err, { accountId }, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.trading.orders(accountId), ctx.prev);
    },
    onSettled: (_data, _err, { accountId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.trading.orders(accountId) });
    },
  });
}

export function useClosePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      positionId,
      quantity,
    }: {
      positionId: string;
      accountId: string;
      quantity?: number;
    }) => api.closePosition(positionId, quantity),
    onSuccess: (_data, { accountId }) => {
      qc.invalidateQueries({
        queryKey: queryKeys.trading.positions(accountId),
      });
      qc.invalidateQueries({ queryKey: queryKeys.accounts.detail(accountId) });
      qc.invalidateQueries({ queryKey: ["fills", accountId] });
    },
  });
}

export function useCloseAllPositions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => api.closeAllPositions(accountId),
    onSuccess: (_data, accountId) => {
      qc.invalidateQueries({
        queryKey: queryKeys.trading.positions(accountId),
      });
      qc.invalidateQueries({ queryKey: queryKeys.accounts.detail(accountId) });
    },
  });
}

export function useJournalEntries(accountId: string | null, opts?: { symbol?: string }) {
  return useQuery<JournalEntriesResponse>({
    queryKey: ["journal", accountId, opts?.symbol] as const,
    queryFn: () => api.getJournalEntries(accountId!, { limit: 100, symbol: opts?.symbol }),
    enabled: !!accountId,
    staleTime: 10_000,
  });
}

export function useCreateJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof api.createJournalEntry>[0]) =>
      api.createJournalEntry(data),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["journal", vars.accountId] }),
  });
}

export function useUpdateJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      accountId: string;
      emotion?: string;
      rating?: number;
      tags?: string[];
      notes?: string;
    }) => api.updateJournalEntry(id, data),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["journal", vars.accountId] }),
  });
}

export function useDeleteJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; accountId: string }) => api.deleteJournalEntry(id),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["journal", vars.accountId] }),
  });
}

export function useAiTraderEnabled() {
  return useQuery({
    queryKey: ["ai-trader", "enabled"] as const,
    queryFn: () => api.isAiTraderEnabled(),
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: true,
  });
}

export function useReplaySession(accountId: string | null, sessionDate: string | null) {
  return useQuery({
    queryKey: queryKeys.replay.session(accountId!, sessionDate!),
    queryFn: () => api.replayGetSession(accountId!, sessionDate!),
    enabled: !!accountId && !!sessionDate,
    // 30s, not Infinity — replaying *today* a second time must pick up trades
    // and candles recorded since the previous run.
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
  });
}

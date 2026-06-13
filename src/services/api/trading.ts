import { request } from "./request";
import type { ClosedPosition, Fill, Order, Position } from "../schemas";

type TradingActionResponse = {
  success?: boolean;
  message?: string;
  [key: string]: unknown;
};

type PaginatedResult<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

// Trading actions are time-critical — a 10 s hard deadline ensures the button
// never hangs forever if the server is slow or the connection drops mid-request.
const TRADE_TIMEOUT_MS = 10_000;

export const tradingApi = {
  // ── Trading ──
  placeOrder: (data: {
    accountId: string;
    symbol: string;
    side: string;
    type: string;
    quantity: number;
    price?: number;
    stopPrice?: number;
    takeProfit?: number;
    stopLoss?: number;
  }) =>
    request<Order>("/trading/orders", {
      method: "POST",
      body: JSON.stringify(data),
      timeoutMs: TRADE_TIMEOUT_MS,
    }),

  cancelOrder: (orderId: string) =>
    request<TradingActionResponse>(`/trading/orders/${orderId}`, {
      method: "DELETE",
      timeoutMs: TRADE_TIMEOUT_MS,
    }),

  modifyOrder: (
    orderId: string,
    modifications: {
      price?: number;
      quantity?: number;
      takeProfit?: number | null;
      stopLoss?: number | null;
    },
  ) =>
    request<Order>(`/trading/orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify(modifications),
      timeoutMs: TRADE_TIMEOUT_MS,
    }),

  cancelAllOrders: (accountId: string) =>
    request<TradingActionResponse>("/trading/orders/cancel-all", {
      method: "POST",
      body: JSON.stringify({ accountId }),
      timeoutMs: TRADE_TIMEOUT_MS,
    }),

  getOrders: (accountId: string, status?: string) =>
    request<Order[]>(`/trading/orders?accountId=${accountId}${status ? `&status=${status}` : ""}`),

  getPositions: (accountId: string, status = "OPEN") =>
    request<Position[]>(`/trading/positions?accountId=${accountId}&status=${status}`),

  getOpenPositionCount: () =>
    request<{ openPositionCount: number }>(`/trading/positions`).then(
      (r) => r?.openPositionCount ?? 0,
    ),

  closePosition: (positionId: string, quantity?: number) =>
    request<TradingActionResponse>(`/trading/positions/${positionId}/close`, {
      method: "POST",
      body: JSON.stringify({
        reason: "User close",
        ...(quantity != null ? { quantity } : {}),
      }),
      timeoutMs: TRADE_TIMEOUT_MS,
    }),

  modifyPosition: (
    positionId: string,
    modifications: { takeProfit?: number | null; stopLoss?: number | null },
  ) =>
    request<Position>(`/trading/positions/${positionId}`, {
      method: "PATCH",
      body: JSON.stringify(modifications),
      timeoutMs: TRADE_TIMEOUT_MS,
    }),

  closeAllPositions: (accountId: string) =>
    request<TradingActionResponse>(`/trading/positions/close-all`, {
      method: "POST",
      body: JSON.stringify({ accountId }),
      timeoutMs: TRADE_TIMEOUT_MS,
    }),

  getFills: (accountId: string, page = 1, pageSize = 50) =>
    request<PaginatedResult<Fill>>(
      `/trading/fills?accountId=${accountId}&page=${page}&pageSize=${pageSize}`,
    ),

  getClosedPositions: (accountId: string, page = 1, pageSize = 50) =>
    request<PaginatedResult<ClosedPosition>>(
      `/trading/closed-positions?accountId=${accountId}&page=${page}&pageSize=${pageSize}`,
    ),

  getClosedPositionsSummary: (accountId: string, from: string, to: string) => {
    const params = new URLSearchParams({ accountId, from, to });
    return request<{ pnl: number; commission: number; swap: number; tradeCount: number }>(
      `/trading/closed-positions/summary?${params.toString()}`,
    );
  },

  // ── Fill Quality Score ──
  getFillQuality: (accountId: string, limit = 100) =>
    request<{
      avgScore: number | null;
      count: number;
      entries: Array<{
        id: string;
        symbol: string;
        side: string;
        slippageBps: number;
        latencyMs: number;
        integrityCoupled: boolean;
        qualityScore: number | null;
        createdAt: string;
      }>;
    }>(`/trading/fill-quality?accountId=${accountId}&limit=${limit}`),

  // ── Fills with filters ──
  getFillsFiltered: (
    accountId: string,
    opts: {
      from?: string;
      to?: string;
      symbol?: string;
      page?: number;
      limit?: number;
    },
  ) => {
    const params = new URLSearchParams({ accountId });
    if (opts.from) params.set("from", opts.from);
    if (opts.to) params.set("to", opts.to);
    if (opts.symbol) params.set("symbol", opts.symbol);
    if (opts.page) params.set("page", String(opts.page));
    if (opts.limit) params.set("limit", String(opts.limit));
    return request<PaginatedResult<Fill>>(`/trading/fills?${params.toString()}`);
  },
};

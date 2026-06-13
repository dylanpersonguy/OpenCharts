import { request } from "./request";

export interface JournalEntry {
  id: string;
  accountId: string;
  positionId?: string | null;
  symbolName?: string | null;
  side?: "BUY" | "SELL" | string | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  pnl?: number | null;
  emotion?: string | null;
  setupType?: string | null;
  rating?: number | null;
  tags: string[];
  notes: string;
  createdAt: string;
}

export interface JournalEntriesResponse {
  entries: JournalEntry[];
  total: number;
}

export interface CreateJournalEntryInput {
  accountId: string;
  positionId?: string;
  symbolName?: string;
  side?: string;
  entryPrice?: number;
  exitPrice?: number;
  pnl?: number;
  emotion?: string;
  rating?: number;
  tags?: string[];
  notes?: string;
}

export interface UpdateJournalEntryInput {
  emotion?: string;
  rating?: number;
  tags?: string[];
  notes?: string;
}

type AnyRecord = Record<string, unknown>;
type AnalyticsSnapshotsParams = {
  accountId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
};
type WindowWithApiBase = Window & { __API_BASE?: string };

export const journalApi = {
  // ── Trade Journal (#26) ──
  getJournalEntries: (
    accountId: string,
    opts?: { limit?: number; offset?: number; symbol?: string },
  ) => {
    const params = new URLSearchParams({ accountId });
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    if (opts?.symbol) params.set("symbol", opts.symbol);
    return request<JournalEntriesResponse>(`/trading/journal?${params.toString()}`);
  },

  createJournalEntry: (data: CreateJournalEntryInput) =>
    request<JournalEntry>("/trading/journal", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateJournalEntry: (id: string, data: UpdateJournalEntryInput) =>
    request<JournalEntry>(`/trading/journal/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteJournalEntry: (id: string) => request<void>(`/trading/journal/${id}`, { method: "DELETE" }),

  // ── Analytics ──
  getAnalyticsSnapshots: (params?: AnalyticsSnapshotsParams) => {
    const qs = new URLSearchParams();
    if (params?.accountId) qs.set("accountId", params.accountId);
    if (params?.startDate) qs.set("startDate", params.startDate);
    if (params?.endDate) qs.set("endDate", params.endDate);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    return request<AnyRecord>(`/trader/analytics/snapshots?${qs.toString()}`);
  },

  getAnalyticsAggregate: (accountId?: string) =>
    request<AnyRecord>(`/trader/analytics/aggregate${accountId ? `?accountId=${accountId}` : ""}`),

  exportAnalyticsPdf: (accountId?: string) => {
    // Opens a direct download link (returns HTML for PDF)
    const base = (window as WindowWithApiBase).__API_BASE || "";
    const token = localStorage.getItem("accessToken") || "";
    const url = `${base}/api/trader/analytics/export/pdf${accountId ? `?accountId=${accountId}` : ""}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-report-${new Date().toISOString().slice(0, 10)}.html`;
    // Use fetch with auth header for authenticated download
    return fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = `analytics-report-${new Date().toISOString().slice(0, 10)}.html`;
        link.click();
        URL.revokeObjectURL(blobUrl);
      });
  },

  // ── Pattern Detection ──
  getPatterns: (accountId: string, lookbackDays?: number) =>
    request<AnyRecord>(
      `/trader/patterns/${accountId}${lookbackDays ? `?lookbackDays=${lookbackDays}` : ""}`,
    ),
};

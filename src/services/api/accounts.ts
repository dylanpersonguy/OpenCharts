import { request } from "./request";
import type { Account, AccountStats, EquityPoint, LedgerEntry } from "../schemas";
import type { PnlCalendarResponse } from "@propsim/types";

export type PayoutCalculation = {
  grossProfit: number;
  profitSplit: number;
  firmShare: number;
  traderPayout: number;
  fees: number;
  netPayout: number;
  consistencyScore: number | null;
  consistencyThreshold: number | null;
  consistencyGated: boolean;
};

export type PayoutAccountRef = {
  label?: string | null;
};

export type PayoutRecord = {
  id: string;
  accountId: string;
  status: string;
  grossProfit: number;
  profitSplit?: number | null;
  traderPayout: number;
  netPayout: number;
  fees?: number | null;
  payoutMethod?: string | null;
  payoutDetails?: Record<string, unknown> | null;
  adminNote?: string | null;
  createdAt: string;
  processedAt?: string | null;
  account?: PayoutAccountRef | null;
};

export type AllPayoutsResponse = {
  payouts: PayoutRecord[];
  summary: { totalPaidOut: number; pendingCount: number; totalRequests: number };
};

export const accountsApi = {
  // ── Accounts ──
  getMyAccounts: () => request<Account[]>("/accounts/me/list"),

  getAccount: (id: string) => request<Account>(`/accounts/${id}`),

  createAccount: (templateId: string, userId: string, label?: string) =>
    request<Account>("/accounts", {
      method: "POST",
      body: JSON.stringify({ templateId, userId, label }),
    }),

  getLedger: (id: string, page = 1, pageSize = 50) =>
    request<{
      data: LedgerEntry[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>(`/accounts/${id}/ledger?page=${page}&pageSize=${pageSize}`),

  setAccountLabel: (id: string, label: string) =>
    request<Account>(`/accounts/${id}/label`, {
      method: "PATCH",
      body: JSON.stringify({ label }),
    }),

  getEquityHistory: (id: string, limit = 100) =>
    request<EquityPoint[]>(`/accounts/${id}/equity?limit=${limit}`),

  getAccountStats: (id: string) => request<AccountStats>(`/accounts/${id}/stats`),

  // ── Payouts ──
  calculatePayout: (accountId: string) =>
    request<PayoutCalculation>(`/accounts/${accountId}/payout/calculate`),

  requestPayout: (
    accountId: string,
    payoutMethod?: string,
    payoutDetails?: Record<string, string>,
  ) =>
    request<PayoutRecord>(`/accounts/${accountId}/payout/request`, {
      method: "POST",
      body: JSON.stringify({ payoutMethod, payoutDetails }),
    }),

  getPayoutHistory: (accountId: string) =>
    request<PayoutRecord[]>(`/accounts/${accountId}/payout/history`),

  getAllPayouts: () => request<AllPayoutsResponse>("/accounts/payouts/all"),

  getDailyPnl: (accountIds: string[], from: string, to: string) => {
    const params = new URLSearchParams({ accountIds: accountIds.join(","), from, to });
    return request<PnlCalendarResponse>(`/accounts/daily-pnl?${params}`);
  },
};

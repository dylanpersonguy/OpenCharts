import { request } from "./request";

type AnyRecord = Record<string, unknown>;

type AffiliateStats = {
  totalReferrals: number;
  activeReferrals: number;
  totalCommissions: number;
  pendingCommissions: number;
  paidCommissions: number;
  conversionRate: number;
  tier: string;
};

export interface LeaderboardEntry {
  userId?: string;
  traderName?: string;
  firmName?: string;
  accountId?: string;
  rank?: number;
  profit?: number;
  returnPct?: number;
  winRate?: number;
  totalTrades?: number;
  consistencyScore?: number;
  profitFactor?: number;
  averageRoi?: number;
  [key: string]: unknown;
}

export interface LeaderboardStats {
  totalParticipants?: number;
  totalPnl?: number;
  avgWinRate?: number;
  topProfit?: number;
  [key: string]: unknown;
}

export interface LeaderboardPrize {
  id: string;
  rank?: number;
  title?: string;
  prizeType?: string;
  prize?: string;
  price?: number;
  currency?: string;
  description?: string;
  [key: string]: unknown;
}

export interface MyAward {
  id: string;
  rank?: number;
  awardedAt?: string;
  competition?: { id?: string; name?: string };
  prize?: { id?: string; name?: string; price?: number; currency?: string };
  [key: string]: unknown;
}

export interface Competition {
  id: string;
  name: string;
  description?: string;
  status?: string;
  isActive?: boolean;
  enrollmentOpen?: boolean;
  enrollmentEndDate?: string;
  startDate?: string;
  endDate?: string;
  maxParticipants?: number;
  enrollmentCount?: number;
  totalParticipants?: number;
  rankingMetric?: string;
  prizePoolDesc?: string;
  accountTemplate?: { id?: string; name?: string; startingBalance?: number };
  [key: string]: unknown;
}

export interface CompetitionEntry {
  id: string;
  competitionId?: string;
  accountId?: string;
  status?: string;
  rank?: number;
  profit?: number;
  returnPct?: number;
  competition?: Competition;
  account?: { id?: string; label?: string; startingBalance?: number; balance?: number };
  [key: string]: unknown;
}

export interface CompetitionRankingEntry {
  id?: string;
  rank?: number;
  userId?: string;
  traderName?: string;
  accountId?: string;
  profit?: number;
  returnPct?: number;
  totalTrades?: number;
  winRate?: number;
  competitionId?: string;
  [key: string]: unknown;
}

type CopySubscribeInput = {
  providerId: string;
  allocationPercent: number;
  maxLotSize?: number;
  invertSignals?: boolean;
  copySL?: boolean;
  copyTP?: boolean;
};

export const socialApi = {
  // ── Affiliates ──
  getAffiliateProfile: () => request<AnyRecord>("/affiliates/profile"),

  getAffiliateLink: () =>
    request<{ referralCode: string; referralLink: string }>("/affiliates/link"),

  getAffiliateStats: () => request<AffiliateStats>("/affiliates/stats"),

  getAffiliateReferrals: () => request<AnyRecord[]>("/affiliates/referrals"),

  getAffiliateCommissions: () => request<AnyRecord[]>("/affiliates/commissions"),

  requestAffiliatePayout: (amount: number) =>
    request<AnyRecord>("/affiliates/payout", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),

  updatePayoutMethod: (method: string, details: Record<string, string>) =>
    request<AnyRecord>("/affiliates/payout-method", {
      method: "PATCH",
      body: JSON.stringify({ method, details }),
    }),

  // ── Copy Trading ──
  getCopyProviders: (sortBy?: string) =>
    request<AnyRecord[]>(`/copy-trading/providers${sortBy ? `?sortBy=${sortBy}` : ""}`),

  getCopyProviderDetails: (providerId: string) =>
    request<AnyRecord>(`/copy-trading/providers/${providerId}`),

  subscribeToCopy: (data: CopySubscribeInput) =>
    request<AnyRecord>("/copy-trading/subscribe", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getCopySubscriptions: () => request<AnyRecord[]>("/copy-trading/subscriptions"),

  manageCopySubscription: (subscriptionId: string, action: "pause" | "resume" | "stop") =>
    request<AnyRecord>(`/copy-trading/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    }),

  // ── Leaderboard & Competitions ──
  getLeaderboard: (period?: string) => {
    const params = new URLSearchParams();
    if (period) params.set("period", period);
    return request<LeaderboardEntry[]>(`/leaderboard?${params.toString()}`);
  },

  getFirmLeaderboard: (period?: string) => {
    const params = new URLSearchParams();
    if (period) params.set("period", period);
    return request<LeaderboardEntry[]>(`/leaderboard/firm?${params.toString()}`);
  },

  getLeaderboardStats: (period?: string) => {
    const params = new URLSearchParams();
    if (period) params.set("period", period);
    return request<LeaderboardStats>(`/leaderboard/stats?${params.toString()}`);
  },

  getLeaderboardPrizes: () => request<LeaderboardPrize[]>("/leaderboard/prizes"),

  getMyLeaderboardRank: (period?: string) => {
    const params = new URLSearchParams();
    if (period) params.set("period", period);
    return request<LeaderboardEntry[]>(`/leaderboard/me?${params.toString()}`);
  },

  getMyAwards: () => request<MyAward[]>("/leaderboard/me/awards"),

  // ── Competitions (enrollment) ──
  getActiveCompetitions: () => request<Competition[]>("/leaderboard/competitions/active"),

  getMyCompetitionEntries: () =>
    request<CompetitionEntry[]>("/leaderboard/competitions/my-entries"),

  enrollInCompetition: (competitionId: string) =>
    request<CompetitionEntry>(`/leaderboard/competitions/${competitionId}/enroll`, {
      method: "POST",
    }),

  getCompetitionRankings: (competitionId: string, limit?: number) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    return request<CompetitionRankingEntry[]>(
      `/leaderboard/competitions/${competitionId}/rankings?${params.toString()}`,
    );
  },

  // ── Certificates ──
  getMyCertificates: () => request<AnyRecord[]>("/certificates"),

  getCertificateSvg: (id: string) => request<{ svg: string }>(`/certificates/${id}/svg`),

  getCertificatePdf: async (id: string) => {
    const data = await request<{ svg: string }>(`/certificates/${id}/svg`);
    return new Blob([data.svg], { type: "image/svg+xml" });
  },
};

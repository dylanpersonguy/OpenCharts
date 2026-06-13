import { request } from "./request";

type AnyRecord = Record<string, unknown>;

export const featuresApi = {
  // ── Flagged Features ──

  // Bot Integrations (Discord/Telegram)
  getBotIntegrations: () => request<AnyRecord[]>("/features/bot/integrations"),

  createBotIntegration: (data: {
    platform: "discord" | "telegram";
    webhookUrl: string;
    chatId?: string;
    events: string[];
  }) =>
    request<AnyRecord>("/features/bot/integrations", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateBotIntegration: (
    id: string,
    data: Partial<{
      webhookUrl: string;
      chatId: string;
      events: string[];
      isActive: boolean;
    }>,
  ) =>
    request<AnyRecord>(`/features/bot/integrations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteBotIntegration: (id: string) =>
    request<AnyRecord>(`/features/bot/integrations/${id}`, { method: "DELETE" }),

  testBotIntegration: (platform: string) =>
    request<AnyRecord>("/features/bot/test", {
      method: "POST",
      body: JSON.stringify({ platform }),
    }),

  // Public Trader Profiles
  getMyProfile: () => request<AnyRecord>("/features/profile"),

  updateProfile: (data: {
    displayName: string;
    bio?: string;
    avatarUrl?: string;
    isVisible?: boolean;
    showStats?: boolean;
    showEquityCurve?: boolean;
    socialLinks?: Record<string, string>;
  }) =>
    request<AnyRecord>("/features/profile", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  getPublicProfiles: (page?: number, limit?: number) =>
    request<{ items: AnyRecord[]; total: number }>(
      `/features/profiles/public?page=${page || 1}&limit=${limit || 20}`,
    ),

  getPublicProfile: (userId: string) => request<AnyRecord>(`/features/profiles/public/${userId}`),

  // Scaling Plans
  getScalingPlans: () => request<AnyRecord[]>("/features/scaling/plans"),

  createScalingPlan: (data: {
    name: string;
    description?: string;
    milestones: Array<{ targetPnl: number; scalePercent: number; minDays: number; label: string }>;
    isDefault?: boolean;
  }) =>
    request<AnyRecord>("/features/scaling/plans", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getScalingProgress: (accountId: string) =>
    request<AnyRecord[]>(`/features/scaling/progress/${accountId}`),

  enrollScaling: (accountId: string, scalingPlanId: string) =>
    request<AnyRecord>("/features/scaling/enroll", {
      method: "POST",
      body: JSON.stringify({ accountId, scalingPlanId }),
    }),

  // Profit Split Escalation
  getProfitSplitConfig: () => request<AnyRecord>("/features/profit-split/config"),

  updateProfitSplitConfig: (
    tiers: Array<{ minPayouts: number; splitPercent: number; label: string }>,
  ) =>
    request<AnyRecord>("/features/profit-split/config", {
      method: "PUT",
      body: JSON.stringify({ tiers }),
    }),

  getMyProfitSplit: () => request<AnyRecord>("/features/profit-split/my"),

  // Account Merge
  requestAccountMerge: (data: {
    sourceAccountId: string;
    targetAccountId: string;
    reason?: string;
  }) =>
    request<AnyRecord>("/features/accounts/merge", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getMergeRequests: () => request<AnyRecord[]>("/features/accounts/merge"),

  getMergeRequest: (id: string) => request<AnyRecord>(`/features/accounts/merge/${id}`),

  processMergeRequest: (id: string, status: "APPROVED" | "REJECTED", adminNotes?: string) =>
    request<AnyRecord>(`/features/accounts/merge/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, adminNotes }),
    }),
};

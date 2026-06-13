import { request } from "./request";

type PushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };
type BotLogEntry = Record<string, unknown>;

export interface DocSectionSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  _count?: { articles?: number };
}

export interface DocArticle {
  id: string;
  slug: string;
  title: string;
  content: string;
  sectionId: string;
  section?: { slug: string; title: string; icon?: string | null };
}

export interface DocSectionDetail extends DocSectionSummary {
  articles: DocArticle[];
}

export interface FirmProfile {
  id: string;
  name: string;
  slug: string;
  branding?: {
    faviconUrl?: string;
    logoUrl?: string;
    logoUrlDark?: string;
    logoUrlLight?: string;
    logoHeight?: number;
  } | null;
  [key: string]: unknown;
}

export const platformApi = {
  // ── Documentation ──
  getDocSections: () => request<DocSectionSummary[]>("/docs/public/sections"),
  getDocSection: (slug: string) => request<DocSectionDetail>(`/docs/public/sections/${slug}`),
  getDocArticle: (slug: string) => request<DocArticle>(`/docs/public/articles/${slug}`),
  searchDocs: (q: string) =>
    request<DocArticle[]>(`/docs/public/search?q=${encodeURIComponent(q)}`),

  // ── Firm ──
  getMyFirm: () => request<FirmProfile>("/firm/me"),

  // ── Feature Flags (trader-accessible) ──
  getFeatureFlags: () => request<Record<string, boolean>>("/features"),

  // ── Push Notifications ──
  getVapidPublicKey: () => request<{ vapidPublicKey: string | null }>("/trader/push/vapid-key"),

  subscribePush: (subscription: PushSubscription) =>
    request<{ success?: boolean }>("/trader/push/subscribe", {
      method: "POST",
      body: JSON.stringify(subscription),
    }),

  unsubscribePush: (endpoint: string) =>
    request<{ success?: boolean }>("/trader/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint }),
    }),

  getPushSubscriptions: () => request<PushSubscription[]>("/trader/push/subscriptions"),

  sendTestNotification: () =>
    request<{ success?: boolean; message?: string }>("/trader/push/test", { method: "POST" }),

  // ── Bot Activity ──
  getBotActivityLogs: (limit = 50) =>
    request<{ logs: BotLogEntry[] }>(`/bot-activity/logs?limit=${limit}`),

  getBotStatus: () => request<{ active: boolean; platform: string | null }>("/bot-activity/status"),

  connectBot: () =>
    request<{ success: boolean; message: string }>("/bot-activity/connect", {
      method: "POST",
    }),

  disconnectBot: () =>
    request<{ success: boolean; message: string }>("/bot-activity/disconnect", {
      method: "POST",
    }),
};

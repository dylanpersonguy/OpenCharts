import { request } from "./request";

type JsonMap = Record<string, unknown>;
export type CheckoutSpreadProfileType = "FIXED" | "VARIABLE";

export type NotificationHistoryItem = {
  id: string;
  title?: string;
  message?: string;
  read?: boolean;
  createdAt?: string;
  [key: string]: unknown;
};

export type StoreProduct = {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency?: string;
  [key: string]: unknown;
};

export type CryptoPaymentStatus = {
  purchaseId: string;
  status: string;
  invoiceId?: string;
  [key: string]: unknown;
};

export type CheckoutSession = {
  sessionId: string;
  status: string;
  url?: string;
  purchaseId?: string;
  [key: string]: unknown;
};

export type GatewayCheckoutResponse = {
  purchaseId: string;
  url?: string;
  linkToken?: string;
  bankDetails?: JsonMap;
  reference?: string;
};

export type PurchaseItem = {
  id: string;
  status: string;
  amount?: number;
  currency?: string;
  createdAt?: string;
  [key: string]: unknown;
};

export type SupportTicket = {
  id: string;
  subject: string;
  status: string;
  category?: string;
  priority?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type SupportTicketResponse = {
  ticket: SupportTicket;
  message?: string;
  [key: string]: unknown;
};

export const commerceApi = {
  // ── Legacy Notifications ──
  getVapidKey: () => request<{ publicKey: string }>("/notifications/vapid-key"),

  subscribeNotifications: (subscription: PushSubscriptionJSON) =>
    request<{ success: boolean }>("/notifications/subscribe", {
      method: "POST",
      body: JSON.stringify({ subscription }),
    }),

  getNotificationPrefs: () => request<Record<string, boolean>>("/notifications/preferences"),

  updateNotificationPrefs: (preferences: Record<string, boolean>) =>
    request<{ success: boolean }>("/notifications/preferences", {
      method: "PATCH",
      body: JSON.stringify({ preferences }),
    }),

  getNotificationHistory: (limit = 50) =>
    request<NotificationHistoryItem[]>(`/notifications/history?limit=${limit}`),

  markNotificationsRead: (ids: string[]) =>
    request<{ updated: number }>("/notifications/read", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  // ── Checkout & Store ──
  getStoreProducts: () => request<StoreProduct[]>("/checkout/products"),

  getPaymentMethods: () =>
    request<{ id: string; name: string; icon: string; enabled: boolean }[]>(
      "/checkout/payment-methods",
    ),

  createCheckoutSession: (
    productId: string,
    successUrl?: string,
    cancelUrl?: string,
    couponCode?: string,
    spreadProfileType?: CheckoutSpreadProfileType,
  ) =>
    request<{ sessionId: string; url: string }>("/checkout/session", {
      method: "POST",
      body: JSON.stringify({ productId, successUrl, cancelUrl, couponCode, spreadProfileType }),
    }),

  createCryptoCheckout: (
    productId: string,
    payCurrency?: string,
    successUrl?: string,
    cancelUrl?: string,
    couponCode?: string,
    spreadProfileType?: CheckoutSpreadProfileType,
  ) =>
    request<{ invoiceId: string; url: string; purchaseId: string }>("/checkout/crypto/session", {
      method: "POST",
      body: JSON.stringify({
        productId,
        payCurrency,
        successUrl,
        cancelUrl,
        couponCode,
        spreadProfileType,
      }),
    }),

  getCryptoCurrencies: () => request<string[]>("/checkout/crypto/currencies"),

  getCryptoEstimate: (amount: number, currency: string, payCurrency: string) =>
    request<{
      currency_from: string;
      amount_from: number;
      currency_to: string;
      estimated_amount: string;
      min_amount: number;
    }>(
      `/checkout/crypto/estimate?amount=${amount}&currency=${currency}&payCurrency=${payCurrency}`,
    ),

  getCryptoPaymentStatus: (purchaseId: string) =>
    request<CryptoPaymentStatus>(`/checkout/crypto/status/${purchaseId}`),

  // ── Stripe / Regional PSPs ──
  getStripeMethods: () => request<{ id: string; name: string }[]>("/checkout/stripe/methods"),

  createStripeCheckout: (
    productId: string,
    paymentMethod: string,
    successUrl?: string,
    cancelUrl?: string,
    couponCode?: string,
    spreadProfileType?: CheckoutSpreadProfileType,
  ) =>
    request<{ purchaseId: string; sessionId: string; url: string }>("/checkout/stripe/session", {
      method: "POST",
      body: JSON.stringify({
        productId,
        paymentMethod,
        successUrl,
        cancelUrl,
        couponCode,
        spreadProfileType,
      }),
    }),

  getCheckoutSession: (sessionId: string) =>
    request<CheckoutSession>(`/checkout/session/${sessionId}`),

  // ── Additional Payment Gateways ──
  getAvailableGateways: () =>
    request<{ id: string; label: string; category: string }[]>("/checkout/available-gateways"),

  createGatewayCheckout: (
    gatewayId: string,
    productId: string,
    successUrl?: string,
    cancelUrl?: string,
    couponCode?: string,
    spreadProfileType?: CheckoutSpreadProfileType,
  ) =>
    request<GatewayCheckoutResponse>(`/checkout/${gatewayId}/session`, {
      method: "POST",
      body: JSON.stringify({ productId, successUrl, cancelUrl, couponCode, spreadProfileType }),
    }),

  getMyPurchases: (status?: string, page = 1, pageSize = 20) => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (status) params.set("status", status);
    return request<{ items: PurchaseItem[]; total: number; page: number }>(
      `/checkout/purchases?${params.toString()}`,
    );
  },

  // ── Support Tickets ──
  getMyTickets: () => request<SupportTicket[]>("/support/tickets"),

  createTicket: (data: {
    subject: string;
    message: string;
    category?: string;
    priority?: string;
    accountId?: string | null;
  }) =>
    request<SupportTicketResponse>("/support/tickets", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getTicket: (id: string) => request<SupportTicket>(`/support/tickets/${id}`),

  replyToTicket: (id: string, message: string, attachments?: string[]) =>
    request<SupportTicketResponse>(`/support/tickets/${id}/reply`, {
      method: "POST",
      body: JSON.stringify({ message, attachments }),
    }),

  closeTicket: (id: string) =>
    request<SupportTicketResponse>(`/support/tickets/${id}/close`, { method: "POST" }),

  rateTicket: (id: string, satisfaction: number) =>
    request<SupportTicketResponse>(`/support/tickets/${id}/rate`, {
      method: "POST",
      body: JSON.stringify({ satisfaction }),
    }),

  // ── Coupon Validation ──
  validateCoupon: (code: string, productId?: string, orderAmount?: number) =>
    request<{
      valid: boolean;
      coupon: { id: string; code: string; type: string; value: number; description: string };
      productIds: string[];
      isFreeRedemption: boolean;
      discount: number;
      finalAmount: number;
    }>("/coupons/validate", {
      method: "POST",
      body: JSON.stringify({ code, productId, orderAmount }),
    }),

  redeemCoupon: (code: string, productId: string, spreadProfileType?: CheckoutSpreadProfileType) =>
    request<{
      purchaseId: string;
      provisionedAccountId: string | null;
      product: { name: string };
      message: string;
    }>("/coupons/redeem", {
      method: "POST",
      body: JSON.stringify({ code, productId, spreadProfileType }),
    }),
};

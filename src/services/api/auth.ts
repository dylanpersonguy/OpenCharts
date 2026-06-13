import { request } from "./request";
import type { User } from "../schemas";

type AuthPayload = {
  accessToken: string;
  refreshToken: string;
  user: User;
};

type ChangePasswordResponse = {
  success?: boolean;
  message?: string;
};

export interface AccountMetricsResponse {
  accountId: string;
  equity: number;
  balance: number;
  freeMargin: number;
  marginUsed: number;
  floatingPnl: number;
  dailyPnl: number;
  ddDaily: number | null;
  ddDailyMax: number | null;
  ddTotal: number | null;
  ddTotalMax: number | null;
  ddTrailing: number | null;
  ddTrailingMax: number | null;
  trailingDrawdownFloor: number | null;
  trailingDrawdownPeak: number | null;
  trailingDrawdownMode: string | null;
  trailingDrawdownTrailMode: string | null;
  trailingDrawdownFloorLocked: boolean;
  trailingDrawdownTrailToBreakeven: boolean;
  profitTargetPercent: number | null;
  profitTargetProgress: number;
  minTradingDays: number | null;
  tradingDaysCompleted: number;
  minDaysProgress: number;
  status: string;
  phase: string | null;
  highWaterMark: number | null;
  startingBalance: number;
  currency: string;
  lastMarkTs: string | null;
}

type TrustedDevice = {
  id: string;
  name?: string | null;
  ipAddress?: string | null;
  isTrusted?: boolean;
  lastSeenAt?: string;
};

type ActiveSession = {
  id: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  expiresAt: string;
};

export const authApi = {
  // ── Auth ──
  login: (email: string, password: string) =>
    request<AuthPayload>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  demoLogin: () =>
    request<{
      accessToken: string;
      refreshToken: string;
      user: User;
      isDemo: boolean;
    }>("/auth/demo", {
      method: "POST",
    }),

  register: (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    firmSlug?: string;
  }) =>
    request<AuthPayload>("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  refreshToken: (refreshToken: string) =>
    request<{ accessToken: string; refreshToken: string }>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),

  logout: (refreshToken?: string) =>
    request<void>("/auth/logout", {
      method: "POST",
      body: refreshToken ? JSON.stringify({ refreshToken }) : undefined,
    }),

  forgotPassword: (email: string) =>
    request<{ message: string; expiresIn: number }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  resetPassword: (resetToken: string, newPassword: string) =>
    request<{ message: string }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ resetToken, newPassword }),
    }),

  // ── Auth extras ──
  changePassword: (currentPassword: string, newPassword: string) =>
    request<ChangePasswordResponse>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  getPreferences: () => request<Record<string, string>>("/auth/preferences"),

  savePreferences: (prefs: Record<string, string>) =>
    request<Record<string, string>>("/auth/preferences", {
      method: "PATCH",
      body: JSON.stringify(prefs),
    }),

  // ── Account metrics ──
  getAccountMetrics: (accountId: string) =>
    request<AccountMetricsResponse>(`/v1/accounts/${accountId}/metrics`),

  // ── Security / MFA ──
  getMfaStatus: () =>
    request<{
      enabled: boolean;
      enabledAt: string | null;
      backupCodesRemaining: number;
    }>("/security/mfa/status"),

  setupMfa: () =>
    request<{ secret: string; otpauthUrl: string; qrData: string }>("/security/mfa/setup", {
      method: "POST",
    }),

  verifyMfaSetup: (token: string) =>
    request<{ backupCodes: string[] }>("/security/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  disableMfa: (token: string) =>
    request<{ message: string }>("/security/mfa/disable", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  regenerateBackupCodes: (token: string) =>
    request<{ backupCodes: string[] }>("/security/mfa/backup-codes/regenerate", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  completeMfaLogin: (mfaToken: string, code: string) =>
    request<AuthPayload>("/auth/mfa/complete", {
      method: "POST",
      body: JSON.stringify({ mfaToken, code }),
    }),

  // ── Security / Devices ──
  getDevices: () => request<TrustedDevice[]>("/security/devices"),

  trustDevice: (deviceId: string) =>
    request<TrustedDevice>(`/security/devices/${deviceId}/trust`, { method: "POST" }),

  revokeDevice: (deviceId: string) =>
    request<void>(`/security/devices/${deviceId}`, { method: "DELETE" }),

  // ── Security / Sessions ──
  getActiveSessions: () => request<ActiveSession[]>("/security/sessions"),

  revokeSession: (sessionId: string) =>
    request<void>(`/security/sessions/${sessionId}`, { method: "DELETE" }),

  revokeAllSessions: () =>
    request<{ revokedCount: number }>("/security/sessions/revoke-all", {
      method: "POST",
    }),
};

import type { DrawingLine } from "../../pages/trading/constants.ts";
import type {
  CreateJournalEntryInput,
  JournalEntriesResponse,
  JournalEntry,
  UpdateJournalEntryInput,
} from "../api/journal.ts";
import type { Candle } from "../schemas.ts";
import { getHistory } from "./candles.ts";
import * as engine from "./engine.ts";
import { DEMO_SYMBOLS } from "./instruments.ts";
import {
  backendForAccount,
  backendForOrder,
  backendForPosition,
  type OrderModifications,
  type PositionModifications,
} from "./replay-router.ts";

/**
 * Demo-mode API. Replaces the HTTP client for everything the terminal needs:
 * trading actions hit the in-browser paper engine, market data comes from the
 * bundled real OHLC, and chart drawings persist to localStorage. Methods not
 * implemented here fall through to a benign stub (see services/api.ts).
 */

const DEMO_USER = {
  id: "demo-user",
  email: "demo@opencharts.dev",
  firstName: "Demo",
  lastName: "Trader",
  roles: ["trader"],
  status: "ACTIVE",
  createdAt: new Date().toISOString(),
};

function authResponse() {
  return { accessToken: "demo-token", refreshToken: "demo-refresh", user: DEMO_USER };
}

// ── Chart drawings (localStorage) ─────────────────────────
const DRAW_KEY = (symbol: string) => `oc_drawings_${symbol}`;

function readDrawings(symbol: string): DrawingLine[] {
  try {
    return JSON.parse(localStorage.getItem(DRAW_KEY(symbol)) ?? "[]");
  } catch {
    return [];
  }
}
function writeDrawings(symbol: string, list: DrawingLine[]): void {
  localStorage.setItem(DRAW_KEY(symbol), JSON.stringify(list));
}

const chartDrawings = {
  list: (symbol: string) => Promise.resolve(readDrawings(symbol)),
  save: (symbol: string, _tf: string, drawing: DrawingLine) => {
    const list = readDrawings(symbol).filter((d) => d.id !== drawing.id);
    list.push(drawing);
    writeDrawings(symbol, list);
    return Promise.resolve({ saved: true });
  },
  /** `symbolKey` scopes the delete (replay sessions use keys like `replay:<id>:XAUUSD`). */
  remove: (drawingId: string, symbolKey?: string) => {
    const keys = symbolKey ? [symbolKey] : DEMO_SYMBOLS.map((s) => s.name);
    for (const key of keys) {
      writeDrawings(key, readDrawings(key).filter((d) => d.id !== drawingId));
    }
    return Promise.resolve({ deleted: true });
  },
  /** Drop every drawing list whose key starts with `prefix` (used when a replay session is deleted). */
  clearScope: (prefix: string) => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(DRAW_KEY(prefix)));
    for (const k of keys) localStorage.removeItem(k);
    return Promise.resolve({ cleared: keys.length });
  },
  clear: (symbol: string) => {
    writeDrawings(symbol, []);
    return Promise.resolve({ cleared: true });
  },
};

const candlesMeta = (candles: Candle[]) => ({
  candles,
  metadata: { isPartial: false, backfillQueued: false, historicalCoverageStart: null },
});

export const demoApi = {
  // ── Auth (no real auth in demo) ──
  login: (_email: string, _password: string) => Promise.resolve(authResponse()),
  demoLogin: () => Promise.resolve(authResponse()),
  register: () => Promise.resolve(authResponse()),
  completeMfaLogin: (_mfaToken: string, _code: string) => Promise.resolve(authResponse()),
  logout: (_refreshToken?: string) => Promise.resolve({ success: true }),
  refreshToken: (_refreshToken?: string | null) => Promise.resolve({ accessToken: "demo-token", refreshToken: "demo-refresh" }),
  getMyProfile: () => Promise.resolve(DEMO_USER),
  getMe: () => Promise.resolve(DEMO_USER),

  // ── Accounts ──
  getMyAccounts: () => Promise.resolve(engine.getAccounts()),
  getAccount: (accountId?: string) =>
    Promise.resolve(backendForAccount(accountId)?.getAccount() ?? engine.getAccount()),
  getEquityHistory: () => Promise.resolve([]),
  getLedger: () => Promise.resolve({ data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 }),
  getAccountStats: () =>
    Promise.resolve({
      totalTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      bestTrade: 0,
      worstTrade: 0,
    }),
  setAccountLabel: () => Promise.resolve({ success: true }),
  getAccountMetrics: (accountId?: string) => {
    const a = backendForAccount(accountId)?.getAccount() ?? engine.getAccount();
    return Promise.resolve({
      accountId: a.id,
      equity: a.equity,
      balance: a.balance,
      freeMargin: a.freeMargin,
      marginUsed: a.margin,
      floatingPnl: a.equity - a.balance,
      dailyPnl: 0,
      ddDaily: null,
      ddDailyMax: null,
      ddTotal: null,
      ddTotalMax: null,
      ddTrailing: null,
      ddTrailingMax: null,
      trailingDrawdownFloor: null,
      trailingDrawdownPeak: null,
      trailingDrawdownMode: null,
      trailingDrawdownTrailMode: null,
      trailingDrawdownFloorLocked: false,
      trailingDrawdownTrailToBreakeven: false,
      profitTargetPercent: null,
      profitTargetProgress: 0,
      minTradingDays: null,
      tradingDaysCompleted: 0,
      minDaysProgress: 0,
      status: a.status,
      phase: a.phase,
      highWaterMark: a.balance,
      startingBalance: a.template?.startingBalance ?? a.balance,
      currency: "USD",
      lastMarkTs: new Date().toISOString(),
    });
  },

  // ── Symbols & market data ──
  getSymbols: () => Promise.resolve(DEMO_SYMBOLS),
  getCandles: (
    symbol: string,
    timeframe: string,
    limit?: number,
    _range?: { fromMs?: number; toMs?: number },
  ) =>
    Promise.resolve(getHistory(symbol, timeframe, limit)),
  getCandlesWithMeta: (symbol: string, timeframe: string, limit?: number) =>
    Promise.resolve(candlesMeta(getHistory(symbol, timeframe, limit))),
  getTick: (symbol: string) => {
    const price = engine.getLastPrice(symbol);
    return Promise.resolve({ symbol, bid: price, ask: price, timestamp: Date.now() });
  },
  getMarketDataHealth: () => Promise.resolve({ status: "ok" }),
  getEconomicCalendar: (_currencies: string[], _from?: string, _to?: string) =>
    Promise.resolve([] as unknown[]),

  // ── Trading (paper engine; replay sessions are routed by account/position/order id) ──
  placeOrder: (data: engine.PlaceOrderArgs) =>
    backendForAccount(data.accountId)?.placeOrder(data) ?? Promise.resolve(engine.placeOrder(data)),
  cancelOrder: (orderId: string) =>
    backendForOrder(orderId)?.cancelOrder(orderId) ?? Promise.resolve(engine.cancelOrder(orderId)),
  // Live demo orders fill immediately, so only replay sessions have pending orders to modify.
  modifyOrder: (orderId: string, mods: OrderModifications) =>
    backendForOrder(orderId)?.modifyOrder(orderId, mods) ??
    Promise.resolve(engine.getOrders().find((o) => o.id === orderId)),
  cancelAllOrders: () => Promise.resolve({ success: true }),
  getOrders: (accountId?: string, _status?: string) =>
    Promise.resolve(backendForAccount(accountId)?.getOrders() ?? engine.getOrders()),
  getPositions: (accountId?: string) =>
    Promise.resolve(backendForAccount(accountId)?.getPositions() ?? engine.getPositions()),
  getOpenPositionCount: () => Promise.resolve(engine.getPositions().length),
  closePosition: (positionId: string, quantity?: number) =>
    backendForPosition(positionId)?.closePosition(positionId, quantity) ??
    Promise.resolve(engine.closePosition(positionId, quantity)),
  closeAllPositions: (accountId?: string) =>
    backendForAccount(accountId)?.closeAllPositions() ?? Promise.resolve(engine.closeAllPositions()),
  modifyPosition: (positionId: string, mods: PositionModifications) =>
    backendForPosition(positionId)?.modifyPosition(positionId, mods) ??
    Promise.resolve(engine.modifyPosition(positionId, mods)),
  getFills: () => Promise.resolve({ data: engine.getFills(), total: engine.getFills().length, page: 1, pageSize: 50, totalPages: 1 }),
  getClosedPositions: (accountId?: string, _page?: number) => {
    const data = backendForAccount(accountId)?.getClosedPositions() ?? engine.getClosedPositions();
    return Promise.resolve({ data, total: data.length, page: 1, pageSize: data.length || 50, totalPages: 1 });
  },
  getClosedPositionsSummary: () => Promise.resolve({ realizedPnl: 0, trades: 0, wins: 0, losses: 0 }),
  getFillQuality: () => Promise.resolve([]),

  // ── Trade journal (localStorage-free demo: empty) ──
  getJournalEntries: (_accountId: string, _opts?: { limit?: number; symbol?: string }) =>
    Promise.resolve<JournalEntriesResponse>({ entries: [], total: 0 }),
  createJournalEntry: (_input: CreateJournalEntryInput) => Promise.resolve<JournalEntry | null>(null),
  updateJournalEntry: (_id: string, _input: UpdateJournalEntryInput) =>
    Promise.resolve<JournalEntry | null>(null),
  deleteJournalEntry: (_id: string) => Promise.resolve({ success: true }),

  // ── Chart persistence ──
  chartDrawings,
  getPreferences: () => Promise.resolve<Record<string, string> | null>(null),
  savePreferences: (_prefs: Record<string, string>) => Promise.resolve({ success: true }),

  // ── Feature gating / misc (terminal reads these on mount) ──
  getFeatureFlags: () => Promise.resolve({}),
  isAiTraderEnabled: () => Promise.resolve({ enabled: false }),
  getAnnouncements: () => Promise.resolve([]),
  getAnnouncementsUnreadCount: () => Promise.resolve(0),
};

import type { DrawingLine } from "../../pages/trading/constants.ts";
import type { Candle } from "../schemas.ts";
import { getHistory } from "./candles.ts";
import * as engine from "./engine.ts";
import { DEMO_SYMBOLS } from "./instruments.ts";

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
  remove: (drawingId: string) => {
    for (const s of DEMO_SYMBOLS) {
      writeDrawings(s.name, readDrawings(s.name).filter((d) => d.id !== drawingId));
    }
    return Promise.resolve({ deleted: true });
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
  login: () => Promise.resolve(authResponse()),
  demoLogin: () => Promise.resolve(authResponse()),
  register: () => Promise.resolve(authResponse()),
  completeMfaLogin: () => Promise.resolve(authResponse()),
  logout: () => Promise.resolve({ success: true }),
  refreshToken: () => Promise.resolve({ accessToken: "demo-token", refreshToken: "demo-refresh" }),
  getMyProfile: () => Promise.resolve(DEMO_USER),
  getMe: () => Promise.resolve(DEMO_USER),

  // ── Accounts ──
  getMyAccounts: () => Promise.resolve(engine.getAccounts()),
  getAccount: () => Promise.resolve(engine.getAccount()),
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
  getAccountMetrics: () => {
    const a = engine.getAccount();
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
  getCandles: (symbol: string, timeframe: string, limit?: number) =>
    Promise.resolve(getHistory(symbol, timeframe, limit)),
  getCandlesWithMeta: (symbol: string, timeframe: string, limit?: number) =>
    Promise.resolve(candlesMeta(getHistory(symbol, timeframe, limit))),
  getTick: (symbol: string) => {
    const price = engine.getLastPrice(symbol);
    return Promise.resolve({ symbol, bid: price, ask: price, timestamp: Date.now() });
  },
  getMarketDataHealth: () => Promise.resolve({ status: "ok" }),
  getEconomicCalendar: () => Promise.resolve([]),

  // ── Trading (paper engine) ──
  placeOrder: (data: engine.PlaceOrderArgs) => Promise.resolve(engine.placeOrder(data)),
  cancelOrder: (orderId: string) => Promise.resolve(engine.cancelOrder(orderId)),
  modifyOrder: (orderId: string) => Promise.resolve(engine.getOrders().find((o) => o.id === orderId)),
  cancelAllOrders: () => Promise.resolve({ success: true }),
  getOrders: () => Promise.resolve(engine.getOrders()),
  getPositions: () => Promise.resolve(engine.getPositions()),
  getOpenPositionCount: () => Promise.resolve(engine.getPositions().length),
  closePosition: (positionId: string, quantity?: number) =>
    Promise.resolve(engine.closePosition(positionId, quantity)),
  closeAllPositions: () => Promise.resolve(engine.closeAllPositions()),
  modifyPosition: (positionId: string, mods: { takeProfit?: number | null; stopLoss?: number | null }) =>
    Promise.resolve(engine.modifyPosition(positionId, mods)),
  getFills: () => Promise.resolve({ data: engine.getFills(), total: engine.getFills().length, page: 1, pageSize: 50, totalPages: 1 }),
  getClosedPositions: () =>
    Promise.resolve({ data: engine.getClosedPositions(), total: engine.getClosedPositions().length, page: 1, pageSize: 50, totalPages: 1 }),
  getClosedPositionsSummary: () => Promise.resolve({ realizedPnl: 0, trades: 0, wins: 0, losses: 0 }),
  getFillQuality: () => Promise.resolve([]),

  // ── Trade journal (localStorage-free demo: empty) ──
  getJournalEntries: () => Promise.resolve([]),
  createJournalEntry: () => Promise.resolve(null),
  updateJournalEntry: () => Promise.resolve(null),
  deleteJournalEntry: () => Promise.resolve({ success: true }),

  // ── Chart persistence ──
  chartDrawings,
  savePreferences: () => Promise.resolve({ success: true }),

  // ── Feature gating / misc (terminal reads these on mount) ──
  getFeatureFlags: () => Promise.resolve({}),
  isAiTraderEnabled: () => Promise.resolve(false),
  getAnnouncements: () => Promise.resolve([]),
  getAnnouncementsUnreadCount: () => Promise.resolve(0),
  replayGetSession: () => Promise.resolve(null),
};

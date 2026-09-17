import type { DrawingLine } from "../../pages/trading/constants.ts";
import { safeStorage } from "../../lib/safe-storage.ts";
import { uid } from "../../lib/uid.ts";
import type { AccountMetricsResponse } from "../api/auth.ts";
import type {
  CreateJournalEntryInput,
  JournalEntriesResponse,
  JournalEntry,
  UpdateJournalEntryInput,
} from "../api/journal.ts";
import type { MarketDataCandlesPayload } from "../api/market-data.ts";
import type { Candle, Order, Position, Symbol } from "../schemas.ts";
import { getHistory, type HistoryRange } from "./candles.ts";
import * as replay from "./replay.ts";
import * as engine from "./engine.ts";
import { DEMO_SYMBOLS } from "./instruments.ts";

/**
 * Demo-mode API. Replaces the HTTP client for everything the terminal needs:
 * trading actions hit the in-browser paper engine, market data comes from the
 * bundled real OHLC, and chart drawings persist to localStorage.
 *
 * Every method carries the signature its callers actually use, so `api` in
 * services/api.ts can be typed exactly — calling a method that does not exist
 * here is a compile error rather than a silent `null` at runtime.
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

type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: typeof DEMO_USER;
};

function authResponse(): AuthResponse {
  return { accessToken: "demo-token", refreshToken: "demo-refresh", user: DEMO_USER };
}

// ── Chart drawings (localStorage) ─────────────────────────
const DRAW_KEY = (symbol: string) => `oc_drawings_${symbol}`;

function readDrawings(symbol: string): DrawingLine[] {
  const raw = safeStorage.getItem(DRAW_KEY(symbol));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DrawingLine[]) : [];
  } catch {
    return [];
  }
}

function writeDrawings(symbol: string, list: DrawingLine[]): void {
  safeStorage.setItem(DRAW_KEY(symbol), JSON.stringify(list));
}

const chartDrawings = {
  list: (symbol: string): Promise<DrawingLine[]> => Promise.resolve(readDrawings(symbol)),
  save: (symbol: string, _timeframe: string, drawing: DrawingLine): Promise<{ saved: boolean }> => {
    const list = readDrawings(symbol).filter((d) => d.id !== drawing.id);
    list.push(drawing);
    writeDrawings(symbol, list);
    return Promise.resolve({ saved: true });
  },
  remove: (drawingId: string): Promise<{ deleted: boolean }> => {
    for (const s of DEMO_SYMBOLS) {
      writeDrawings(
        s.name,
        readDrawings(s.name).filter((d) => d.id !== drawingId),
      );
    }
    return Promise.resolve({ deleted: true });
  },
  clear: (symbol: string): Promise<{ cleared: boolean }> => {
    writeDrawings(symbol, []);
    return Promise.resolve({ cleared: true });
  },
};

// ── Trade journal (localStorage) ──────────────────────────
const JOURNAL_KEY = "oc_journal_entries";

function readJournal(): JournalEntry[] {
  const parsed = safeStorage.getJSON<JournalEntry[]>(JOURNAL_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

function writeJournal(entries: JournalEntry[]): void {
  safeStorage.setJSON(JOURNAL_KEY, entries);
}

const candlesMeta = (candles: Candle[]): MarketDataCandlesPayload => ({
  // The REST contract carries an explicit ms timestamp beside the second-based
  // chart time; mirror it so consumers typed against the real payload work.
  candles: candles.map((c) => ({ ...c, timestamp: c.time * 1000 })),
  metadata: { isPartial: false, backfillQueued: false, historicalCoverageStart: null },
});

type Paginated<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function paginate<T>(rows: T[], page = 1, pageSize = 50): Paginated<T> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const start = (safePage - 1) * pageSize;
  return {
    data: rows.slice(start, start + pageSize),
    total: rows.length,
    page: safePage,
    pageSize,
    totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
  };
}

/** Replay session payload shape (mirrors the REST contract in api/accounts.ts). */
export type ReplaySessionPayload = {
  replaySession: {
    id: string;
    status: string;
    speed: number;
    cursorTimestamp: string | null;
    sessionDate: string;
  };
  tickBuffer: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
  tradeEvents: Array<{
    id: string;
    type: "entry" | "exit" | "violation";
    timestamp: string;
    symbolName: string | null;
    side: string | null;
    price: number | null;
    pnl: number | null;
    ruleCode?: string;
  }>;
  meta: { primarySymbol: string | null; sessionDate: string; tickCount: number };
};

export const demoApi = {
  // ── Auth (no real auth in demo) ──
  login: (_email: string, _password: string): Promise<AuthResponse> =>
    Promise.resolve(authResponse()),
  demoLogin: (): Promise<AuthResponse> => Promise.resolve(authResponse()),
  register: (_input: unknown): Promise<AuthResponse> => Promise.resolve(authResponse()),
  completeMfaLogin: (_mfaToken: string, _code: string): Promise<AuthResponse> =>
    Promise.resolve(authResponse()),
  logout: (_refreshToken?: string): Promise<{ success: boolean }> =>
    Promise.resolve({ success: true }),
  refreshToken: (_token: string): Promise<{ accessToken: string; refreshToken: string }> =>
    Promise.resolve({ accessToken: "demo-token", refreshToken: "demo-refresh" }),
  getMyProfile: () => Promise.resolve(DEMO_USER),
  getMe: () => Promise.resolve(DEMO_USER),

  // ── Accounts ──
  getMyAccounts: () => Promise.resolve(engine.getAccounts()),
  getAccount: (_accountId?: string) => Promise.resolve(engine.getAccount()),
  getEquityHistory: (_accountId: string) => Promise.resolve([]),
  getLedger: (_accountId: string, page = 1) => Promise.resolve(paginate([], page)),
  getAccountStats: (_accountId: string) =>
    Promise.resolve({
      totalTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      bestTrade: 0,
      worstTrade: 0,
    }),
  setAccountLabel: (_accountId: string, _label: string) => Promise.resolve({ success: true }),
  getAccountMetrics: (_accountId: string): Promise<AccountMetricsResponse> => {
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
    } as AccountMetricsResponse);
  },

  // ── Symbols & market data ──
  getSymbols: (): Promise<Symbol[]> => Promise.resolve(DEMO_SYMBOLS),
  getCandles: (
    symbol: string,
    timeframe: string,
    limit?: number,
    range?: HistoryRange,
  ): Promise<Candle[]> => getHistory(symbol, timeframe, limit, range),
  getCandlesWithMeta: (
    symbol: string,
    timeframe: string,
    limit?: number,
    range?: HistoryRange,
  ): Promise<MarketDataCandlesPayload> =>
    getHistory(symbol, timeframe, limit, range).then(candlesMeta),
  getTick: (symbol: string) => {
    const price = engine.getLastPrice(symbol);
    return Promise.resolve({ symbol, bid: price, ask: price, timestamp: Date.now() });
  },
  getMarketDataHealth: () => Promise.resolve({ status: "ok" as const }),
  getEconomicCalendar: (_currencies: string[], _from?: string, _to?: string) =>
    Promise.resolve([]),

  // ── Trading (paper engine) ──
  placeOrder: (data: engine.PlaceOrderArgs): Promise<Order> =>
    Promise.resolve(engine.placeOrder(data)),
  cancelOrder: (orderId: string) => Promise.resolve(engine.cancelOrder(orderId)),
  modifyOrder: (orderId: string, mods: engine.OrderModifications): Promise<Order> =>
    Promise.resolve(engine.modifyOrder(orderId, mods)),
  cancelAllOrders: (_accountId?: string) => Promise.resolve(engine.cancelAllOrders()),
  getOrders: (_accountId: string, status?: string): Promise<Order[]> => {
    const all = engine.getOrders();
    return Promise.resolve(status ? all.filter((o) => o.status === status) : all);
  },
  getPositions: (_accountId: string): Promise<Position[]> => Promise.resolve(engine.getPositions()),
  getOpenPositionCount: () => Promise.resolve(engine.getPositions().length),
  closePosition: (positionId: string, quantity?: number) =>
    Promise.resolve(engine.closePosition(positionId, quantity)),
  closeAllPositions: (_accountId?: string) => Promise.resolve(engine.closeAllPositions()),
  modifyPosition: (
    positionId: string,
    mods: { takeProfit?: number | null; stopLoss?: number | null },
  ): Promise<Position> => Promise.resolve(engine.modifyPosition(positionId, mods)),
  getFills: (_accountId: string, page = 1) => Promise.resolve(paginate(engine.getFills(), page)),
  getClosedPositions: (_accountId: string, page = 1) =>
    Promise.resolve(paginate(engine.getClosedPositions(), page)),
  getClosedPositionsSummary: (_accountId: string) =>
    Promise.resolve(engine.getClosedPositionsSummary()),
  getFillQuality: (_accountId: string) => Promise.resolve([]),

  // ── Trade journal (persisted to localStorage) ──
  getJournalEntries: (
    accountId: string,
    opts?: { limit?: number; symbol?: string },
  ): Promise<JournalEntriesResponse> => {
    let entries = readJournal().filter((e) => e.accountId === accountId);
    if (opts?.symbol) entries = entries.filter((e) => e.symbolName === opts.symbol);
    const total = entries.length;
    if (opts?.limit != null && opts.limit > 0) entries = entries.slice(0, opts.limit);
    return Promise.resolve({ entries, total });
  },
  createJournalEntry: (data: CreateJournalEntryInput): Promise<JournalEntry> => {
    const entry: JournalEntry = {
      id: uid(),
      accountId: data.accountId,
      positionId: data.positionId ?? null,
      symbolName: data.symbolName ?? null,
      side: data.side ?? null,
      entryPrice: data.entryPrice ?? null,
      exitPrice: data.exitPrice ?? null,
      pnl: data.pnl ?? null,
      emotion: data.emotion ?? null,
      setupType: null,
      rating: data.rating ?? null,
      tags: data.tags ?? [],
      notes: data.notes ?? "",
      createdAt: new Date().toISOString(),
    };
    // Newest first, matching the REST contract the panel was built against.
    writeJournal([entry, ...readJournal()]);
    return Promise.resolve(entry);
  },
  updateJournalEntry: (id: string, data: UpdateJournalEntryInput): Promise<JournalEntry | null> => {
    const all = readJournal();
    const idx = all.findIndex((e) => e.id === id);
    if (idx < 0) return Promise.resolve(null);
    const updated: JournalEntry = {
      ...all[idx]!,
      ...(data.emotion !== undefined ? { emotion: data.emotion } : {}),
      ...(data.rating !== undefined ? { rating: data.rating } : {}),
      ...(data.tags !== undefined ? { tags: data.tags } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    };
    all[idx] = updated;
    writeJournal(all);
    return Promise.resolve(updated);
  },
  deleteJournalEntry: (id: string) => {
    writeJournal(readJournal().filter((e) => e.id !== id));
    return Promise.resolve({ success: true });
  },

  // ── Chart persistence ──
  chartDrawings,
  /** No server-side preference store in demo mode — local values are authoritative. */
  getPreferences: (): Promise<Record<string, string> | null> => Promise.resolve(null),
  savePreferences: (_prefs: Record<string, string>) => Promise.resolve({ success: true }),

  // ── Feature gating / misc (terminal reads these on mount) ──
  getFeatureFlags: (): Promise<Record<string, boolean>> => Promise.resolve({}),
  getAnnouncements: (_page?: number) => Promise.resolve([]),
  getAnnouncementsUnreadCount: () => Promise.resolve(0),
  // ── Session replay (client-driven; see services/demo/replay.ts) ──
  replayGetSession: (
    _accountId: string,
    sessionDate: string,
    symbol?: string,
  ): Promise<ReplaySessionPayload | null> => replay.getSession(sessionDate, symbol),
  replayStart: (_accountId: string, sessionDate: string, speed = 1, symbol?: string) =>
    replay.start(sessionDate, speed, symbol),
  replayPause: (_accountId: string, _sessionDate: string) => {
    replay.pause();
    return Promise.resolve({ success: true });
  },
  replayResume: (_accountId: string, _sessionDate: string) => {
    replay.resume();
    return Promise.resolve({ success: true });
  },
  replayStop: (_accountId: string, _sessionDate: string) => {
    replay.stop();
    return Promise.resolve({ success: true });
  },
  replaySetSpeed: (_accountId: string, _sessionDate: string, speed: number) =>
    Promise.resolve(replay.setSpeed(speed)),
  replaySeek: (_accountId: string, _sessionDate: string, timestamp: string) =>
    Promise.resolve(replay.seek(timestamp)),
  replayPatchSession: (
    _accountId: string,
    patch: { sessionDate?: string; cursorTimestamp?: number },
  ) => {
    replay.patchSession(patch);
    return Promise.resolve({ success: true });
  },
};

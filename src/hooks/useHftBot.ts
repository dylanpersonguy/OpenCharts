/**
 * useHftBot — HFT Arbitrage Bot engine (WP7-parity edition)
 *
 * Core mechanic (latency arbitrage):
 *   delayed ticks  = account's "current" price (WS MarketTick, lagMs behind)
 *   live ticks     = real market NOW (WS HftLiveTick, sub-50ms latency)
 *   gap (pips)     = (livePrice - accountPrice) / pipSize
 *
 * Trade logic mirrors WesternPips7:
 *   - Momentum filter: only enter in direction of fast-feed momentum
 *   - WP7 TP: net gap × convergence_probability (confidence-weighted, spread-adjusted)
 *   - WP7 SL: max adverse excursion based on historical gap distribution
 *   - Trailing TP: tightens as gap converges to lock in profit early
 *   - Time-based exit: close if position age > 2.5 × measured lag (gap not converging)
 *   - Requote retry: retry order up to 2× before cooling down
 */
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTradingStore } from "../services/store";
import { fetchLivePrices, type HftBotConfig } from "../services/hft-bot-api";
import { api } from "../services/api";
import { queryKeys } from "../services/queries";
import type { Position } from "../services/schemas";

export type LogLevel = "INFO" | "SIGNAL" | "ORDER" | "WARN" | "ERROR";
export interface BotLogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  message: string;
}

export interface Signal {
  symbol: string;
  direction: "BUY" | "SELL" | "HOLD";
  livePrice: number;
  accountPrice: number;
  gapPips: number;
  netGapPips: number;            // gap after spread deduction
  spreadPips: number;
  pipSize: number;
  autoTp: number | null;
  autoSl: number | null;
  tpPips: number;
  slPips: number;
  convergenceProbability: number;
  momentum: number;              // pips/tick over last 3 live ticks (+ = rising)
  avgGapPips: number;            // historical average — used by dynamic lot sizing
  effectiveLotSize: number;      // lot size after applying dynamic multiplier
  isAdaptiveTp: boolean;         // true when adaptive (live-anchored) TP is active
}

export interface GapSample {
  ts: number;
  gapPips: number;
  liveMid: number;     // fast-feed mid price at this moment
  delayedMid: number;  // slow-feed mid price at this moment
}

export interface GapStats {
  symbol: string;
  livePrice: number;
  accountPrice: number;
  gapPips: number;
  netGapPips: number;              // gap - spread (actual tradeable opportunity)
  spreadPips: number;
  avgGapPips: number;
  maxGapPips: number;
  measuredLagMs: number;
  momentum: number;                // live price momentum in pips over last 3 readings
  history: GapSample[];
  hasFeed: boolean;
  effectiveMinPipGap: number;      // per-symbol threshold (dynamic or static)
  effectiveMaxGapPips: number;     // spike ceiling (Infinity = no ceiling)
  persistenceCount: number;        // consecutive readings above effectiveMinPipGap
  /** EMA-computed dynamic threshold when enableDynamicThreshold is on; null otherwise. */
  dynamicThreshold: number | null;
}

/** Recorded outcome for a single completed trade. */
export interface TradeOutcome {
  positionId: string;
  symbol: string;
  direction: "BUY" | "SELL";
  gapAtEntry: number;
  thresholdAtEntry: number;
  entryTs: number;
  holdTimeMs: number;
  exitReason: "TP" | "SL_OR_SERVER" | "TIME";
}

/** Aggregated per-symbol performance derived from recent trade outcomes. */
export interface SymbolPerformance {
  symbol: string;
  tradeCount: number;
  tpRate: number;        // fraction of trades that hit TP (vs time exit)
  avgHoldMs: number;
  /** Calibration hint: positive = raise threshold, negative = lower it. Null until ≥10 trades. */
  suggestedThresholdAdj: number | null;
}

export interface BotStats {
  tradesToday: number;
  dailyPnl: number;
  openPositions: number;
}

const HISTORY_WINDOW_MS = 60_000;
const COOLDOWN_MS = 30_000;
const MOMENTUM_WINDOW = 3;          // number of live ticks to compute momentum over
const LIVE_HISTORY_TTL_MS = 5_000;  // keep last 5s of live ticks per symbol
const DEFAULT_TIME_EXIT_FACTOR = 1.0; // exit at exactly 1× the measured lag window
const MIN_MEASURED_LAG_MS = 5_000;  // floor for time-exit calculation
const MAX_ORDER_RETRIES = 2;        // requote retries before giving up
const RETRY_DELAY_MS = 150;         // ms between retries
const DYNAMIC_THRESH_MIN_SAMPLES = 10; // minimum gap history before dynamic threshold activates
const TP_RATE_LIMIT_MS = 100;       // max one modifyPosition per position per 100ms
const MAX_TRADE_OUTCOMES = 200;     // per-symbol outcome cap (oldest evicted)
let logIdCounter = 0;

/** Index symbols that only trade during exchange hours (vs FX/crypto which trade 24/5). */
const INDEX_SYMBOLS = new Set(["NAS100", "US500", "US30", "DAX40", "ASX", "NIKKEI", "UK100"]);

export const FALLBACK_PIP_SIZES: Record<string, number> = {
  XAUUSD: 0.1,  XAGUSD: 0.001,
  BTCUSD: 1.0,  ETHUSD: 0.1,  BNBUSD: 0.01,
  EURUSD: 0.0001, GBPUSD: 0.0001, AUDUSD: 0.0001, NZDUSD: 0.0001,
  USDCAD: 0.0001, USDCHF: 0.0001, USDJPY: 0.01,
  GBPJPY: 0.01, EURJPY: 0.01, AUDJPY: 0.01,
  EURGBP: 0.0001,
  NAS100: 0.01, US500: 0.01, US30: 1.0, DAX40: 0.01,
  USOIL: 0.01,  BRENT: 0.01,
};

function makeLog(level: LogLevel, message: string): BotLogEntry {
  return { id: ++logIdCounter, ts: Date.now(), level, message };
}

function resolvePipSize(symbol: string, catalogue: Record<string, number>): number {
  return Math.max(catalogue[symbol] ?? 0, FALLBACK_PIP_SIZES[symbol] ?? 0) || 0.0001;
}

/**
 * WP7-parity TP/SL calculation.
 *
 * TP = net gap × convergence_probability
 *   where net gap = |gapPips| - spreadPips  (the actual edge after spread cost)
 *   and convergence_probability decreases as the gap approaches its historical max
 *   (extreme gaps are less reliable — broker may be catching up mid-spike)
 *
 * SL = max adverse excursion proxy
 *   Sized from the historical average gap so the SL is placed at a distance
 *   the gap would only reach if it EXPANDED rather than converged.
 *
 * Both anchored to the delayed entry price (what the account fills at).
 */
function computeWP7Levels(params: {
  entryPrice: number;
  gapPips: number;
  pipSize: number;
  direction: "BUY" | "SELL";
  spreadPips: number;
  maxGapPips: number;
  avgGapPips: number;
}): { tp: number | null; sl: number | null; tpPips: number; slPips: number; convergenceProbability: number } {
  const { entryPrice, gapPips, pipSize, direction, spreadPips, maxGapPips, avgGapPips } = params;
  const absGap = Math.abs(gapPips);

  const gapVsMax = maxGapPips > 0 ? absGap / maxGapPips : 0.5;
  const convergenceProbability = Math.max(0.65, Math.min(0.92, 0.92 - gapVsMax * 0.22));

  const netGap = Math.max(0, absGap - spreadPips);
  const tpPips = netGap * convergenceProbability;
  const slPips = avgGapPips > 0 ? avgGapPips * 0.5 : absGap * 0.4;

  const tp = tpPips > 0
    ? (direction === "BUY" ? entryPrice + tpPips * pipSize : entryPrice - tpPips * pipSize)
    : null;
  const sl = slPips > 0
    ? (direction === "BUY" ? entryPrice - slPips * pipSize : entryPrice + slPips * pipSize)
    : null;

  return { tp, sl, tpPips, slPips, convergenceProbability };
}

/**
 * Adaptive TP anchored to the live price at entry.
 *
 * TP = livePrice - halfSpread (BUY) | livePrice + halfSpread (SELL)
 *
 * Captures ~100% of the net gap instead of WP7's convergence-probability
 * fraction (~85%). The trade closes when the delayed feed reaches the live
 * price that existed at entry time — which is exactly when the lag gap closes.
 *
 * SL: same MAE-based model as computeWP7Levels (unchanged).
 */
function computeAdaptiveLevels(params: {
  entryPrice: number;
  livePrice: number;
  gapPips: number;
  pipSize: number;
  direction: "BUY" | "SELL";
  spreadPips: number;
  avgGapPips: number;
}): { tp: number | null; sl: number | null; tpPips: number; slPips: number; convergenceProbability: number } {
  const { entryPrice, livePrice, gapPips, pipSize, direction, spreadPips, avgGapPips } = params;
  const absGap = Math.abs(gapPips);
  const halfSpreadPips = spreadPips / 2;

  // TP = gap - half-spread: fires when delayed catches up to live price at entry
  const tpPips = Math.max(0, absGap - halfSpreadPips);
  const tp = tpPips > 0
    ? (direction === "BUY"
      ? livePrice - halfSpreadPips * pipSize
      : livePrice + halfSpreadPips * pipSize)
    : null;

  // SL: MAE-based — half the historical average gap
  const slPips = avgGapPips > 0 ? avgGapPips * 0.5 : absGap * 0.4;
  const sl = slPips > 0
    ? (direction === "BUY" ? entryPrice - slPips * pipSize : entryPrice + slPips * pipSize)
    : null;

  return { tp, sl, tpPips, slPips, convergenceProbability: 1.0 };
}

export function useHftBot(
  config: HftBotConfig | null,
  accountId: string | null,
  isRunning: boolean,
  symbolPipSizes: Record<string, number> = {},
) {
  const queryClient = useQueryClient();

  // Delayed ticks — what the account "sees" (lagMs behind live)
  const delayedTicks = useTradingStore((s) => s.ticks);
  // Live ticks — real market price pushed via HftLiveTick WS event (sub-50ms).
  // When the live feed is active, these update instantly. When degraded, they go
  // stale — the REST fallback below fills the gap using the 5-minute cache.
  const wsLiveTicks = useTradingStore((s) => s.liveTicks);
  const positions = useTradingStore((s) => s.positions);
  const accounts  = useTradingStore((s) => s.accounts);

  // REST fallback prices — polled every 2s from the live-price-cache (300s TTL).
  // Only used when WS live ticks haven't arrived for a given symbol; WS wins.
  const [restPrices, setRestPrices] = useState<Record<string, { bid: number; ask: number }>>({});
  const lastWsTickRef = useRef<Record<string, number>>({}); // symbol → last WS tick ms

  // Merged live prices: WS tick if fresh (<3s), otherwise REST cache fallback
  const liveTicks = useMemo(() => {
    const now = Date.now();
    const merged: Record<string, { bid: number; ask: number; timestamp: number }> = {};
    // Seed with REST prices first
    for (const [sym, p] of Object.entries(restPrices)) {
      merged[sym] = { ...p, timestamp: now };
    }
    // Override with WS ticks (always fresher when present)
    for (const [sym, tick] of Object.entries(wsLiveTicks)) {
      merged[sym] = tick;
      lastWsTickRef.current[sym] = now;
    }
    return merged;
  }, [wsLiveTicks, restPrices]);

  const [botStats, setBotStats] = useState<BotStats>({ tradesToday: 0, dailyPnl: 0, openPositions: 0 });
  const [log, setLog] = useState<BotLogEntry[]>([]);
  /** posId → bot-tracked TP (trailing peak). React state so the chart re-renders
   *  immediately when TP moves, without waiting for RQ refetch. */
  const [trackedTps, setTrackedTps] = useState<Record<string, number>>({});

  const gapHistoryRef      = useRef<Record<string, GapSample[]>>({});
  // Tracks last LIVE_HISTORY_TTL_MS of live mid prices per symbol for momentum
  const liveHistoryRef     = useRef<Record<string, Array<{ mid: number; ts: number }>>>({});
  // Snapshot of measuredLagMs per symbol captured at trade-entry time.
  const lagAtEntryRef      = useRef<Record<string, number>>({});
  // Consecutive readings where |gap| >= effectiveMinPipGap — used by the
  // persistence filter to reject single-tick spikes.
  const persistenceRef     = useRef<Record<string, number>>({});
  const cooldownRef        = useRef<Record<string, number>>({});
  const execLockRef        = useRef(false);
  const tradesTodayRef     = useRef(0);
  const startEquityRef     = useRef<number | null>(null);
  const trailingTpRef      = useRef<Record<string, number>>({});  // posId → last adjusted TP
  const isRunningRef       = useRef(isRunning);
  isRunningRef.current = isRunning;

  // ── Dynamic threshold EMA state ──────────────────────────────
  const thresholdEmaRef    = useRef<Record<string, number>>({});
  const lastEmaUpdateRef   = useRef<Record<string, number>>({});

  // ── Adaptive TP reliability ───────────────────────────────────
  /** Last modifyPosition call time per position — prevents API flood */
  const lastTpUpdateMsRef  = useRef<Record<string, number>>({});
  /** Last TP value successfully sent to the server via modifyPosition.
   *  Used as the "server-confirmed" baseline for serverNeedsUpdate checks.
   *  Separate from trailingTpRef (peak) and pos.takeProfit from RQ (optimistic). */
  const lastSentTpRef      = useRef<Record<string, number>>({});
  /** Guards against duplicate client-side close attempts — stores the timestamp the
   *  attempt was made. Auto-clears after 5 s so a silent server failure gets retried. */
  const clientTpFiredRef   = useRef<Record<string, number>>({});

  // ── Self-improvement: trade outcome tracking ──────────────────
  /** Entry metadata keyed by position ID — populated when the bot opens a trade */
  const tradeEntryDataRef  = useRef<Record<string, {
    symbol: string; direction: "BUY" | "SELL";
    gapAtEntry: number; thresholdAtEntry: number; entryTs: number;
  }>>({});
  /** Completed outcomes per symbol (capped at MAX_TRADE_OUTCOMES each) */
  const tradeOutcomesRef   = useRef<Record<string, TradeOutcome[]>>({});
  /** Position IDs present on previous render — detects closes */
  const prevPositionIdsRef = useRef<Set<string>>(new Set());

  const addLog = useCallback((level: LogLevel, message: string) => {
    setLog((prev) => {
      const next = [makeLog(level, message), ...prev];
      return next.slice(0, 100);
    });
  }, []);

  // Log start/stop
  const prevRunning = useRef(false);
  useEffect(() => {
    if (isRunning && !prevRunning.current) addLog("INFO", "Bot started — WS live-price feed active");
    if (!isRunning && prevRunning.current) addLog("INFO", "Bot stopped");
    prevRunning.current = isRunning;
  }, [isRunning, addLog]);

  // Capture start equity
  useEffect(() => {
    if (!isRunning || !accountId) { startEquityRef.current = null; return; }
    const acct = (accounts as Array<{ id: string; equity?: number }>).find((a) => a.id === accountId);
    if (acct?.equity != null) startEquityRef.current = acct.equity;
  }, [isRunning, accountId, accounts]);

  // Sync daily P&L
  useEffect(() => {
    if (startEquityRef.current == null || !accountId) return;
    const acct = (accounts as Array<{ id: string; equity?: number }>).find((a) => a.id === accountId);
    if (acct?.equity == null) return;
    setBotStats((p) => ({ ...p, dailyPnl: acct.equity! - startEquityRef.current! }));
  }, [accounts, accountId]);

  // Keep open positions count in sync
  useEffect(() => {
    const count = positions.filter((p) => p.accountId === accountId).length;
    setBotStats((p) => ({ ...p, openPositions: count }));
  }, [positions, accountId]);

  // Reset at midnight
  useEffect(() => {
    const now = new Date();
    const msUntilMidnight =
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
    const tid = setTimeout(() => { tradesTodayRef.current = 0; startEquityRef.current = null; }, msUntilMidnight);
    return () => clearTimeout(tid);
  }, []);

  // Maintain rolling live-tick history for momentum computation
  useEffect(() => {
    const now = Date.now();
    const cutoff = now - LIVE_HISTORY_TTL_MS;
    for (const [symbol, tick] of Object.entries(liveTicks)) {
      const mid = (tick.bid + tick.ask) / 2;
      const history = liveHistoryRef.current[symbol] ?? [];
      history.push({ mid, ts: now });
      while (history.length > 0 && history[0]!.ts < cutoff) history.shift();
      liveHistoryRef.current[symbol] = history;
    }
  }, [liveTicks]);

  // REST fallback poll — runs every 2s but only fetches symbols where WS live ticks
  // haven't arrived recently. The 5-minute cache TTL means prices survive short outages.
  const symbolsKey = config?.symbols?.join(",") ?? "";
  const restErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!symbolsKey) return;
    const syms = symbolsKey.split(",").filter(Boolean);
    const doFetch = () => {
      const now = Date.now();
      // Only request symbols where WS hasn't delivered a tick in the last 3s
      const stale = syms.filter((sym) => (now - (lastWsTickRef.current[sym] ?? 0)) > 3_000);
      if (stale.length === 0) return;
      fetchLivePrices(stale)
        .then((prices) => {
          if (Object.keys(prices).length > 0) {
            setRestPrices((prev) => ({ ...prev, ...prices }));
          }
          if (restErrorRef.current !== null) {
            addLog("INFO", "Live price feed restored (REST fallback)");
            restErrorRef.current = null;
          }
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (restErrorRef.current !== msg) {
            addLog("ERROR", `Live prices unavailable: ${msg}`);
            restErrorRef.current = msg;
          }
        });
    };
    doFetch();
    const id = setInterval(doFetch, 2_000);
    return () => clearInterval(id);
  }, [symbolsKey, addLog]);

  // Log when a symbol has no feed (once per minute)
  const noFeedLoggedRef = useRef<Record<string, number>>({});
  // Track when the bot first noticed a symbol had no feed (to escalate message after 5 min)
  const noFeedSinceRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!config || !isRunning) return;
    const now = Date.now();
    for (const sym of config.symbols) {
      const hasFeed = !!liveTicks[sym] && !!delayedTicks[sym];
      if (!hasFeed) {
        if (!noFeedSinceRef.current[sym]) noFeedSinceRef.current[sym] = now;
        const lastLogged = noFeedLoggedRef.current[sym] ?? 0;
        if (now - lastLogged > 60_000) {
          const outageMs = now - noFeedSinceRef.current[sym];
          const isIndex = INDEX_SYMBOLS.has(sym);
          // After 5 min with no data, hint at market hours for index symbols
          const msg = outageMs > 300_000 && isIndex
            ? `${sym}: No market data — symbol may be outside exchange hours (check US markets are open 9:30 AM – 4 PM ET, Mon–Fri)`
            : `${sym}: No market data — live feed not yet received`;
          addLog("WARN", msg);
          noFeedLoggedRef.current[sym] = now;
        }
      } else {
        noFeedLoggedRef.current[sym] = 0;
        noFeedSinceRef.current[sym] = 0;
      }
    }
  }, [liveTicks, delayedTicks, config, isRunning, addLog]);

  // ── Gap Stats ────────────────────────────────────────────────
  const gapStats = useMemo<GapStats[]>(() => {
    if (!config || config.symbols.length === 0) return [];
    const now = Date.now();
    return config.symbols.map((symbol) => {
      const live    = liveTicks[symbol];
      const delayed = delayedTicks[symbol];
      const pipSize = resolvePipSize(symbol, symbolPipSizes);

      const liveMid    = live    ? (live.bid    + live.ask)    / 2 : 0;
      const delayedMid = delayed ? (delayed.bid + delayed.ask) / 2 : 0;
      const hasFeed    = liveMid > 0 && delayedMid > 0;

      const spreadPips    = live && pipSize > 0 ? (live.ask - live.bid) / pipSize : 0;
      const gapPips       = hasFeed && pipSize > 0 ? (liveMid - delayedMid) / pipSize : 0;
      const netGapPips    = Math.abs(gapPips) - spreadPips;
      const measuredLagMs = delayed?.timestamp ? now - delayed.timestamp : 0;

      // ── 1. History (must come before threshold so dynamic mode has fresh data) ──
      const history = gapHistoryRef.current[symbol] ?? [];
      if (hasFeed) {
        history.push({ ts: now, gapPips, liveMid, delayedMid });
        const cutoff = now - HISTORY_WINDOW_MS;
        while (history.length > 0 && history[0]!.ts < cutoff) history.shift();
      }
      gapHistoryRef.current[symbol] = history;

      const absVals    = history.map((s) => Math.abs(s.gapPips));
      const avgGapPips = absVals.length > 0 ? absVals.reduce((a, b) => a + b, 0) / absVals.length : 0;
      const maxGapPips = absVals.length > 0 ? Math.max(...absVals) : 0;

      // ── 2. Thresholds ──────────────────────────────────────────
      const symCfg          = (config.symbolSettings ?? {})[symbol];
      const staticMinPipGap = symCfg?.minPipGap ?? config.minPipGap;
      const effectiveMaxGapPips = symCfg?.maxGapPips ?? Infinity;

      let effectiveMinPipGap = staticMinPipGap;
      let dynamicThreshold: number | null = null;

      // Dynamic threshold: EMA(avgGapPips) × multiplier — adapts to each symbol's
      // typical activity. Rate-limited to one EMA update/second so alpha=0.1
      // gives ~10s half-life, smoothing out single-spike distortions.
      //
      // No artificial upper ceiling — the EMA smoothing already prevents single-spike
      // distortions. A hard cap based on staticMinPipGap would break instruments like
      // NAS100 where static=4p but actual gaps are 300–600p. Floor at 1 pip ensures
      // the threshold is always positive and meaningful.
      if (config.enableDynamicThreshold && avgGapPips > 0 && absVals.length >= DYNAMIC_THRESH_MIN_SAMPLES) {
        const alpha = config.dynamicThresholdAlpha ?? 0.1;
        const mult  = config.dynamicThresholdMultiplier ?? 1.2;
        if (now - (lastEmaUpdateRef.current[symbol] ?? 0) >= 1_000) {
          const prev = thresholdEmaRef.current[symbol] ?? avgGapPips;
          thresholdEmaRef.current[symbol] = alpha * avgGapPips + (1 - alpha) * prev;
          lastEmaUpdateRef.current[symbol] = now;
        }
        const ema = thresholdEmaRef.current[symbol] ?? avgGapPips;
        const raw = ema * mult;
        dynamicThreshold = Math.max(1, raw); // floor at 1 pip — no artificial upper cap
        effectiveMinPipGap = dynamicThreshold;
      }

      // ── 3. Persistence counter ────────────────────────────────
      const aboveThreshold = hasFeed
        && Math.abs(gapPips) >= effectiveMinPipGap
        && Math.abs(gapPips) <= effectiveMaxGapPips;
      persistenceRef.current[symbol] = aboveThreshold
        ? (persistenceRef.current[symbol] ?? 0) + 1
        : 0;

      // ── 4. Momentum ───────────────────────────────────────────
      const liveHistory = liveHistoryRef.current[symbol] ?? [];
      let momentum = 0;
      if (liveHistory.length >= 2) {
        const recent = liveHistory.slice(-MOMENTUM_WINDOW);
        momentum = (recent[recent.length - 1]!.mid - recent[0]!.mid) / pipSize;
      }

      return {
        symbol, livePrice: liveMid, accountPrice: delayedMid,
        gapPips, netGapPips, spreadPips,
        avgGapPips, maxGapPips, measuredLagMs,
        momentum, history: [...history], hasFeed,
        effectiveMinPipGap, effectiveMaxGapPips,
        persistenceCount: persistenceRef.current[symbol] ?? 0,
        dynamicThreshold,
      };
    });
  }, [liveTicks, delayedTicks, config, symbolPipSizes]);

  // ── Signals ──────────────────────────────────────────────────
  const signals = useMemo<Signal[]>(() => {
    if (!config) return [];
    const minPersistence = config.gapPersistenceReadings ?? 1;
    const useAdaptiveTp = config.enableAdaptiveTp !== false;
    const useDynamicLots = config.enableDynamicLotSizing === true;
    const maxMult = config.maxLotMultiplier ?? 1.5;
    const minMult = config.minLotMultiplier ?? 0.5;

    return gapStats.map(({ symbol, gapPips, netGapPips, spreadPips, livePrice, accountPrice, hasFeed, avgGapPips, maxGapPips, momentum, effectiveMinPipGap, effectiveMaxGapPips, persistenceCount }) => {
      const pipSize = resolvePipSize(symbol, symbolPipSizes);

      // Dynamic lot sizing: scale lotSize by gap confidence (currentGap / avgGap)
      let effectiveLotSize = config.lotSize;
      if (useDynamicLots && avgGapPips > 0) {
        const gapConfidence = Math.abs(gapPips) / avgGapPips;
        // Linear interpolation: at gapConfidence=1 → 1× lots; at 2× avg → maxMult × lots
        const rawMult = 1 + (gapConfidence - 1) * (maxMult - 1);
        const clampedMult = Math.max(minMult, Math.min(maxMult, rawMult));
        effectiveLotSize = Math.round(config.lotSize * clampedMult * 100) / 100;
      }

      const base = { symbol, pipSize, livePrice, accountPrice, momentum, avgGapPips, effectiveLotSize, isAdaptiveTp: useAdaptiveTp };

      if (!hasFeed) {
        return { ...base, direction: "HOLD" as const, gapPips: 0, netGapPips: 0, spreadPips: 0, autoTp: null, autoSl: null, tpPips: 0, slPips: 0, convergenceProbability: 0 };
      }

      // Per-symbol threshold with spike ceiling + persistence gate
      const absGap = Math.abs(gapPips);
      const withinCeiling = effectiveMaxGapPips === Infinity || absGap <= effectiveMaxGapPips;
      const meetsThreshold = absGap >= effectiveMinPipGap && withinCeiling;
      const sustainedEnough = persistenceCount >= minPersistence;

      let direction: Signal["direction"] = "HOLD";
      if (meetsThreshold && sustainedEnough) {
        if (gapPips > 0) direction = "BUY";
        else direction = "SELL";
      }

      if (direction === "HOLD") {
        return { ...base, direction, gapPips, netGapPips, spreadPips, autoTp: null, autoSl: null, tpPips: 0, slPips: 0, convergenceProbability: 0 };
      }

      // TP/SL: adaptive (live-anchored) or WP7 convergence model
      const levels = useAdaptiveTp
        ? computeAdaptiveLevels({ entryPrice: accountPrice, livePrice, gapPips, pipSize, direction, spreadPips, avgGapPips })
        : computeWP7Levels({ entryPrice: accountPrice, gapPips, pipSize, direction, spreadPips, maxGapPips, avgGapPips });

      return { ...base, direction, gapPips, netGapPips, spreadPips, autoTp: levels.tp, autoSl: levels.sl, tpPips: levels.tpPips, slPips: levels.slPips, convergenceProbability: levels.convergenceProbability };
    });
  }, [gapStats, config, symbolPipSizes]);

  // ── Auto-execute ─────────────────────────────────────────────
  const executeSignals = useCallback(async () => {
    if (!isRunning || !config || !accountId) return;
    if (execLockRef.current) return;
    execLockRef.current = true;

    try {
      const now = Date.now();
      const posKey = queryKeys.trading.positions(accountId);

      const cachedPositions =
        (queryClient.getQueryData<Position[]>(posKey) ?? []).filter((p) => !p.id.startsWith("opt-"));

      let localOpenCount = cachedPositions.length;
      const localOpenBySymbol = new Map<string, number>();
      for (const p of cachedPositions) {
        localOpenBySymbol.set(p.symbolName, (localOpenBySymbol.get(p.symbolName) ?? 0) + 1);
      }

      const acct = (accounts as Array<{ id: string; equity?: number }>).find((a) => a.id === accountId);
      const currentPnl = startEquityRef.current != null && acct?.equity != null
        ? acct.equity - startEquityRef.current : 0;

      const tradesPerSignal = config.tradesPerSignal ?? 1;

      for (const signal of signals) {
        if (signal.direction === "HOLD") continue;

        const since = now - (cooldownRef.current[signal.symbol] ?? 0);
        if (since < COOLDOWN_MS) continue;

        if (localOpenCount >= config.maxPositions) break;

        if (config.dailyLossCap != null && currentPnl <= -config.dailyLossCap) {
          addLog("WARN", `Daily loss cap $${config.dailyLossCap} reached — pausing`);
          break;
        }

        const alreadyOpenForSymbol = localOpenBySymbol.get(signal.symbol) ?? 0;
        if (alreadyOpenForSymbol >= tradesPerSignal) continue;

        const burstRemaining = tradesPerSignal - alreadyOpenForSymbol;
        const globalSlots    = config.maxPositions - localOpenCount;
        const burstCount     = Math.min(burstRemaining, globalSlots);
        if (burstCount <= 0) continue;

        // Snapshot the measured lag for this symbol at entry time.
        // The time exit will use this exact value so positions opened at different
        // lag conditions exit at the correct window even if lag drifts later.
        const statForSignal = gapStats.find((g) => g.symbol === signal.symbol);
        const lagSnapshotMs = Math.max(statForSignal?.measuredLagMs ?? 0, MIN_MEASURED_LAG_MS);
        lagAtEntryRef.current[signal.symbol] = lagSnapshotMs;

        // ── Momentum filter (WP7) ─────────────────────────────
        // Skip if fast-feed is moving strongly against the signal direction.
        // Threshold: 30% of minPipGap. Prevents entering as gap is already closing.
        if (config.enableMomentumFilter !== false) {
          const antiMomentumThreshold = config.minPipGap * 0.3;
          if (signal.direction === "BUY"  && signal.momentum < -antiMomentumThreshold) {
            addLog("INFO", `${signal.symbol}: Momentum filter — live falling (${signal.momentum.toFixed(1)}p), skipping BUY`);
            continue;
          }
          if (signal.direction === "SELL" && signal.momentum >  antiMomentumThreshold) {
            addLog("INFO", `${signal.symbol}: Momentum filter — live rising (${signal.momentum.toFixed(1)}p), skipping SELL`);
            continue;
          }
        }

        const tpMode = signal.isAdaptiveTp ? "live-anchor" : `conv: ${(signal.convergenceProbability * 100).toFixed(0)}%`;
        const tpNote = signal.autoTp
          ? `TP: ${signal.autoTp.toFixed(5)} (+${signal.tpPips.toFixed(2)}p, ${tpMode})`
          : `No TP (gap ≤ spread — no edge after costs)`;
        const slNote = signal.autoSl
          ? `SL: ${signal.autoSl.toFixed(5)} (-${signal.slPips.toFixed(2)}p)`
          : "No SL";
        const lotLabel = signal.effectiveLotSize !== config.lotSize
          ? ` ${signal.effectiveLotSize}L (×${(signal.effectiveLotSize / config.lotSize).toFixed(2)})`
          : ` ${signal.effectiveLotSize}L`;
        const spreadNote = `spread: ${signal.spreadPips.toFixed(2)}p`;
        const burstLabel = burstCount > 1 ? ` ×${burstCount}` : "";
        addLog(
          "SIGNAL",
          `${signal.symbol} ${signal.direction}${burstLabel}${lotLabel} | Gap: ${signal.gapPips > 0 ? "+" : ""}${signal.gapPips.toFixed(1)}p net: ${signal.netGapPips.toFixed(1)}p (${spreadNote}) | ${tpNote} | ${slNote}`,
        );

        let burstSuccesses = 0;
        for (let i = 0; i < burstCount; i++) {
          if (localOpenCount >= config.maxPositions) break;

          const optimisticId = `opt-${signal.symbol}-${Date.now()}-${i}`;
          const optimisticPos: Position = {
            id: optimisticId, accountId,
            symbolName: signal.symbol,
            side: signal.direction === "BUY" ? "LONG" : "SHORT",
            quantity: signal.effectiveLotSize,
            entryPrice: signal.accountPrice, currentPrice: signal.accountPrice,
            unrealizedPnl: 0, margin: 0,
            openedAt: new Date().toISOString(),
            takeProfit: signal.autoTp, stopLoss: signal.autoSl,
          };
          queryClient.setQueryData<Position[]>(posKey, (old) => [...(old ?? []), optimisticPos]);

          // ── Requote retry (WP7) ───────────────────────────────
          let placed = false;
          for (let attempt = 0; attempt <= MAX_ORDER_RETRIES; attempt++) {
            if (attempt > 0) {
              await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS));
              addLog("WARN", `${signal.symbol}: Retry ${attempt}/${MAX_ORDER_RETRIES}`);
            }
            try {
              await api.placeOrder({
                accountId, symbol: signal.symbol,
                side: signal.direction, type: "MARKET",
                quantity: signal.effectiveLotSize,
                ...(signal.autoTp !== null && { takeProfit: signal.autoTp }),
                ...(signal.autoSl !== null && { stopLoss: signal.autoSl }),
              });
              placed = true;
              break;
            } catch (err) {
              if (attempt === MAX_ORDER_RETRIES) {
                queryClient.setQueryData<Position[]>(posKey, (old) =>
                  (old ?? []).filter((p) => p.id !== optimisticId),
                );
                const msg = err instanceof Error ? err.message : "Order failed";
                addLog("ERROR", `${signal.symbol}: Failed after ${MAX_ORDER_RETRIES + 1} attempts — ${msg}`);
              }
            }
          }

          if (placed) {
            tradesTodayRef.current++;
            localOpenCount++;
            localOpenBySymbol.set(signal.symbol, (localOpenBySymbol.get(signal.symbol) ?? 0) + 1);
            burstSuccesses++;

            // Record entry data for outcome tracking + seed trailingTpRef
            tradeEntryDataRef.current[optimisticId] = {
              symbol: signal.symbol,
              direction: signal.direction,
              gapAtEntry: signal.gapPips,
              thresholdAtEntry: statForSignal?.effectiveMinPipGap ?? config.minPipGap,
              entryTs: Date.now(),
            };
            if (signal.autoTp != null) trailingTpRef.current[optimisticId] = signal.autoTp;

            addLog(
              "ORDER",
              `✓ ${signal.direction} ${signal.effectiveLotSize}L ${signal.symbol} @ ${signal.accountPrice.toFixed(5)}${burstCount > 1 ? ` (${burstSuccesses}/${burstCount})` : ""} | TP: ${signal.autoTp?.toFixed(5) ?? "—"} SL: ${signal.autoSl?.toFixed(5) ?? "—"}`,
            );
          }
        }

        setBotStats((p) => ({ ...p, tradesToday: tradesTodayRef.current, openPositions: localOpenCount }));
        cooldownRef.current[signal.symbol] = now;
      }
    } finally {
      execLockRef.current = false;
    }
  }, [isRunning, config, accountId, signals, symbolPipSizes, accounts, addLog, queryClient]);

  useEffect(() => {
    if (!isRunning) return;
    void executeSignals();
  }, [signals, isRunning, executeSignals]);

  // ── Time-based exit (precision lag-window exit) ───────────────
  //
  // Core principle: if the account feed is lagging by N ms, then the delayed
  // price MUST reach the live price that existed N ms ago within exactly N ms
  // of the trade opening. If TP is not hit in that window, the gap was NOT
  // pure feed lag — it was a real price move → close at market.
  //
  // Exit window per position:
  //   lagAtEntry = measuredLagMs snapshot taken when the signal fired
  //   maxAgeMs   = lagAtEntry × timeExitFactor  (default 1.0 → exact lag window)
  //
  // Per-symbol lag snapshot (lagAtEntryRef) ensures each position's window
  // is based on the lag that was present WHEN it was opened, not later drift.
  // Fallback: current gapStats measuredLagMs for the symbol if no snapshot.
  //
  // Check interval: 1 000 ms (tight enough to exit within ~1s of the window).
  useEffect(() => {
    if (!isRunning || !accountId) return;

    const timer = setInterval(async () => {
      if (!isRunningRef.current) return;
      const now = Date.now();
      const posKey = queryKeys.trading.positions(accountId);
      const openPositions = (queryClient.getQueryData<Position[]>(posKey) ?? [])
        .filter((p) => !p.id.startsWith("opt-"));
      if (!config || config.enableTimeExit === false || openPositions.length === 0) return;

      const factor = config.timeExitFactor ?? DEFAULT_TIME_EXIT_FACTOR;

      for (const pos of openPositions) {
        // Resolve lag: snapshot at entry → current stat → global floor
        const lagMs = lagAtEntryRef.current[pos.symbolName]
          ?? Math.max(
            gapStats.find((g) => g.symbol === pos.symbolName)?.measuredLagMs ?? 0,
            MIN_MEASURED_LAG_MS,
          );
        const maxAgeMs = Math.max(lagMs, MIN_MEASURED_LAG_MS) * factor;
        const ageMs = now - new Date(pos.openedAt).getTime();
        if (ageMs < maxAgeMs) continue;

        addLog(
          "WARN",
          `${pos.symbolName}: Lag-window exit — open ${(ageMs / 1000).toFixed(1)}s, ` +
          `lag window ${(lagMs / 1000).toFixed(1)}s × ${factor} = ${(maxAgeMs / 1000).toFixed(1)}s — gap did not converge`,
        );
        // Record TIME exit outcome before closing
        const timeEntry = tradeEntryDataRef.current[pos.id];
        if (timeEntry) {
          const bucket = tradeOutcomesRef.current[timeEntry.symbol] ?? [];
          bucket.push({
            positionId: pos.id, symbol: timeEntry.symbol, direction: timeEntry.direction,
            gapAtEntry: timeEntry.gapAtEntry, thresholdAtEntry: timeEntry.thresholdAtEntry,
            entryTs: timeEntry.entryTs, holdTimeMs: ageMs, exitReason: "TIME",
          });
          if (bucket.length > MAX_TRADE_OUTCOMES) bucket.shift();
          tradeOutcomesRef.current[timeEntry.symbol] = bucket;
          delete tradeEntryDataRef.current[pos.id];
        }

        try {
          await api.closePosition(pos.id);
          addLog("INFO", `${pos.symbolName}: Closed by lag-window exit after ${(ageMs / 1000).toFixed(1)}s`);
        } catch (err) {
          addLog("ERROR", `${pos.symbolName}: Lag-window exit close failed — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }, 1_000); // 1s interval — precision exit within ±1s of the lag window

    return () => clearInterval(timer);
  }, [isRunning, accountId, gapStats, config, queryClient, addLog]);

  // ── Lower trailing TP (convergence-tightening) ───────────────────
  // When the gap is closing, tighten TP toward the current price to lock in
  // profit before a potential reversal. Only fires on significant convergence
  // (gap < 60% of peak-TP distance) and only moves TP in the tighter direction.
  useEffect(() => {
    if (!isRunning || !accountId || !config || config.enableTrailingTp === false) return;

    const posKey = queryKeys.trading.positions(accountId);
    // Use RQ cache — same reason as upper trail: WS PositionOpened updates RQ, not Zustand
    const openPositions = (queryClient.getQueryData<Position[]>(posKey) ?? [])
      .filter((p) => !p.id.startsWith("opt-") && p.takeProfit != null);
    if (openPositions.length === 0) return;

    const now = Date.now();

    for (const pos of openPositions) {
      const stat = gapStats.find((g) => g.symbol === pos.symbolName);
      if (!stat || !stat.hasFeed) continue;

      const pipSize  = resolvePipSize(pos.symbolName, symbolPipSizes);
      const side     = pos.side === "LONG" ? "BUY" : "SELL";
      const currentGapAbs = Math.abs(stat.gapPips);

      // Use trailingTpRef — includes any upward expansion from the upper trail.
      // Falling back to pos.takeProfit directly would give the wrong baseline
      // and fire this tightening too early after an upper trail expansion.
      const currentTrackedTp = trailingTpRef.current[pos.id] ?? pos.takeProfit!;
      const originalTpPips = Math.abs(currentTrackedTp - pos.entryPrice) / pipSize;

      // Gap has converged more than 40% — tighten TP to 90% of remaining gap
      if (currentGapAbs < originalTpPips * 0.6 && currentGapAbs > 0) {
        const newTpPips = Math.max(currentGapAbs * 0.9, 0.1);
        const newTp = side === "BUY"
          ? pos.entryPrice + newTpPips * pipSize
          : pos.entryPrice - newTpPips * pipSize;

        const pipsChange = Math.abs(newTp - currentTrackedTp) / pipSize;
        const isTighter  = side === "BUY" ? newTp < currentTrackedTp : newTp > currentTrackedTp;

        if (pipsChange > 0.5 && isTighter && now - (lastTpUpdateMsRef.current[pos.id] ?? 0) >= TP_RATE_LIMIT_MS) {
          trailingTpRef.current[pos.id] = newTp;
          lastTpUpdateMsRef.current[pos.id] = now;
          lastSentTpRef.current[pos.id] = newTp;
          setTrackedTps((prev) =>
            prev[pos.id] === newTp ? prev : { ...prev, [pos.id]: newTp },
          );
          queryClient.setQueryData<Position[]>(posKey, (old) =>
            (old ?? []).map((p) =>
              p.id === pos.id ? { ...p, takeProfit: newTp } : p,
            ),
          );

          api.modifyPosition(pos.id, { takeProfit: newTp }).catch(() => {
            delete lastTpUpdateMsRef.current[pos.id];
            delete lastSentTpRef.current[pos.id];
          });
          addLog("INFO", `${pos.symbolName}: Trailing TP ↓ ${newTp.toFixed(5)} (gap ${currentGapAbs.toFixed(1)}p → converging)`);
        }
      }
    }
  }, [gapStats, isRunning, accountId, config, symbolPipSizes, queryClient, addLog]);

  // ── Upper trailing TP (live-price peak following) ─────────────────
  // When the live price peaks higher after entry (gap expanding), move TP up
  // to capture the extra profit. The delayed feed will eventually catch up to
  // the higher live price, hitting the elevated TP.
  //
  // TP = live.bid (BUY) | live.ask (SELL)
  //   Math: liveMid - halfSpread = bid  |  liveMid + halfSpread = ask
  //   This is the exact price the delayed feed must reach for TP to fire.
  //
  // Uses the shared trailingTpRef so both trail directions agree on the
  // "current bot-managed TP" and never fight each other:
  //   Upper trail (this): moves TP UP when gap expands  → more potential profit
  //   Lower trail (above): moves TP DOWN when gap closes → locks in existing profit
  //
  // Critical design: peak tracking (ref update) is DECOUPLED from the server API call.
  //
  //   BEFORE (bug): the rate-limit `continue` skipped the ref update too, so peaks
  //   that arrived between API call windows were silently dropped. trailingTpRef only
  //   advanced when a modifyPosition was actually sent.
  //
  //   NOW (fix): trailingTpRef advances on EVERY expansion tick. The rate limit only
  //   controls how often we push that peak to the server. The client-side TP detection
  //   reads from trailingTpRef, so it always closes at the true observed peak even if
  //   the server hasn't been updated yet.
  useEffect(() => {
    if (!isRunning || !accountId || !config || config.enableAdaptiveTp === false) return;

    const posKey = queryKeys.trading.positions(accountId);

    // Use RQ cache — it is updated by WS PositionOpened events (via bufferPositionOpened
    // → setQueryData). Zustand positions are only updated by loadPositions() REST calls
    // and miss positions opened in the current session until the next manual refresh.
    const openPositions = (queryClient.getQueryData<Position[]>(posKey) ?? [])
      .filter((p) => !p.id.startsWith("opt-") && p.takeProfit != null);
    if (openPositions.length === 0) return;

    const now2 = Date.now();

    for (const pos of openPositions) {
      const live = liveTicks[pos.symbolName];
      if (!live) continue;

      const side = pos.side === "LONG" ? "BUY" : "SELL";
      const pipSize = resolvePipSize(pos.symbolName, symbolPipSizes);
      const currentLive = side === "BUY" ? live.bid : live.ask;
      const trackedTp   = trailingTpRef.current[pos.id] ?? pos.takeProfit!;

      // ── Step 1: Peak tracking — every expansion tick, no rate limit ──
      const isNewPeak = side === "BUY" ? currentLive > trackedTp : currentLive < trackedTp;
      if (isNewPeak) {
        trailingTpRef.current[pos.id] = currentLive;
        // Update React state so HftFeedChart re-renders with correct TP line immediately.
        // This is more reliable than the RQ cache path which can be batched or delayed.
        setTrackedTps((prev) =>
          prev[pos.id] === currentLive ? prev : { ...prev, [pos.id]: currentLive },
        );
        // Also patch RQ cache for consistency (usePositions / PositionsTable)
        queryClient.setQueryData<Position[]>(posKey, (old) =>
          (old ?? []).map((p) => p.id === pos.id ? { ...p, takeProfit: currentLive } : p),
        );
      }

      // ── Step 2: Rate-limited server sync ──────────────────────────
      // Compare peak against lastSentTpRef — NOT pos.takeProfit (RQ), because we
      // just set pos.takeProfit to our optimistic value, making it equal to peakTp
      // and causing serverNeedsUpdate to always be false.
      const peakTp  = trailingTpRef.current[pos.id] ?? trackedTp;
      const lastSent = lastSentTpRef.current[pos.id] ?? pos.takeProfit!;
      const serverNeedsUpdate = side === "BUY" ? peakTp > lastSent : peakTp < lastSent;
      if (!serverNeedsUpdate) continue;

      const pipsChange = Math.abs(peakTp - lastSent) / pipSize;
      if (pipsChange < 0.1) continue;
      if (now2 - (lastTpUpdateMsRef.current[pos.id] ?? 0) < TP_RATE_LIMIT_MS) continue;

      lastTpUpdateMsRef.current[pos.id] = now2;
      lastSentTpRef.current[pos.id] = peakTp; // track what the server should now have
      api.modifyPosition(pos.id, { takeProfit: peakTp }).catch(() => {
        delete lastTpUpdateMsRef.current[pos.id];
        delete lastSentTpRef.current[pos.id]; // allow retry with same value
      });
      addLog(
        "INFO",
        `${pos.symbolName}: Peak TP ↑ ${peakTp.toFixed(5)} (+${pipsChange.toFixed(2)}p, live at new ${side === "BUY" ? "high" : "low"})`,
      );
    }
  }, [liveTicks, isRunning, accountId, config, symbolPipSizes, queryClient, addLog]);

  // ── trailingTpRef seeding ────────────────────────────────────
  // Seed refs for positions not yet tracked.
  //
  // Source strategy: UNION of Zustand and React Query cache.
  //   • Zustand positions: updated by loadPositions() REST calls. May miss positions
  //     that were opened in the current session (WS PositionOpened only updates RQ).
  //   • RQ cache: updated by WS PositionOpened → bufferPositionOpened → setQueryData.
  //     Has the most up-to-date position list after optimistic updates.
  //   RQ wins on conflicts (more recent data after our optimistic takeProfit patches).
  //
  // Also seeds lastSentTpRef with the initial server TP so serverNeedsUpdate
  // comparisons work correctly from the first expansion tick.
  useEffect(() => {
    if (!accountId) return;
    const posKey = queryKeys.trading.positions(accountId);
    const rqPositions = (queryClient.getQueryData<Position[]>(posKey) ?? [])
      .filter((p) => !p.id.startsWith("opt-"));
    const zustandPositions = positions.filter((p) => p.accountId === accountId);

    // Union: Zustand first, RQ overwrites (RQ has fresher takeProfit after optimistic updates)
    const posMap = new Map<string, Position>();
    for (const p of zustandPositions) posMap.set(p.id, p);
    for (const p of rqPositions) posMap.set(p.id, p);
    const openIds = new Set(posMap.keys());

    for (const pos of posMap.values()) {
      if (pos.takeProfit != null && trailingTpRef.current[pos.id] === undefined) {
        trailingTpRef.current[pos.id] = pos.takeProfit;
        lastSentTpRef.current[pos.id] = pos.takeProfit; // server's current TP at seed time
      }
    }
    // Remove stale refs for positions that have closed
    for (const id of Object.keys(trailingTpRef.current)) {
      if (!openIds.has(id)) {
        delete trailingTpRef.current[id];
        delete lastSentTpRef.current[id];
        delete lastTpUpdateMsRef.current[id];
        delete clientTpFiredRef.current[id];
      }
    }
  }, [positions, accountId, queryClient]);

  // ── Client-side TP hit detection ─────────────────────────────
  //
  // Belt-and-suspenders: close ourselves when the delayed price crosses the
  // bot-tracked TP, regardless of whether the server's TP order is current.
  //
  // Design decisions:
  //   • Reads from Zustand positions (WS-synced), never the stale RQ cache.
  //   • clientTpFiredRef stores the attempt TIMESTAMP not a boolean.
  //     If the position is still open 5 s after we attempted, the server may
  //     have silently failed → auto-clear and retry.
  //   • Runs on every tick update AND on a 500 ms interval for redundancy
  //     (catches cases where price crosses TP between two tick batches).
  //   • Also fires when positions change — a new position or server-pushed TP
  //     update should be checked immediately.
  const runTpCheck = useCallback(() => {
    if (!isRunning || !accountId) return;
    // Union of Zustand + RQ — RQ has positions opened in this session via WS events
    const posKey = queryKeys.trading.positions(accountId);
    const rqPositions = (queryClient.getQueryData<Position[]>(posKey) ?? [])
      .filter((p) => !p.id.startsWith("opt-"));
    const posMap = new Map<string, Position>();
    for (const p of positions.filter((p) => p.accountId === accountId)) posMap.set(p.id, p);
    for (const p of rqPositions) posMap.set(p.id, p); // RQ wins (has optimistic takeProfit)
    const myPositions = [...posMap.values()];
    if (myPositions.length === 0) return;

    // Build a Zustand lookup for server-confirmed (non-optimistic) TP values.
    // Zustand is only updated by loadPositions() REST calls — it never receives our
    // optimistic setQueryData patches — so its takeProfit is the real server value.
    const zustandById = new Map(
      positions.filter((p) => p.accountId === accountId).map((p) => [p.id, p]),
    );

    const now = Date.now();
    const RETRY_AFTER_MS = 5_000;

    for (const pos of myPositions) {
      const firedAt = clientTpFiredRef.current[pos.id];
      if (firedAt !== undefined) {
        if (now - firedAt < RETRY_AFTER_MS) continue;
        delete clientTpFiredRef.current[pos.id];
      }

      const tick = delayedTicks[pos.symbolName];
      if (!tick) continue;

      // Collect ALL known TP levels from every source:
      //  • trailingTpRef  — bot-tracked live-price peak (may be very aggressive)
      //  • lastSentTpRef  — last value actually sent to the server via modifyPosition
      //  • pos.takeProfit — RQ value (optimistically updated = often same as trailing)
      //  • zustandTp      — server-confirmed value, unaffected by our optimistic patches
      //
      // Use the MOST CONSERVATIVE level as the trigger threshold:
      //   BUY  → Math.min (lowest TP = closest to current delayed price = fires first)
      //   SELL → Math.max (highest TP = closest to current delayed price = fires first)
      //
      // This ensures the ORIGINAL TP always triggers even when the trailing has moved
      // to a more aggressive level that the delayed feed may never reach.
      const isBuy = pos.side === "LONG";
      const zustandTp = zustandById.get(pos.id)?.takeProfit;
      const candidates: number[] = [
        trailingTpRef.current[pos.id],
        lastSentTpRef.current[pos.id],
        pos.takeProfit ?? undefined,
        zustandTp ?? undefined,
      ].filter((v): v is number => v != null);

      if (candidates.length === 0) continue;

      const triggerTp = isBuy ? Math.min(...candidates) : Math.max(...candidates);
      const mid = (tick.bid + tick.ask) / 2;
      const tpHit = isBuy
        ? tick.bid >= triggerTp || mid >= triggerTp
        : tick.ask <= triggerTp || mid <= triggerTp;
      if (!tpHit) continue;

      clientTpFiredRef.current[pos.id] = now;
      addLog(
        "ORDER",
        `${pos.symbolName}: ✓ TP triggered @ ${triggerTp.toFixed(5)} ` +
        `(bid ${tick.bid.toFixed(5)} / ask ${tick.ask.toFixed(5)})`,
      );

      // Record outcome before closing
      const entry = tradeEntryDataRef.current[pos.id];
      if (entry) {
        const bucket = tradeOutcomesRef.current[entry.symbol] ?? [];
        bucket.push({
          positionId: pos.id, symbol: entry.symbol, direction: entry.direction,
          gapAtEntry: entry.gapAtEntry, thresholdAtEntry: entry.thresholdAtEntry,
          entryTs: entry.entryTs, holdTimeMs: now - entry.entryTs, exitReason: "TP",
        });
        if (bucket.length > MAX_TRADE_OUTCOMES) bucket.shift();
        tradeOutcomesRef.current[entry.symbol] = bucket;
        delete tradeEntryDataRef.current[pos.id];
      }

      api.closePosition(pos.id).catch((err) => {
        addLog("ERROR", `${pos.symbolName}: TP close failed — ${err instanceof Error ? err.message : String(err)}`);
        delete clientTpFiredRef.current[pos.id]; // allow immediate retry on hard failure
      });
    }
  }, [isRunning, accountId, positions, delayedTicks, queryClient, addLog]);

  // Tick-driven: fires on every delayed tick update (the same stream the broker uses)
  useEffect(() => { runTpCheck(); }, [delayedTicks, runTpCheck]);

  // Position-driven: fires when positions change (new position, server TP update, etc.)
  useEffect(() => { runTpCheck(); }, [positions, runTpCheck]);

  // Periodic fallback: catches any gap between tick batches
  useEffect(() => {
    if (!isRunning || !accountId) return;
    const id = setInterval(runTpCheck, 500);
    return () => clearInterval(id);
  }, [isRunning, accountId, runTpCheck]);

  // ── Trade outcome tracking (position close detection) ────────
  // Detects when the position count drops (position closed by server TP/SL/manual)
  // and records the outcome for the symbol performance computation.
  useEffect(() => {
    const myPositions = positions.filter((p) => p.accountId === accountId);
    const currentIds = new Set(myPositions.map((p) => p.id));

    for (const id of prevPositionIdsRef.current) {
      if (currentIds.has(id)) continue;
      // Position closed — record outcome if we have entry data and it wasn't a TP close
      if (clientTpFiredRef.current[id] !== undefined) continue; // TP already recorded
      const entry = tradeEntryDataRef.current[id];
      if (!entry) continue;
      const outcome: TradeOutcome = {
        positionId: id,
        symbol: entry.symbol,
        direction: entry.direction,
        gapAtEntry: entry.gapAtEntry,
        thresholdAtEntry: entry.thresholdAtEntry,
        entryTs: entry.entryTs,
        holdTimeMs: Date.now() - entry.entryTs,
        exitReason: "SL_OR_SERVER",
      };
      const bucket = tradeOutcomesRef.current[entry.symbol] ?? [];
      bucket.push(outcome);
      if (bucket.length > MAX_TRADE_OUTCOMES) bucket.shift();
      tradeOutcomesRef.current[entry.symbol] = bucket;
      delete tradeEntryDataRef.current[id];
    }

    prevPositionIdsRef.current = currentIds;
  }, [positions, accountId]);

  // ── Symbol performance (self-improvement calibration) ────────
  // Derived from trade outcomes. Surfaced in the UI and used to generate
  // threshold calibration hints once ≥10 trades have been recorded per symbol.
  const symbolPerformance = useMemo<SymbolPerformance[]>(() => {
    return Object.entries(tradeOutcomesRef.current).map(([symbol, outcomes]) => {
      if (outcomes.length === 0) return null;
      const tpCount  = outcomes.filter((o) => o.exitReason === "TP").length;
      const tpRate   = tpCount / outcomes.length;
      const avgHoldMs = outcomes.reduce((s, o) => s + o.holdTimeMs, 0) / outcomes.length;

      // Calibration hint: high TP rate → can afford a tighter threshold (more selective);
      // low TP rate → threshold too low, raise it to filter weak signals.
      let suggestedThresholdAdj: number | null = null;
      if (outcomes.length >= 10) {
        if (tpRate > 0.75) {
          // 75%+ TP rate: lower threshold slightly to capture more opportunities
          suggestedThresholdAdj = -0.5;
        } else if (tpRate < 0.45) {
          // Sub-45% TP rate: raise threshold to reduce false signals
          suggestedThresholdAdj = +1.0;
        } else {
          suggestedThresholdAdj = 0;
        }
      }
      return { symbol, tradeCount: outcomes.length, tpRate, avgHoldMs, suggestedThresholdAdj };
    }).filter((x): x is SymbolPerformance => x !== null);
  // Outcomes are stored in a ref, so we derive performance on every positions change
  // to keep the data fresh without making tradeOutcomesRef a piece of state.
  }, [positions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up trackedTps entries for positions that have closed
  useEffect(() => {
    const posKey = queryKeys.trading.positions(accountId ?? "");
    const openIds = new Set(
      (queryClient.getQueryData<Position[]>(posKey) ?? [])
        .filter((p) => !p.id.startsWith("opt-"))
        .map((p) => p.id),
    );
    setTrackedTps((prev) => {
      const next: Record<string, number> = {};
      for (const [id, tp] of Object.entries(prev)) {
        if (openIds.has(id)) next[id] = tp;
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [positions, accountId, queryClient]);

  return { signals, gapStats, liveTicks, botStats, log, addLog, symbolPerformance, trackedTps };
}

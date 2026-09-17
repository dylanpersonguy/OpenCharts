import { getAdapter } from "../adapter/registry.ts";
import { uid } from "../lib/uid.ts";
import { publish } from "./demo/bus.ts";

/**
 * Session replay.
 *
 * The replay UI drives its own clock (useReplayPlayback runs a rAF loop over
 * the tick buffer); this module supplies the buffer and owns the transport
 * state, broadcasting `ReplayStateChanged` so the store and HUD stay in sync.
 *
 * The buffer comes from the installed adapter's `getCandles`, so replay works
 * against any backend rather than needing one of its own. A "session" is the
 * 1-minute history for the charted symbol on the requested date.
 */

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

type SessionState = {
  id: string;
  status: "IDLE" | "PLAYING" | "PAUSED" | "STOPPED";
  speed: number;
  cursorTimestamp: number | null;
  sessionDate: string;
};

let session: SessionState | null = null;

/** Symbol to play back when the caller does not name one. */
const DEFAULT_SYMBOL = "BTCUSD";

/** Enough 1m bars to cover a trading day with room to spare. */
const SESSION_BAR_LIMIT = 2000;

/**
 * Bars revealed before playback begins. Starting exactly at the first bar
 * leaves the chart auto-fitting a single candle across the whole pane, which
 * looks broken for the first few seconds.
 */
const WARMUP_BARS = 30;

function emit(action: string, opts: { speed?: number; cursorTimestamp?: number } = {}): void {
  publish("market-data", { eventType: "ReplayStateChanged", action, ...opts });
}

function dayBounds(sessionDate: string): { startMs: number; endMs: number } {
  const startMs = new Date(`${sessionDate}T00:00:00`).getTime();
  return { startMs, endMs: startMs + 24 * 60 * 60 * 1000 };
}

export async function getSession(
  sessionDate: string,
  symbol: string = DEFAULT_SYMBOL,
  accountId?: string,
): Promise<ReplaySessionPayload> {
  const adapter = getAdapter();
  const { startMs, endMs } = dayBounds(sessionDate);

  const bars = await adapter.marketData.getCandles({
    symbol,
    timeframe: "1m",
    limit: SESSION_BAR_LIMIT,
    fromMs: startMs,
    toMs: endMs,
  });

  const tickBuffer = bars
    .filter((c) => {
      const ms = c.time * 1000;
      return ms >= startMs && ms < endMs;
    })
    .map((c) => ({
      t: c.time * 1000,
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume ?? 0,
    }));

  // Trades closed inside the replayed window become markers on the chart.
  let tradeEvents: ReplaySessionPayload["tradeEvents"] = [];
  if (adapter.trading && accountId) {
    try {
      const closed = await adapter.trading.getClosedPositions(accountId);
      tradeEvents = closed.data
        .filter((p) => {
          if (!p.closedAt) return false;
          const closedMs = Date.parse(p.closedAt);
          return Number.isFinite(closedMs) && closedMs >= startMs && closedMs < endMs;
        })
        .map((p) => ({
          id: p.id,
          type: "exit" as const,
          timestamp: p.closedAt as string,
          symbolName: p.symbolName,
          side: p.side,
          price: p.exitPrice,
          pnl: p.realizedPnl,
        }));
    } catch {
      // Markers are a nicety — a gateway that cannot list closed trades still
      // gets a working replay.
    }
  }

  return {
    replaySession: {
      id: session?.id ?? uid(),
      status: session?.status ?? "IDLE",
      speed: session?.speed ?? 1,
      cursorTimestamp:
        session?.cursorTimestamp != null ? new Date(session.cursorTimestamp).toISOString() : null,
      sessionDate,
    },
    tickBuffer,
    tradeEvents,
    meta: {
      primarySymbol: tickBuffer.length > 0 ? symbol : null,
      sessionDate,
      tickCount: tickBuffer.length,
    },
  };
}

export async function start(
  sessionDate: string,
  speed = 1,
  symbol: string = DEFAULT_SYMBOL,
  accountId?: string,
): Promise<{ speed: number; seed: null }> {
  const payload = await getSession(sessionDate, symbol, accountId);
  const buffer = payload.tickBuffer;
  const first =
    buffer.length > 0 ? (buffer[Math.min(WARMUP_BARS, buffer.length - 1)]?.t ?? null) : null;

  session = { id: uid(), status: "PLAYING", speed, cursorTimestamp: first, sessionDate };
  emit("started", { speed, ...(first != null ? { cursorTimestamp: first } : {}) });
  return { speed, seed: null };
}

export function pause(): void {
  if (!session) return;
  session.status = "PAUSED";
  emit("paused");
}

export function resume(): void {
  if (!session) return;
  session.status = "PLAYING";
  emit("resumed");
}

export function stop(): void {
  if (session) session.status = "STOPPED";
  session = null;
  emit("stopped");
}

export function setSpeed(speed: number): { speed: number } {
  if (session) session.speed = speed;
  emit("speed", { speed });
  return { speed };
}

export function seek(timestamp: string | number): { cursorTimestamp: string } {
  const ms = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
  if (session && Number.isFinite(ms)) session.cursorTimestamp = ms;
  emit("seek", { cursorTimestamp: ms });
  return { cursorTimestamp: new Date(ms).toISOString() };
}

/** Cursor persistence — in-memory only; a reload starts the session fresh. */
export function patchSession(patch: { sessionDate?: string; cursorTimestamp?: number }): void {
  if (!session) return;
  if (patch.cursorTimestamp != null) session.cursorTimestamp = patch.cursorTimestamp;
  if (patch.sessionDate) session.sessionDate = patch.sessionDate;
}

/** Test seam. */
export function __resetReplay(): void {
  session = null;
}

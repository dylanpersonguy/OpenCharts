import { uid } from "../../lib/uid.ts";
import { publish } from "./bus.ts";
import { loadSeries } from "./candles.ts";
import { getClosedPositions } from "./engine.ts";
import type { ReplaySessionPayload } from "./api.ts";

/**
 * Demo session replay.
 *
 * The replay UI drives its own clock (useReplayPlayback runs a rAF loop over
 * the tick buffer); this module supplies the buffer and owns the transport
 * state, broadcasting `ReplayStateChanged` on the same channel the real
 * backend used so MarketDataBridge and the store need no special casing.
 *
 * A "session" is the bundled 1-minute history for the charted symbol on the
 * requested date. The bundled series is time-shifted so its last bar is the
 * current period, which means today's date has data and earlier dates may not
 * — the UI already explains an empty session.
 */

type SessionState = {
  id: string;
  status: "IDLE" | "PLAYING" | "PAUSED" | "STOPPED";
  speed: number;
  cursorTimestamp: number | null;
  sessionDate: string;
};

let session: SessionState | null = null;

const TF_SECONDS = 60;

function emit(action: string, opts: { speed?: number; cursorTimestamp?: number } = {}): void {
  publish("market-data", {
    eventType: "ReplayStateChanged",
    action,
    ...opts,
  });
}

function dayBounds(sessionDate: string): { startMs: number; endMs: number } {
  const start = new Date(`${sessionDate}T00:00:00`);
  const startMs = start.getTime();
  return { startMs, endMs: startMs + 24 * 60 * 60 * 1000 };
}

/**
 * Symbol to play back. Passed in by the caller rather than read from the
 * trading store: the store imports the api facade, which imports this module,
 * and closing that cycle left `demoApi` undefined at module-init time.
 */
const DEFAULT_SYMBOL = "BTCUSD";

/** Shift the bundled series so its final bar lands on the current minute. */
function shiftedBars(raw: { time: number; open: number; high: number; low: number; close: number; volume?: number }[]) {
  if (raw.length === 0) return [];
  const nowSec = Math.floor(Date.now() / 1000);
  const currentBucket = nowSec - (nowSec % TF_SECONDS);
  const delta = currentBucket - raw[raw.length - 1]!.time;
  return raw.map((c) => ({ ...c, time: c.time + delta }));
}

export async function getSession(
  sessionDate: string,
  symbol: string = DEFAULT_SYMBOL,
): Promise<ReplaySessionPayload> {
  const raw = await loadSeries(symbol, "1m");
  const bars = shiftedBars(raw);
  const { startMs, endMs } = dayBounds(sessionDate);

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
  const tradeEvents: ReplaySessionPayload["tradeEvents"] = getClosedPositions()
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

/**
 * Bars revealed before playback begins. Starting exactly at the first bar
 * leaves the chart auto-fitting a single candle across the whole pane, which
 * looks broken for the first few seconds.
 */
const WARMUP_BARS = 30;

export async function start(
  sessionDate: string,
  speed = 1,
  symbol: string = DEFAULT_SYMBOL,
): Promise<{ speed: number; seed: null }> {
  const payload = await getSession(sessionDate, symbol);
  const buffer = payload.tickBuffer;
  const first =
    buffer.length > 0 ? (buffer[Math.min(WARMUP_BARS, buffer.length - 1)]?.t ?? null) : null;
  session = {
    id: uid(),
    status: "PLAYING",
    speed,
    cursorTimestamp: first,
    sessionDate,
  };
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

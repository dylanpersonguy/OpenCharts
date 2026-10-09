import { bucketStart, tfSeconds, type ReplayTimeframe } from "./data/aggregate.ts";
import type { BarSource } from "./data/bar-source.ts";
import { accountSnapshot } from "./engine/equity.ts";
import type { EngineConfig, EngineState } from "./engine/types.ts";
import type { ReplaySession, SessionSummary, StepUnit } from "./session-types.ts";

export const DAY = 86_400;
/** How far ahead of the cursor history is kept loaded (covers weekend/holiday gaps). */
export const LOOKAHEAD = 21 * DAY;

/**
 * Inclusive end time of the next step. A chart step reveals up to the end of
 * the chart-timeframe bucket that holds the next base bar — which first
 * completes a partially revealed bar after a timeframe switch. A base step
 * reveals exactly one 15m bar.
 */
export function stepTarget(nextBarTime: number, tf: ReplayTimeframe, unit: StepUnit): number {
  if (unit === "base") return nextBarTime;
  return bucketStart(nextBarTime, tf) + tfSeconds(tf) - 1;
}

/** Number of distinct positions with at least one closed slice. */
export function closedTradeCount(state: EngineState): number {
  return new Set(state.closedTrades.map((t) => t.positionId)).size;
}

export function sessionSummary(state: EngineState, cfg: EngineConfig): SessionSummary {
  const snap = accountSnapshot(state, cfg);
  return {
    balance: snap.balance,
    equity: snap.equity,
    netPnl: snap.equity - cfg.startingBalance,
    tradeCount: closedTradeCount(state),
  };
}

/** Session record updated with the engine's latest cursor and summary. */
export function withProgress(
  session: ReplaySession,
  state: EngineState,
  cfg: EngineConfig,
  view: { timeframe: ReplayTimeframe; stepUnit: StepUnit },
  now: Date,
): ReplaySession {
  return {
    ...session,
    cursorTime: state.cursorTime ?? session.cursorTime,
    timeframe: view.timeframe,
    stepUnit: view.stepUnit,
    updatedAt: now.toISOString(),
    summary: sessionSummary(state, cfg),
  };
}

/** Load around `t` and return the bar at or before it (or the first one after, at the start of history). */
export async function barNear(source: BarSource, t: number) {
  const clamped = Math.min(Math.max(t, source.dataStart), source.dataEnd);
  await source.ensureRange(clamped - 40 * DAY, clamped + LOOKAHEAD);
  return source.lastBarAtOrBefore(clamped) ?? source.firstBarAtOrAfter(clamped);
}

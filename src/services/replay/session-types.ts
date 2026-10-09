import type { JournalEntry } from "../api/journal.ts";
import type { ReplayTimeframe } from "./data/aggregate.ts";
import type { EngineState, ReplaySymbol } from "./engine/types.ts";

/** How far one "step" advances: one bar of the chart timeframe, or one 15m base bar. */
export type StepUnit = "chart" | "base";

export type SessionStatus = "active" | "ended";

/** Denormalized numbers shown on the sessions list without loading engine state. */
export interface SessionSummary {
  readonly balance: number;
  readonly equity: number;
  readonly netPnl: number;
  readonly tradeCount: number;
}

/** A named backtesting session: one symbol, its own paper account and replay cursor. */
export interface ReplaySession {
  readonly id: string;
  /** uuid used as the paper accountId so the terminal's account-keyed caches stay separate. */
  readonly accountId: string;
  readonly name: string;
  readonly symbol: ReplaySymbol;
  readonly startingBalance: number;
  /** Unix seconds the session started from. */
  readonly startTime: number;
  /** Unix seconds of the last revealed 15m bar (open time). */
  readonly cursorTime: number;
  readonly timeframe: ReplayTimeframe;
  readonly spread: number;
  readonly commissionPerLotPerSide: number;
  readonly leverage: number;
  readonly stepUnit: StepUnit;
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly summary: SessionSummary;
}

export interface CreateSessionInput {
  readonly name: string;
  readonly symbol: ReplaySymbol;
  readonly startingBalance: number;
  readonly startTime: number;
  readonly timeframe: ReplayTimeframe;
  readonly spread: number;
  readonly commissionPerLotPerSide: number;
  readonly leverage: number;
}

/** Journal entry for a replay trade, keyed to its session and position. */
export type ReplayJournalEntry = JournalEntry & {
  readonly sessionId: string;
  readonly positionId: string;
};

/** User-editable label lists offered in the journal form. */
export interface TagLibrary {
  readonly setups: readonly string[];
  readonly mistakes: readonly string[];
}

export const DEFAULT_TAG_LIBRARY: TagLibrary = {
  setups: ["Breakout", "Pullback", "Reversal", "Range", "Trend continuation"],
  mistakes: ["FOMO entry", "Moved SL", "Early exit", "Oversized", "No plan", "Revenge trade"],
};

export type { EngineState };

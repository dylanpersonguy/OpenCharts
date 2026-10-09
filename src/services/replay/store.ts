import { create } from "zustand";
import type { ReplayTimeframe } from "./data/aggregate.ts";
import type { Bar } from "./data/types.ts";
import type { AccountSnapshot, ClosedTrade, ReplayOrder, ReplayPosition } from "./engine/types.ts";
import type { ReplaySession, StepUnit } from "./session-types.ts";

export type ReplayStatus = "idle" | "loading" | "ready" | "playing" | "ended" | "error";

export interface ReplayTick {
  readonly bid: number;
  readonly ask: number;
  /** Epoch ms of the revealed bar (replay time, not wall clock). */
  readonly timestamp: number;
}

/** View state for the open replay session, written only by the replay controller. */
export interface ReplayViewState {
  readonly session: ReplaySession | null;
  readonly status: ReplayStatus;
  readonly error: string | null;
  /** Open time (unix seconds) of the last revealed 15m bar. */
  readonly cursorTime: number | null;
  readonly timeframe: ReplayTimeframe;
  readonly stepUnit: StepUnit;
  /** Steps per second while playing. */
  readonly speed: number;
  /** Chart candles up to the cursor (last bar may be partial). */
  readonly bars: readonly Bar[];
  /** Bumped when the window is rebuilt (jump / timeframe change) so the chart re-fits. */
  readonly viewKey: number;
  readonly tick: ReplayTick | null;
  readonly account: AccountSnapshot | null;
  readonly positions: readonly ReplayPosition[];
  readonly orders: readonly ReplayOrder[];
  readonly closedTrades: readonly ClosedTrade[];
  /** "Select bar" mode: the next chart click picks a new replay start. */
  readonly selectingBar: boolean;
  /** A step / jump is loading data or processing. */
  readonly busy: boolean;
}

export const INITIAL_REPLAY_STATE: ReplayViewState = {
  session: null,
  status: "idle",
  error: null,
  cursorTime: null,
  timeframe: "15m",
  stepUnit: "chart",
  speed: 2,
  bars: [],
  viewKey: 0,
  tick: null,
  account: null,
  positions: [],
  orders: [],
  closedTrades: [],
  selectingBar: false,
  busy: false,
};

export const useReplayStore = create<ReplayViewState>(() => INITIAL_REPLAY_STATE);

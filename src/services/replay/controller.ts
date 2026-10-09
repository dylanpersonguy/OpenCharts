import { registerReplayBackend } from "../demo/replay-router.ts";
import { createBarSource, type BarSource } from "./data/bar-source.ts";
import { createChunkCache } from "./data/chunk-cache.ts";
import type { HistoryManifest } from "./data/codec.ts";
import type { ReplayTimeframe } from "./data/aggregate.ts";
import { buildWindow, extendWindow, windowAnchor, type CandleWindow } from "./data/visible-candles.ts";
import { createReplayEngine, initialEngineState, type ReplayEngine } from "./engine/create-engine.ts";
import { accountSnapshot } from "./engine/equity.ts";
import type { EngineConfig, EngineEvent, EngineState } from "./engine/types.ts";
import { createReplayBackend } from "./backend.ts";
import { bindEngineToBus } from "./bus-adapter.ts";
import { engineConfigFor } from "./instruments.ts";
import type { ReplayRepository } from "./persistence/repository.ts";
import { createPlaybackClock, type PlaybackClock } from "./playback-clock.ts";
import type { ReplaySession, StepUnit } from "./session-types.ts";
import { barNear, LOOKAHEAD, stepTarget, withProgress } from "./stepping.ts";
import { INITIAL_REPLAY_STATE, useReplayStore } from "./store.ts";

/**
 * Runs one open replay session: owns the bar source, the engine, the chart
 * window and the playback clock, and mirrors everything the UI needs into
 * `useReplayStore`. Trading goes through the demo api (replay router), so the
 * existing order panel, tables and chart overlays work unchanged.
 */

export interface ReplayControllerDeps {
  readonly repository: ReplayRepository;
  readonly manifest: HistoryManifest;
  /** Refetch the account's position/order/history caches (after bulk jumps). */
  readonly invalidateAccount: (accountId: string) => void;
}

export interface ReplayController {
  step(): Promise<boolean>;
  play(): void;
  pause(): void;
  setSpeed(stepsPerSecond: number): void;
  setStepUnit(unit: StepUnit): void;
  setTimeframe(tf: ReplayTimeframe): Promise<void>;
  /** Forward jumps trade through every bar; backward jumps need a flat account. Resolves to an error message or null. */
  jumpTo(timeSec: number): Promise<string | null>;
  setSelectingBar(on: boolean): void;
  endSession(): Promise<void>;
  dispose(): Promise<void>;
}

const chunkCache = createChunkCache();
const CURSOR_SAVE_DEBOUNCE_MS = 1000;
const TRADE_EVENTS = new Set<EngineEvent["type"]>([
  "order-placed", "order-filled", "order-canceled", "order-modified",
  "position-opened", "position-closed", "position-partially-closed",
]);

const view = () => useReplayStore.getState();

/** Only the most recently opened controller may write to the store (StrictMode opens twice). */
let activeToken: symbol | null = null;

function tickFor(state: EngineState, cfg: EngineConfig) {
  if (state.lastClose == null || state.cursorTime == null) return null;
  return { bid: state.lastClose, ask: state.lastClose + cfg.spread, timestamp: state.cursorTime * 1000 };
}

function mirror(set: (patch: Partial<typeof INITIAL_REPLAY_STATE>) => void, state: EngineState, cfg: EngineConfig) {
  set({
    cursorTime: state.cursorTime,
    tick: tickFor(state, cfg),
    account: accountSnapshot(state, cfg),
    positions: state.positions,
    orders: state.orders,
    closedTrades: state.closedTrades,
  });
}

export async function openReplaySession(sessionId: string, deps: ReplayControllerDeps): Promise<ReplayController> {
  const token = Symbol(sessionId);
  activeToken = token;
  const set = (patch: Partial<typeof INITIAL_REPLAY_STATE>) => {
    if (activeToken === token) useReplayStore.setState(patch);
  };
  useReplayStore.setState({ ...INITIAL_REPLAY_STATE, status: "loading" });
  let session = await deps.repository.getSession(sessionId);
  if (!session) throw new Error("Session not found");
  if (!deps.manifest.symbols[session.symbol]) throw new Error(`No history downloaded for ${session.symbol}`);
  const cfg = engineConfigFor(session.symbol, {
    accountId: session.accountId,
    spread: session.spread,
    commissionPerLotPerSide: session.commissionPerLotPerSide,
    leverage: session.leverage,
    startingBalance: session.startingBalance,
  });
  const source: BarSource = createBarSource(session.symbol, deps.manifest, chunkCache);
  const saved = await deps.repository.loadEngineState(sessionId);
  const startBar = await barNear(source, saved?.cursorTime ?? session.cursorTime);
  if (!startBar) throw new Error("No history found around the session start");
  const initial: EngineState = saved ?? { ...initialEngineState(cfg), cursorTime: startBar.time, lastClose: startBar.close };

  let engine: ReplayEngine;
  let detachEngine = () => {};
  let candleWindow: CandleWindow = { anchor: 0, bars: [] };
  // View settings are tracked locally so persistence never depends on the (shared) store.
  let timeframe: ReplayTimeframe = session.timeframe;
  let stepUnit: StepUnit = session.stepUnit;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveChain: Promise<unknown> = Promise.resolve();
  let opChain: Promise<unknown> = Promise.resolve();
  let opRunning = false;
  /** Set at the start of dispose: no new operations or debounced saves start after it. */
  let closing = false;
  let disposed = false;

  /** Queue a save; saves run strictly in order so an older snapshot never lands after a newer one. */
  const persist = (opts: { final?: boolean } = {}): Promise<void> => {
    if (disposed && !opts.final) return Promise.resolve();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    const state = engine.getState();
    session = withProgress(session as ReplaySession, state, cfg, { timeframe, stepUnit }, new Date());
    set({ session });
    const snapshot = session;
    const run = () => Promise.all([deps.repository.saveEngineState(sessionId, state), deps.repository.putSession(snapshot)]);
    const next = saveChain.then(run, run);
    saveChain = next.catch(() => undefined);
    return next.then(
      () => undefined,
      (e: unknown) => set({ error: `Could not save session: ${e instanceof Error ? e.message : String(e)}` }),
    );
  };
  const persistSoon = () => {
    if (closing) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void persist(), CURSOR_SAVE_DEBOUNCE_MS);
  };

  /**
   * Run controller operations one at a time. Steps, jumps and timeframe
   * changes all await data loads; serializing them means no operation ever
   * sees an engine or window that another one swapped out mid-flight.
   */
  const serial = <T>(fallback: T, op: () => Promise<T>): Promise<T> => {
    const run = async (): Promise<T> => {
      if (closing) return fallback;
      opRunning = true;
      set({ busy: true });
      try {
        return await op();
      } catch (e: unknown) {
        clock.pause();
        set({ status: "ready", error: e instanceof Error ? e.message : String(e) });
        return fallback;
      } finally {
        opRunning = false;
        set({ busy: false });
      }
    };
    const next = opChain.then(run, run);
    opChain = next;
    return next;
  };

  const attachEngine = (state: EngineState) => {
    detachEngine();
    engine = createReplayEngine(cfg, state);
    // A superseded controller (StrictMode's first mount) must not route trades or publish events.
    const live = activeToken === token;
    const unregister = live ? registerReplayBackend(createReplayBackend(engine, cfg, session as ReplaySession)) : () => {};
    const unbindBus = live ? bindEngineToBus(engine, cfg.accountId, () => deps.invalidateAccount(cfg.accountId)) : () => {};
    const unwatch = engine.subscribe((events, next) => {
      mirror(set, next, cfg);
      if (events.some((e) => TRADE_EVENTS.has(e.type))) void persist();
    });
    detachEngine = () => {
      unwatch();
      unbindBus();
      unregister();
    };
    mirror(set, state, cfg);
  };

  const rebuildWindow = async (tf: ReplayTimeframe) => {
    const cursor = engine.getState().cursorTime as number;
    const anchor = windowAnchor(cursor, tf, cfg.symbol);
    await source.ensureRange(anchor - 1, cursor + LOOKAHEAD);
    candleWindow = buildWindow(source, tf, cursor);
    timeframe = tf;
    set({ bars: candleWindow.bars, timeframe: tf, viewKey: view().viewKey + 1 });
  };

  const stepOnce = async (): Promise<boolean> => {
    const cursor = engine.getState().cursorTime as number;
    await source.ensureRange(cursor, cursor + LOOKAHEAD);
    const next = source.nextBarTime(cursor);
    if (next === null || cursor >= source.dataEnd) {
      clock.pause();
      set({ status: "ended" });
      return false;
    }
    const target = Math.min(stepTarget(next, timeframe, stepUnit), source.dataEnd);
    await source.ensureRange(cursor, target);
    const bars = source.barsBetween(cursor, target);
    engine.advance(bars);
    candleWindow = extendWindow(candleWindow, bars, timeframe);
    set({ bars: candleWindow.bars, error: null });
    persistSoon();
    return true;
  };

  const step = () => serial(false, stepOnce);

  const clock: PlaybackClock = createPlaybackClock({
    stepsPerSecond: view().speed,
    onStep: () => {
      // Skip a tick rather than queue up steps while data is loading.
      if (!opRunning) void step();
      return !disposed && view().status === "playing";
    },
  });

  const pause = () => {
    clock.pause();
    if (view().status === "playing") set({ status: "ready" });
    void persist();
  };

  const jumpOnce = async (timeSec: number): Promise<string | null> => {
    const state = engine.getState();
    const cursor = state.cursorTime as number;
    const target = Math.min(Math.max(timeSec, source.dataStart), source.dataEnd);
    if (target < cursor) {
      if (state.positions.length > 0 || state.orders.length > 0) {
        return "Close open positions and cancel pending orders before jumping back in time.";
      }
      const bar = await barNear(source, target);
      if (!bar) return "No history at that date.";
      attachEngine({ ...state, cursorTime: bar.time, lastClose: bar.close });
    } else if (target > cursor) {
      await source.ensureRange(cursor, target + LOOKAHEAD);
      engine.advance(source.barsBetween(cursor, target));
    }
    await rebuildWindow(timeframe);
    if (view().status === "ended" && session?.status !== "ended") set({ status: "ready" });
    set({ error: null });
    await persist();
    return null;
  };

  attachEngine(initial);
  set({ session, timeframe, stepUnit });
  await rebuildWindow(timeframe);
  set({ status: session.status === "ended" ? "ended" : "ready" });
  void persist();

  const flushOnHide = () => void persist();
  globalThis.addEventListener?.("pagehide", flushOnHide);

  return {
    step,
    play: () => {
      if (closing || view().status === "ended") return;
      set({ status: "playing", selectingBar: false });
      clock.play();
    },
    pause,
    setSpeed: (speed) => {
      clock.setSpeed(speed);
      set({ speed });
    },
    setStepUnit: (unit) => {
      stepUnit = unit;
      set({ stepUnit: unit });
      persistSoon();
    },
    setTimeframe: (tf) =>
      serial(undefined, async () => {
        await rebuildWindow(tf);
        persistSoon();
      }),
    jumpTo: (timeSec) => {
      pause();
      return serial<string | null>("Jump failed — see the error above.", () => jumpOnce(timeSec));
    },
    setSelectingBar: (on) => set({ selectingBar: on }),
    endSession: () => {
      pause();
      return serial(undefined, async () => {
        engine.closeAll();
        session = { ...(session as ReplaySession), status: "ended" };
        set({ status: "ended" });
        await persist();
      });
    },
    dispose: async () => {
      closing = true;
      if (saveTimer) clearTimeout(saveTimer);
      clock.dispose();
      globalThis.removeEventListener?.("pagehide", flushOnHide);
      // Let any in-flight operation finish against this engine, then save once more and stop.
      await opChain.catch(() => undefined);
      disposed = true;
      await persist({ final: true });
      await saveChain;
      detachEngine();
      if (activeToken === token) {
        activeToken = null;
        useReplayStore.setState(INITIAL_REPLAY_STATE);
      }
    },
  };
}

import { closeAll, closePosition } from "./close.ts";
import { cancelOrder, modifyOrder, modifyPosition, placeOrder } from "./orders.ts";
import { processBar } from "./process-bar.ts";
import type {
  Bar,
  EngineConfig,
  EngineDeps,
  EngineEvent,
  EngineResult,
  EngineState,
  OrderMods,
  PlaceOrderInput,
  PositionMods,
} from "./types.ts";

/**
 * Stateful shell around the pure engine functions: holds the current
 * immutable state, applies actions and notifies subscribers with the events
 * each call produced.
 */

export type EngineListener = (events: readonly EngineEvent[], state: EngineState) => void;

export interface ReplayEngine {
  getState(): EngineState;
  /** Processes bars in order (skipping any at/before the cursor); emits once. Throws on malformed bars. */
  advance(bars: readonly Bar[]): readonly EngineEvent[];
  placeOrder(input: PlaceOrderInput): EngineResult;
  cancelOrder(orderId: string): EngineResult;
  modifyOrder(orderId: string, mods: OrderMods): EngineResult;
  modifyPosition(positionId: string, mods: PositionMods): EngineResult;
  closePosition(positionId: string, quantity?: number): EngineResult;
  closeAll(): EngineResult;
  subscribe(listener: EngineListener): () => void;
}

export function initialEngineState(cfg: EngineConfig): EngineState {
  return {
    cursorTime: null,
    lastClose: null,
    balance: cfg.startingBalance,
    positions: [],
    orders: [],
    closedTrades: [],
  };
}

const DEFAULT_DEPS: EngineDeps = { newId: () => crypto.randomUUID() };

export function createReplayEngine(
  cfg: EngineConfig,
  initialState: EngineState = initialEngineState(cfg),
  deps: EngineDeps = DEFAULT_DEPS,
): ReplayEngine {
  let state = initialState;
  const listeners = new Set<EngineListener>();

  function emit(events: readonly EngineEvent[]): void {
    if (events.length === 0) return;
    for (const listener of [...listeners]) listener(events, state);
  }

  function commit(result: EngineResult): EngineResult {
    if (!result.ok) return result;
    state = result.state;
    emit(result.events);
    return result;
  }

  function advance(bars: readonly Bar[]): readonly EngineEvent[] {
    let events: EngineEvent[] = [];
    for (const bar of bars) {
      if (state.cursorTime != null && bar.time <= state.cursorTime) continue;
      const result = processBar(state, cfg, bar, deps);
      if (!result.ok) {
        emit(events);
        throw new Error(`Invalid bar at ${bar.time}: ${result.error.message}`);
      }
      state = result.state;
      events = [...events, ...result.events];
    }
    emit(events);
    return events;
  }

  return {
    getState: () => state,
    advance,
    placeOrder: (input) => commit(placeOrder(state, cfg, input, deps)),
    cancelOrder: (orderId) => commit(cancelOrder(state, cfg, orderId)),
    modifyOrder: (orderId, mods) => commit(modifyOrder(state, cfg, orderId, mods)),
    modifyPosition: (positionId, mods) => commit(modifyPosition(state, cfg, positionId, mods)),
    closePosition: (positionId, quantity) => commit(closePosition(state, cfg, { positionId, quantity }, deps)),
    closeAll: () => commit(closeAll(state, cfg, deps)),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

import { applyClose, closeEvery } from "./close.ts";
import { accountSnapshot, equityEvent, markPosition } from "./equity.ts";
import { applyExcursion, fillOrder, type Step } from "./fill.ts";
import { pathSegments } from "./intrabar.ts";
import { roundPrice } from "./price.ts";
import { fail, ok } from "./result.ts";
import { collectTriggers, isCrossed, type Trigger } from "./triggers.ts";
import type { Bar, EngineConfig, EngineDeps, EngineEvent, EngineResult, EngineState } from "./types.ts";

/**
 * Advances the engine by one bar: fills anything the gap to the open crossed,
 * walks the intrabar path filling the nearest trigger repeatedly, then marks
 * to market at the close and applies stop-out.
 */

interface Walk extends Step {
  /** Current bid along the intrabar path. */
  readonly bid: number;
}

interface Hit {
  readonly trigger: Trigger;
  /** Bid at which the trigger fires. */
  readonly at: number;
  readonly fillPrice: number;
}

function validateBar(state: EngineState, bar: Bar): string | null {
  const values = [bar.time, bar.open, bar.high, bar.low, bar.close];
  if (!values.every(Number.isFinite)) return "Bar contains non-finite values";
  if (state.cursorTime != null && bar.time <= state.cursorTime) {
    return `Bar time ${bar.time} is not after cursor ${state.cursorTime}`;
  }
  if (bar.high < Math.max(bar.open, bar.close) || bar.high < bar.low) return "Bar high is below open/close/low";
  if (bar.low > Math.min(bar.open, bar.close)) return "Bar low is above open/close";
  return null;
}

/** Where (if anywhere) `t` fires moving from bid `from` to `to`. */
function hitOf(t: Trigger, from: number, to: number, cfg: EngineConfig): Hit | null {
  if (isCrossed(t, from)) {
    const fillPrice = t.level === from ? t.fillPrice : roundPrice(from + t.offset, cfg);
    return { trigger: t, at: from, fillPrice };
  }
  const inLeg = t.dir === "up" ? to > from && t.level <= to : to < from && t.level >= to;
  return inLeg ? { trigger: t, at: t.level, fillPrice: t.fillPrice } : null;
}

/** Nearest trigger along the leg; ties go to the lowest rank. */
function nextHit(state: EngineState, cfg: EngineConfig, from: number, to: number): Hit | null {
  let best: Hit | null = null;
  for (const t of collectTriggers(state, cfg)) {
    const hit = hitOf(t, from, to, cfg);
    if (!hit) continue;
    const dist = Math.abs(hit.at - from);
    const bestDist = best ? Math.abs(best.at - from) : Infinity;
    if (dist < bestDist || (dist === bestDist && best && t.rank < best.trigger.rank)) best = hit;
  }
  return best;
}

function withExcursions(state: EngineState, bid: number, cfg: EngineConfig): EngineState {
  return { ...state, positions: state.positions.map((p) => applyExcursion(p, bid, cfg)) };
}

function applyHit(state: EngineState, cfg: EngineConfig, hit: Hit, time: number, deps: EngineDeps): Step | null {
  const { trigger } = hit;
  if (trigger.kind === "ORDER") {
    const order = state.orders.find((o) => o.id === trigger.itemId);
    return order ? fillOrder(state, cfg, order, hit.fillPrice, time, hit.at, deps) : null;
  }
  const pos = state.positions.find((p) => p.id === trigger.itemId);
  if (!pos) return null;
  return applyClose(state, cfg, pos, { quantity: pos.quantity, price: hit.fillPrice, time, reason: trigger.kind }, deps);
}

/** Moves the bid from walk.bid to `to`, applying every trigger met on the way. */
function walkLeg(walk: Walk, cfg: EngineConfig, to: number, time: number, deps: EngineDeps): Walk {
  let current = walk;
  for (;;) {
    const hit = nextHit(current.state, cfg, current.bid, to);
    if (!hit) break;
    const step = applyHit(withExcursions(current.state, hit.at, cfg), cfg, hit, time, deps);
    if (!step) break;
    current = { state: step.state, events: [...current.events, ...step.events], bid: hit.at };
  }
  return { ...current, state: withExcursions(current.state, to, cfg), bid: to };
}

function stopOutIfNeeded(state: EngineState, cfg: EngineConfig, bar: Bar, deps: EngineDeps): Step {
  if (state.positions.length === 0 || accountSnapshot(state, cfg).equity > 0) return { state, events: [] };
  return closeEvery(state, cfg, bar.close, bar.time, "STOP_OUT", deps);
}

/** Processes one bar. Pure: never reads the clock or mutates its inputs. */
export function processBar(state: EngineState, cfg: EngineConfig, bar: Bar, deps: EngineDeps): EngineResult {
  const invalid = validateBar(state, bar);
  if (invalid) return fail("INVALID_BAR", invalid);
  // Gap phase: a zero-length leg at the open fires everything already crossed.
  let walk = walkLeg({ state, events: [], bid: bar.open }, cfg, bar.open, bar.time, deps);
  for (const leg of pathSegments(bar)) walk = walkLeg(walk, cfg, leg.to, bar.time, deps);
  const closed: EngineState = {
    ...walk.state,
    cursorTime: bar.time,
    lastClose: bar.close,
    positions: walk.state.positions.map((p) => markPosition(p, bar.close, cfg)),
  };
  const settled = stopOutIfNeeded(closed, cfg, bar, deps);
  const updates: EngineEvent[] = settled.state.positions.map((position) => ({ type: "position-updated", position }));
  return ok(settled.state, [...walk.events, ...settled.events, ...updates, equityEvent(settled.state, cfg)]);
}

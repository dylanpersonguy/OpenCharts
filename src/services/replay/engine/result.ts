import type { EngineErrorCode, EngineEvent, EngineResult, EngineState } from "./types.ts";

/** Constructors for EngineResult values. */

export function ok(state: EngineState, events: readonly EngineEvent[]): EngineResult {
  return { ok: true, state, events };
}

export function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

import type { Bar, EngineConfig, EngineDeps, EngineResult, EngineState } from "./types.ts";

/** Shared fixtures for the replay engine tests. */

export const TEST_CFG: EngineConfig = Object.freeze({
  accountId: "acct-1",
  symbol: "BTCUSD",
  contractSize: 1,
  tickSize: 0.01,
  spread: 1,
  commissionPerLotPerSide: 2,
  leverage: 100,
  startingBalance: 10_000,
});

export function bar(time: number, open: number, high: number, low: number, close: number): Bar {
  return { time, open, high, low, close, volume: 1 };
}

/** Flat bar at `price`, handy for seeding lastClose. */
export function flat(time: number, price: number): Bar {
  return bar(time, price, price, price, price);
}

/** Deterministic id generator: id-1, id-2, ... */
export function seqDeps(prefix = "id"): EngineDeps {
  let n = 0;
  return { newId: () => `${prefix}-${++n}` };
}

/** Recursively freezes a value so any mutation throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** Returns the state of a successful result, failing the test otherwise. */
export function unwrap(result: EngineResult): EngineState {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.state;
}

import { describe, expect, it } from "vitest";
import { createReplayEngine, initialEngineState } from "./create-engine.ts";
import { TEST_CFG, bar, flat, seqDeps } from "./test-utils.ts";
import type { EngineEvent } from "./types.ts";

function run(prefix: string): readonly EngineEvent[] {
  const engine = createReplayEngine(TEST_CFG, undefined, seqDeps(prefix));
  const all: EngineEvent[] = [];
  engine.subscribe((events) => all.push(...events));
  engine.advance([flat(1000, 100)]);
  engine.placeOrder({ side: "BUY", type: "LIMIT", quantity: 1, price: 95, stopLoss: 92 });
  engine.placeOrder({ side: "SELL", type: "MARKET", quantity: 1 });
  engine.advance([bar(1060, 100, 101, 90, 96), bar(1120, 96, 97, 95, 96)]);
  return all;
}

describe("initialEngineState", () => {
  it("starts flat with the configured balance", () => {
    expect(initialEngineState(TEST_CFG)).toEqual({
      cursorTime: null,
      lastClose: null,
      balance: 10_000,
      positions: [],
      orders: [],
      closedTrades: [],
    });
  });
});

describe("createReplayEngine", () => {
  it("emits once per advance with the concatenated events", () => {
    const engine = createReplayEngine(TEST_CFG, undefined, seqDeps());
    const batches: (readonly EngineEvent[])[] = [];
    engine.subscribe((events) => batches.push(events));
    const returned = engine.advance([flat(1000, 100), flat(1060, 101), flat(1120, 102)]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toBe(returned);
    expect(returned.filter((e) => e.type === "equity")).toHaveLength(3);
    expect(engine.getState()).toMatchObject({ cursorTime: 1120, lastClose: 102 });
  });

  it("skips bars at or before the cursor", () => {
    const engine = createReplayEngine(TEST_CFG, undefined, seqDeps());
    engine.advance([flat(1000, 100)]);
    engine.advance([flat(1000, 105), flat(940, 99)]);
    expect(engine.getState()).toMatchObject({ cursorTime: 1000, lastClose: 100 });
  });

  it("throws on malformed bars", () => {
    const engine = createReplayEngine(TEST_CFG, undefined, seqDeps());
    expect(() => engine.advance([bar(1000, 100, 99, 98, 99)])).toThrow(/high/i);
  });

  it("wires actions to state and subscribers", () => {
    const engine = createReplayEngine(TEST_CFG, undefined, seqDeps());
    const seen: string[] = [];
    const unsubscribe = engine.subscribe((events) => seen.push(...events.map((e) => e.type)));
    engine.advance([flat(1000, 100)]);
    const placed = engine.placeOrder({ side: "BUY", type: "LIMIT", quantity: 1, price: 95 });
    expect(placed.ok).toBe(true);
    const orderId = engine.getState().orders[0]!.id;
    expect(engine.modifyOrder(orderId, { price: 96 }).ok).toBe(true);
    expect(engine.cancelOrder(orderId).ok).toBe(true);
    engine.placeOrder({ side: "BUY", type: "MARKET", quantity: 2 });
    const posId = engine.getState().positions[0]!.id;
    expect(engine.modifyPosition(posId, { stopLoss: 90 }).ok).toBe(true);
    expect(engine.closePosition(posId, 1).ok).toBe(true);
    expect(engine.closeAll().ok).toBe(true);
    expect(engine.getState().positions).toHaveLength(0);
    expect(engine.getState().closedTrades).toHaveLength(2);
    expect(seen).toContain("order-canceled");
    expect(seen).toContain("position-partially-closed");

    const failed = engine.placeOrder({ side: "BUY", type: "MARKET", quantity: 0 });
    expect(failed.ok).toBe(false);
    unsubscribe();
    const before = seen.length;
    engine.placeOrder({ side: "BUY", type: "MARKET", quantity: 1 });
    expect(seen).toHaveLength(before);
  });

  it("resumes from an initial state", () => {
    const a = createReplayEngine(TEST_CFG, undefined, seqDeps());
    a.advance([flat(1000, 100)]);
    a.placeOrder({ side: "BUY", type: "MARKET", quantity: 1 });
    const b = createReplayEngine(TEST_CFG, a.getState(), seqDeps("b"));
    expect(b.getState()).toBe(a.getState());
  });

  it("is deterministic with an injected id generator", () => {
    expect(run("x")).toEqual(run("x"));
    expect(run("x").length).toBeGreaterThan(0);
  });
});

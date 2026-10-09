import { describe, expect, it } from "vitest";
import { initialEngineState } from "./create-engine.ts";
import { cancelOrder, modifyOrder, modifyPosition, placeOrder } from "./orders.ts";
import { processBar } from "./process-bar.ts";
import { TEST_CFG, deepFreeze, flat, seqDeps, unwrap } from "./test-utils.ts";
import type { EngineConfig, EngineResult, EngineState, PlaceOrderInput } from "./types.ts";

/** State seeded with one flat bar at 100: bid 100, ask 101. */
function seeded(cfg: EngineConfig = TEST_CFG): EngineState {
  return unwrap(processBar(initialEngineState(cfg), cfg, flat(1000, 100), seqDeps("seed")));
}

/** Shared across calls so ids stay unique when orders are chained. */
const deps = seqDeps();

function place(input: PlaceOrderInput, state = seeded(), cfg = TEST_CFG): EngineResult {
  return placeOrder(state, cfg, input, deps);
}

function errorCode(result: EngineResult): string | undefined {
  return result.ok ? undefined : result.error.code;
}

describe("placeOrder - market", () => {
  it("fills a market buy at lastClose + spread and debits entry commission", () => {
    const res = place({ side: "BUY", type: "MARKET", quantity: 1 });
    const state = unwrap(res);
    expect(state.positions).toHaveLength(1);
    const pos = state.positions[0]!;
    expect(pos.side).toBe("LONG");
    expect(pos.entryPrice).toBe(101);
    expect(pos.entryCommission).toBe(2);
    expect(pos.entryTime).toBe(1000);
    expect(pos.openedAt).toBe(new Date(1000 * 1000).toISOString());
    expect(pos.margin).toBeCloseTo(1.01);
    expect(state.balance).toBe(9998);
    expect(state.orders).toHaveLength(0);
  });

  it("fills a market sell at lastClose (bid)", () => {
    const state = unwrap(place({ side: "SELL", type: "MARKET", quantity: 2 }));
    expect(state.positions[0]!.side).toBe("SHORT");
    expect(state.positions[0]!.entryPrice).toBe(100);
    expect(state.balance).toBe(9996);
  });

  it("emits order-placed, order-filled, position-opened and equity events", () => {
    const res = place({ side: "BUY", type: "MARKET", quantity: 1 });
    if (!res.ok) throw new Error("expected ok");
    expect(res.events.map((e) => e.type)).toEqual(["order-placed", "order-filled", "position-opened", "equity"]);
    const eq = res.events[3]!;
    if (eq.type !== "equity") throw new Error("expected equity");
    expect(eq.balance).toBe(9998);
    expect(eq.equity).toBe(9997); // marked at bid 100 vs entry 101
  });

  it("attaches SL/TP and records the initial stop", () => {
    const state = unwrap(place({ side: "BUY", type: "MARKET", quantity: 1, stopLoss: 95, takeProfit: 110 }));
    expect(state.positions[0]!.stopLoss).toBe(95);
    expect(state.positions[0]!.takeProfit).toBe(110);
    expect(state.positions[0]!.initialStopLoss).toBe(95);
  });

  it("rejects orders before any bar has been processed", () => {
    const res = placeOrder(initialEngineState(TEST_CFG), TEST_CFG, { side: "BUY", type: "MARKET", quantity: 1 }, seqDeps());
    expect(errorCode(res)).toBe("NO_PRICE");
  });
});

describe("placeOrder - validation", () => {
  it.each([0, -1, 1001, 0.005, 1.234])("rejects quantity %s", (quantity) => {
    expect(errorCode(place({ side: "BUY", type: "MARKET", quantity }))).toBe("INVALID_QUANTITY");
  });

  it("accepts the maximum quantity and 0.01 steps", () => {
    const cfg = { ...TEST_CFG, startingBalance: 1_000_000 };
    expect(place({ side: "BUY", type: "MARKET", quantity: 1000 }, seeded(cfg), cfg).ok).toBe(true);
    expect(place({ side: "BUY", type: "MARKET", quantity: 0.07 }).ok).toBe(true);
  });

  it("rejects wrong-side limit and stop prices", () => {
    expect(errorCode(place({ side: "BUY", type: "LIMIT", quantity: 1, price: 101 }))).toBe("INVALID_PRICE");
    expect(errorCode(place({ side: "SELL", type: "LIMIT", quantity: 1, price: 100 }))).toBe("INVALID_PRICE");
    expect(errorCode(place({ side: "BUY", type: "STOP", quantity: 1, stopPrice: 101 }))).toBe("INVALID_PRICE");
    expect(errorCode(place({ side: "SELL", type: "STOP", quantity: 1, stopPrice: 100 }))).toBe("INVALID_PRICE");
  });

  it("rejects missing or non-positive limit/stop prices", () => {
    expect(errorCode(place({ side: "BUY", type: "LIMIT", quantity: 1 }))).toBe("INVALID_PRICE");
    expect(errorCode(place({ side: "SELL", type: "STOP", quantity: 1, stopPrice: -5 }))).toBe("INVALID_PRICE");
  });

  it("rejects SL/TP on the wrong side of the entry", () => {
    expect(errorCode(place({ side: "BUY", type: "MARKET", quantity: 1, stopLoss: 102 }))).toBe("INVALID_STOP_LOSS");
    expect(errorCode(place({ side: "BUY", type: "MARKET", quantity: 1, takeProfit: 100 }))).toBe("INVALID_TAKE_PROFIT");
    expect(errorCode(place({ side: "SELL", type: "MARKET", quantity: 1, stopLoss: 99 }))).toBe("INVALID_STOP_LOSS");
    expect(errorCode(place({ side: "SELL", type: "LIMIT", quantity: 1, price: 105, takeProfit: 106 }))).toBe(
      "INVALID_TAKE_PROFIT",
    );
  });

  it("rejects orders exceeding free margin", () => {
    const cfg = { ...TEST_CFG, leverage: 1 };
    const res = place({ side: "BUY", type: "MARKET", quantity: 1000 }, seeded(cfg), cfg);
    expect(errorCode(res)).toBe("INSUFFICIENT_MARGIN");
  });

  it("rounds prices to the tick size", () => {
    const state = unwrap(place({ side: "BUY", type: "LIMIT", quantity: 1, price: 95.004, stopLoss: 90.006 }));
    expect(state.orders[0]!.price).toBe(95);
    expect(state.orders[0]!.stopLoss).toBe(90.01);
  });
});

describe("placeOrder - pending", () => {
  it("rests limit and stop orders as PENDING with placedTime", () => {
    const s1 = unwrap(place({ side: "BUY", type: "LIMIT", quantity: 1, price: 95, takeProfit: 99 }));
    const s2 = unwrap(place({ side: "SELL", type: "STOP", quantity: 1, stopPrice: 95 }, s1));
    expect(s2.orders).toHaveLength(2);
    expect(s2.orders[0]).toMatchObject({ type: "LIMIT", price: 95, stopPrice: null, status: "PENDING", placedTime: 1000 });
    expect(s2.orders[1]).toMatchObject({ type: "STOP", price: null, stopPrice: 95, status: "PENDING" });
    expect(s2.positions).toHaveLength(0);
    expect(s2.balance).toBe(10_000);
  });
});

describe("cancelOrder / modifyOrder", () => {
  const withLimit = () => unwrap(place({ side: "BUY", type: "LIMIT", quantity: 1, price: 95 }));

  it("cancels a pending order", () => {
    const state = withLimit();
    const res = cancelOrder(state, TEST_CFG, state.orders[0]!.id);
    if (!res.ok) throw new Error("expected ok");
    expect(res.state.orders).toHaveLength(0);
    expect(res.events).toEqual([{ type: "order-canceled", orderId: state.orders[0]!.id }]);
  });

  it("fails to cancel an unknown order", () => {
    expect(errorCode(cancelOrder(withLimit(), TEST_CFG, "nope"))).toBe("NOT_FOUND");
  });

  it("modifies price and brackets with validation", () => {
    const state = withLimit();
    const id = state.orders[0]!.id;
    const res = modifyOrder(state, TEST_CFG, id, { price: 96, stopLoss: 90, takeProfit: 99 });
    const next = unwrap(res);
    expect(next.orders[0]).toMatchObject({ price: 96, stopLoss: 90, takeProfit: 99 });
    if (res.ok) expect(res.events[0]!.type).toBe("order-modified");

    const cleared = unwrap(modifyOrder(next, TEST_CFG, id, { stopLoss: null }));
    expect(cleared.orders[0]!.stopLoss).toBeNull();
    expect(cleared.orders[0]!.takeProfit).toBe(99);

    expect(errorCode(modifyOrder(state, TEST_CFG, id, { price: 102 }))).toBe("INVALID_PRICE");
    expect(errorCode(modifyOrder(state, TEST_CFG, id, { stopLoss: 97 }))).toBe("INVALID_STOP_LOSS");
  });
});

describe("modifyPosition", () => {
  const withLong = () => unwrap(place({ side: "BUY", type: "MARKET", quantity: 1 }));

  it("sets SL/TP and records the first SL as the initial stop", () => {
    const state = withLong();
    const id = state.positions[0]!.id;
    const s1 = unwrap(modifyPosition(state, TEST_CFG, id, { stopLoss: 95, takeProfit: 110 }));
    expect(s1.positions[0]).toMatchObject({ stopLoss: 95, takeProfit: 110, initialStopLoss: 95 });
    const s2 = unwrap(modifyPosition(s1, TEST_CFG, id, { stopLoss: 98 }));
    expect(s2.positions[0]).toMatchObject({ stopLoss: 98, initialStopLoss: 95 });
    const s3 = unwrap(modifyPosition(s2, TEST_CFG, id, { takeProfit: null }));
    expect(s3.positions[0]!.takeProfit).toBeNull();
  });

  it("validates against the current price", () => {
    const state = withLong();
    const id = state.positions[0]!.id;
    expect(errorCode(modifyPosition(state, TEST_CFG, id, { stopLoss: 100 }))).toBe("INVALID_STOP_LOSS");
    expect(errorCode(modifyPosition(state, TEST_CFG, id, { takeProfit: 99 }))).toBe("INVALID_TAKE_PROFIT");
    expect(errorCode(modifyPosition(state, TEST_CFG, "nope", { takeProfit: 120 }))).toBe("NOT_FOUND");
  });

  it("validates short brackets against the ask", () => {
    const state = unwrap(place({ side: "SELL", type: "MARKET", quantity: 1 }));
    const id = state.positions[0]!.id;
    expect(errorCode(modifyPosition(state, TEST_CFG, id, { stopLoss: 101 }))).toBe("INVALID_STOP_LOSS");
    expect(modifyPosition(state, TEST_CFG, id, { stopLoss: 101.5, takeProfit: 90 }).ok).toBe(true);
  });
});

describe("immutability", () => {
  it("never mutates frozen state", () => {
    const state = deepFreeze(seeded());
    const s1 = deepFreeze(unwrap(place({ side: "BUY", type: "LIMIT", quantity: 1, price: 95 }, state)));
    const s2 = deepFreeze(unwrap(place({ side: "BUY", type: "MARKET", quantity: 1 }, s1)));
    const orderId = s2.orders[0]!.id;
    const posId = s2.positions[0]!.id;
    expect(() => modifyOrder(s2, TEST_CFG, orderId, { price: 94 })).not.toThrow();
    expect(() => cancelOrder(s2, TEST_CFG, orderId)).not.toThrow();
    expect(() => modifyPosition(s2, TEST_CFG, posId, { stopLoss: 90 })).not.toThrow();
    expect(s2.orders).toHaveLength(1);
    expect(s2.positions[0]!.stopLoss).toBeNull();
  });
});

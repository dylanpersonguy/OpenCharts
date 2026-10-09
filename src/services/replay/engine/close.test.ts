import { describe, expect, it } from "vitest";
import { closeAll, closePosition } from "./close.ts";
import { initialEngineState } from "./create-engine.ts";
import { placeOrder } from "./orders.ts";
import { processBar } from "./process-bar.ts";
import { TEST_CFG, deepFreeze, flat, seqDeps, unwrap } from "./test-utils.ts";
import type { EngineState, PlaceOrderInput } from "./types.ts";

function withPosition(input: PlaceOrderInput): EngineState {
  const seeded = unwrap(processBar(initialEngineState(TEST_CFG), TEST_CFG, flat(1000, 100), seqDeps("seed")));
  return unwrap(placeOrder(seeded, TEST_CFG, input, seqDeps("ord")));
}

describe("closePosition", () => {
  it("closes a long manually at the bid", () => {
    const s0 = withPosition({ side: "BUY", type: "MARKET", quantity: 1, stopLoss: 98 });
    const res = closePosition(s0, TEST_CFG, { positionId: s0.positions[0]!.id }, seqDeps("c"));
    const s = unwrap(res);
    expect(s.positions).toHaveLength(0);
    expect(s.closedTrades[0]).toMatchObject({
      id: "c-1",
      exitReason: "MANUAL",
      exitPrice: 100,
      exitTime: 1000,
      grossPnl: -1,
      commission: 4,
      netPnl: -5,
      rMultiple: -5 / 3,
      symbol: "BTCUSD",
    });
    expect(s.balance).toBe(9995);
    if (res.ok) expect(res.events.map((e) => e.type)).toEqual(["position-closed", "equity"]);
  });

  it("closes a short manually at the ask", () => {
    const s0 = withPosition({ side: "SELL", type: "MARKET", quantity: 1 });
    const s = unwrap(closePosition(s0, TEST_CFG, { positionId: s0.positions[0]!.id }, seqDeps("c")));
    expect(s.closedTrades[0]).toMatchObject({ exitPrice: 101, grossPnl: -1, rMultiple: null });
  });

  it("partially closes and prorates the entry commission", () => {
    const s0 = withPosition({ side: "BUY", type: "MARKET", quantity: 2 });
    const id = s0.positions[0]!.id;
    const res = closePosition(s0, TEST_CFG, { positionId: id, quantity: 0.5 }, seqDeps("c"));
    const s = unwrap(res);
    expect(s.positions[0]).toMatchObject({ id, quantity: 1.5, entryCommission: 3 });
    expect(s.closedTrades[0]).toMatchObject({
      positionId: id,
      quantity: 0.5,
      grossPnl: -0.5,
      commission: 2,
      netPnl: -2.5,
      isPartial: true,
    });
    expect(s.balance).toBe(10_000 - 4 - 0.5 - 1);
    if (res.ok) expect(res.events.map((e) => e.type)).toEqual(["position-partially-closed", "equity"]);
  });

  it("treats a quantity >= the position size as a full close", () => {
    const s0 = withPosition({ side: "BUY", type: "MARKET", quantity: 1 });
    const s = unwrap(closePosition(s0, TEST_CFG, { positionId: s0.positions[0]!.id, quantity: 5 }, seqDeps("c")));
    expect(s.positions).toHaveLength(0);
    expect(s.closedTrades[0]!.isPartial).toBe(false);
  });

  it("validates id and quantity", () => {
    const s0 = withPosition({ side: "BUY", type: "MARKET", quantity: 1 });
    const id = s0.positions[0]!.id;
    const bad = closePosition(s0, TEST_CFG, { positionId: "nope" }, seqDeps());
    expect(bad.ok ? null : bad.error.code).toBe("NOT_FOUND");
    const zero = closePosition(s0, TEST_CFG, { positionId: id, quantity: 0 }, seqDeps());
    expect(zero.ok ? null : zero.error.code).toBe("INVALID_QUANTITY");
  });

  it("does not mutate frozen state", () => {
    const s0 = deepFreeze(withPosition({ side: "BUY", type: "MARKET", quantity: 2 }));
    const s = unwrap(closePosition(s0, TEST_CFG, { positionId: s0.positions[0]!.id, quantity: 1 }, seqDeps()));
    expect(s0.positions[0]!.quantity).toBe(2);
    expect(s.positions[0]!.quantity).toBe(1);
  });
});

describe("closeAll", () => {
  it("closes every open position", () => {
    const s1 = withPosition({ side: "BUY", type: "MARKET", quantity: 1 });
    const s2 = unwrap(placeOrder(s1, TEST_CFG, { side: "SELL", type: "MARKET", quantity: 1 }, seqDeps("o2")));
    const res = closeAll(s2, TEST_CFG, seqDeps("c"));
    const s = unwrap(res);
    expect(s.positions).toHaveLength(0);
    expect(s.closedTrades).toHaveLength(2);
    if (res.ok) expect(res.events.filter((e) => e.type === "equity")).toHaveLength(1);
  });
});

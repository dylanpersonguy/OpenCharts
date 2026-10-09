import { describe, expect, it } from "vitest";
import { initialEngineState } from "./create-engine.ts";
import { placeOrder } from "./orders.ts";
import { processBar } from "./process-bar.ts";
import { TEST_CFG, bar, deepFreeze, flat, seqDeps, unwrap } from "./test-utils.ts";
import type { Bar, EngineResult, EngineState, PlaceOrderInput } from "./types.ts";

/** State seeded with one flat bar at 100 (bid 100, ask 101), then `input` placed. */
function withOrder(input: PlaceOrderInput): EngineState {
  const seeded = unwrap(processBar(initialEngineState(TEST_CFG), TEST_CFG, flat(1000, 100), seqDeps("seed")));
  return unwrap(placeOrder(seeded, TEST_CFG, input, seqDeps("ord")));
}

function step(state: EngineState, b: Bar): EngineResult {
  return processBar(state, TEST_CFG, b, seqDeps("bar"));
}

const next = (o: number, h: number, l: number, c: number) => bar(1060, o, h, l, c);

describe("processBar - resting entries", () => {
  it("fills a buy limit at its price when the ask touches it", () => {
    // O->H->L->C: 100 -> 101 -> 94 -> 98; ask hits 95 when bid reaches 94
    const s = unwrap(step(withOrder({ side: "BUY", type: "LIMIT", quantity: 1, price: 95 }), next(100, 101, 94, 98)));
    expect(s.orders).toHaveLength(0);
    expect(s.positions[0]).toMatchObject({ side: "LONG", entryPrice: 95, entryTime: 1060 });
    expect(s.balance).toBe(9998);
  });

  it("does not fill a buy limit when only the bid touches it", () => {
    const s = unwrap(step(withOrder({ side: "BUY", type: "LIMIT", quantity: 1, price: 95 }), next(100, 101, 94.5, 98)));
    expect(s.orders).toHaveLength(1);
    expect(s.positions).toHaveLength(0);
  });

  it("fills a buy stop at its price when the ask rises to it", () => {
    const s = unwrap(step(withOrder({ side: "BUY", type: "STOP", quantity: 1, stopPrice: 105 }), next(100, 106, 99, 103)));
    expect(s.positions[0]!.entryPrice).toBe(105);
  });

  it("fills a sell limit and a sell stop at their prices on the bid", () => {
    const sl = unwrap(step(withOrder({ side: "SELL", type: "LIMIT", quantity: 1, price: 105 }), next(100, 105, 99, 103)));
    expect(sl.positions[0]).toMatchObject({ side: "SHORT", entryPrice: 105 });
    const ss = unwrap(step(withOrder({ side: "SELL", type: "STOP", quantity: 1, stopPrice: 95 }), next(100, 101, 95, 97)));
    expect(ss.positions[0]).toMatchObject({ side: "SHORT", entryPrice: 95 });
  });

  it("emits order-filled and position-opened events", () => {
    const res = step(withOrder({ side: "BUY", type: "LIMIT", quantity: 1, price: 95 }), next(100, 101, 94, 98));
    if (!res.ok) throw new Error("expected ok");
    expect(res.events.map((e) => e.type)).toEqual(["order-filled", "position-opened", "position-updated", "equity"]);
    const filled = res.events[0]!;
    if (filled.type !== "order-filled") throw new Error("expected order-filled");
    expect(filled.order).toMatchObject({ status: "FILLED", filledQuantity: 1, avgFillPrice: 95 });
  });
});

describe("processBar - gaps", () => {
  it("fills stops at the open (worse) when price gaps through", () => {
    const buy = unwrap(step(withOrder({ side: "BUY", type: "STOP", quantity: 1, stopPrice: 105 }), next(110, 112, 109, 111)));
    expect(buy.positions[0]!.entryPrice).toBe(111); // open bid 110 + spread
    const sell = unwrap(step(withOrder({ side: "SELL", type: "STOP", quantity: 1, stopPrice: 95 }), next(90, 91, 88, 89)));
    expect(sell.positions[0]!.entryPrice).toBe(90);
  });

  it("fills limits at the open (better) when price gaps through", () => {
    const buy = unwrap(step(withOrder({ side: "BUY", type: "LIMIT", quantity: 1, price: 95 }), next(90, 91, 88, 89)));
    expect(buy.positions[0]!.entryPrice).toBe(91);
    const sell = unwrap(step(withOrder({ side: "SELL", type: "LIMIT", quantity: 1, price: 105 }), next(110, 112, 109, 111)));
    expect(sell.positions[0]!.entryPrice).toBe(110);
  });

  it("exits SL at the open when gapping through it", () => {
    const s = unwrap(step(withOrder({ side: "BUY", type: "MARKET", quantity: 1, stopLoss: 95 }), next(90, 92, 89, 91)));
    expect(s.closedTrades[0]).toMatchObject({ exitReason: "SL", exitPrice: 90 });
    const short = unwrap(step(withOrder({ side: "SELL", type: "MARKET", quantity: 1, stopLoss: 105 }), next(110, 111, 109, 110)));
    expect(short.closedTrades[0]).toMatchObject({ exitReason: "SL", exitPrice: 111 });
  });
});

describe("processBar - SL/TP", () => {
  const long = { side: "BUY", type: "MARKET", quantity: 1, stopLoss: 95, takeProfit: 110 } as const;
  const short = { side: "SELL", type: "MARKET", quantity: 1, stopLoss: 105, takeProfit: 90 } as const;

  it("exits a long at TP on the bid", () => {
    const s = unwrap(step(withOrder(long), next(100, 111, 99, 105)));
    expect(s.positions).toHaveLength(0);
    expect(s.closedTrades[0]).toMatchObject({
      exitReason: "TP",
      exitPrice: 110,
      entryPrice: 101,
      grossPnl: 9,
      commission: 4,
      netPnl: 5,
      exitTime: 1060,
      entryTime: 1000,
      isPartial: false,
    });
    expect(s.balance).toBe(10_005);
  });

  it("exits a long at SL on the bid", () => {
    const s = unwrap(step(withOrder(long), next(100, 100.5, 94, 96)));
    expect(s.closedTrades[0]).toMatchObject({ exitReason: "SL", exitPrice: 95, netPnl: -10 });
  });

  it("exits a short at SL when the ask reaches it", () => {
    const miss = unwrap(step(withOrder(short), next(100, 103.5, 99, 101)));
    expect(miss.positions).toHaveLength(1);
    const s = unwrap(step(withOrder(short), next(100, 104, 99, 101)));
    expect(s.closedTrades[0]).toMatchObject({ exitReason: "SL", exitPrice: 105, grossPnl: -5 });
  });

  it("exits a short at TP when the ask reaches it", () => {
    const miss = unwrap(step(withOrder(short), next(100, 100, 89.5, 92)));
    expect(miss.positions).toHaveLength(1);
    const s = unwrap(step(withOrder(short), next(100, 100, 89, 92)));
    expect(s.closedTrades[0]).toMatchObject({ exitReason: "TP", exitPrice: 90, grossPnl: 10 });
  });

  it("resolves SL and TP inside one bar by path order", () => {
    // open nearer the low -> low first -> SL
    const slFirst = unwrap(step(withOrder(long), next(100, 111, 94, 100)));
    expect(slFirst.closedTrades.map((t) => t.exitReason)).toEqual(["SL"]);
    // open nearer the high -> high first -> TP
    const tpFirst = unwrap(step(withOrder(long), next(105, 111, 94, 100)));
    expect(tpFirst.closedTrades.map((t) => t.exitReason)).toEqual(["TP"]);
  });

  it("fills a limit and then hits its SL later in the same bar", () => {
    const s0 = withOrder({ side: "BUY", type: "LIMIT", quantity: 1, price: 95, stopLoss: 92 });
    const s = unwrap(step(s0, next(100, 101, 90, 96)));
    expect(s.positions).toHaveLength(0);
    expect(s.closedTrades[0]).toMatchObject({ entryPrice: 95, exitPrice: 92, exitReason: "SL", netPnl: -7 });
  });

  it("fills a limit and then hits its TP on the way back up", () => {
    const s0 = withOrder({ side: "BUY", type: "LIMIT", quantity: 1, price: 95, takeProfit: 99 });
    const s = unwrap(step(s0, next(100, 100.5, 93, 99.5)));
    expect(s.closedTrades[0]).toMatchObject({ entryPrice: 95, exitPrice: 99, exitReason: "TP" });
  });

  it("fills a stop entry and its TP further along the same leg", () => {
    const s0 = withOrder({ side: "BUY", type: "STOP", quantity: 1, stopPrice: 105, takeProfit: 108 });
    const s = unwrap(step(s0, next(100, 110, 99.5, 109)));
    expect(s.closedTrades[0]).toMatchObject({ entryPrice: 105, exitPrice: 108, exitReason: "TP" });
  });

  it("exits immediately at the ask when a new short's SL sits inside the spread", () => {
    const s0 = withOrder({ side: "SELL", type: "LIMIT", quantity: 1, price: 105, stopLoss: 105.5 });
    const s = unwrap(step(s0, next(100, 106, 99, 100)));
    expect(s.closedTrades[0]).toMatchObject({ entryPrice: 105, exitPrice: 106, exitReason: "SL" });
  });

  it("fills several resting orders in path order within one bar", () => {
    const s1 = withOrder({ side: "BUY", type: "LIMIT", quantity: 1, price: 97 });
    const s2 = unwrap(placeOrder(s1, TEST_CFG, { side: "SELL", type: "LIMIT", quantity: 1, price: 103 }, seqDeps("o2")));
    const s = unwrap(step(s2, next(100, 104, 95, 100)));
    expect(s.orders).toHaveLength(0);
    expect(s.positions.map((p) => [p.side, p.entryPrice])).toEqual([
      ["SHORT", 103],
      ["LONG", 97],
    ]);
  });

  it("computes R-multiple from the initial stop, or null without one", () => {
    const withSl = unwrap(step(withOrder(long), next(100, 111, 99, 105)));
    expect(withSl.closedTrades[0]!.rMultiple).toBeCloseTo(5 / 6);
    const noSl = unwrap(step(withOrder({ side: "BUY", type: "MARKET", quantity: 1, takeProfit: 110 }), next(100, 111, 99, 105)));
    expect(noSl.closedTrades[0]!.rMultiple).toBeNull();
  });
});

describe("processBar - marking, MAE/MFE, stop-out", () => {
  it("marks longs at the bid close and shorts at the ask close", () => {
    const l = unwrap(step(withOrder({ side: "BUY", type: "MARKET", quantity: 2 }), next(100, 104, 97, 103)));
    expect(l.positions[0]).toMatchObject({ currentPrice: 103, unrealizedPnl: 4 });
    const s = unwrap(step(withOrder({ side: "SELL", type: "MARKET", quantity: 2 }), next(100, 104, 97, 103)));
    expect(s.positions[0]).toMatchObject({ currentPrice: 104, unrealizedPnl: -8 });
  });

  it("tracks MAE/MFE as price distances from entry", () => {
    const s = unwrap(step(withOrder({ side: "BUY", type: "MARKET", quantity: 1 }), next(100, 104, 97, 103)));
    expect(s.positions[0]).toMatchObject({ mae: 4, mfe: 3 });
    const s2 = unwrap(processBar(s, TEST_CFG, bar(1120, 103, 103, 102, 102), seqDeps("b2")));
    expect(s2.positions[0]).toMatchObject({ mae: 4, mfe: 3 });
  });

  it("only counts excursions after a mid-bar entry", () => {
    // high 101 happens before the limit fills at bid 94
    const s = unwrap(step(withOrder({ side: "BUY", type: "LIMIT", quantity: 1, price: 95 }), next(100, 101, 93, 98)));
    expect(s.positions[0]).toMatchObject({ mae: 2, mfe: 3 });
  });

  it("carries MAE/MFE onto the closed trade", () => {
    const s = unwrap(step(withOrder({ side: "BUY", type: "MARKET", quantity: 1, stopLoss: 95, takeProfit: 110 }), next(100, 111, 99, 105)));
    expect(s.closedTrades[0]).toMatchObject({ mae: 2, mfe: 9 });
  });

  it("stops out every position when equity reaches zero", () => {
    const s0 = withOrder({ side: "BUY", type: "MARKET", quantity: 900 });
    const res = step(s0, next(100, 100, 88, 88));
    const s = unwrap(res);
    expect(s.positions).toHaveLength(0);
    expect(s.closedTrades[0]).toMatchObject({ exitReason: "STOP_OUT", exitPrice: 88 });
    if (res.ok) {
      const eq = res.events.at(-1)!;
      expect(eq.type).toBe("equity");
    }
  });

  it("advances the cursor and last close", () => {
    const s = unwrap(step(withOrder({ side: "BUY", type: "LIMIT", quantity: 1, price: 50 }), next(100, 104, 97, 103)));
    expect(s.cursorTime).toBe(1060);
    expect(s.lastClose).toBe(103);
  });
});

describe("processBar - input checks", () => {
  it("rejects bars at or before the cursor and malformed bars", () => {
    const s0 = withOrder({ side: "BUY", type: "LIMIT", quantity: 1, price: 50 });
    expect(step(s0, flat(1000, 100)).ok).toBe(false);
    expect(step(s0, bar(1060, 100, 99, 98, 99)).ok).toBe(false);
    expect(step(s0, bar(1060, Number.NaN, 101, 99, 100)).ok).toBe(false);
  });

  it("does not mutate frozen state or bars and is deterministic", () => {
    const s0 = deepFreeze(withOrder({ side: "BUY", type: "LIMIT", quantity: 1, price: 95, stopLoss: 92 }));
    const b = deepFreeze(next(100, 101, 90, 96));
    const a = processBar(s0, TEST_CFG, b, seqDeps("x"));
    const c = processBar(s0, TEST_CFG, b, seqDeps("x"));
    expect(a).toEqual(c);
    expect(s0.orders).toHaveLength(1);
    expect(s0.cursorTime).toBe(1000);
  });
});

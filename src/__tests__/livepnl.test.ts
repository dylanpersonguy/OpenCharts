import { describe, expect, it } from "vitest";
import { computeLivePnl, computeLivePrice, type LiveTick } from "@/lib/livePnl";
import type { Position } from "@/services/schemas";

function position(overrides: Partial<Position> = {}): Position {
  return {
    id: "p1",
    accountId: "a1",
    symbolName: "BTCUSD",
    side: "LONG",
    quantity: 1,
    entryPrice: 100,
    currentPrice: 100,
    unrealizedPnl: 0,
    margin: 1,
    contractSize: 1,
    openedAt: new Date().toISOString(),
    takeProfit: null,
    stopLoss: null,
    ...overrides,
  } as Position;
}

const tick = (bid: number, ask = bid): LiveTick => ({ bid, ask, timestamp: Date.now() });

describe("computeLivePnl", () => {
  it("returns the snapshot when there is no live tick", () => {
    expect(computeLivePnl(position({ unrealizedPnl: 42 }))).toBe(42);
  });

  it("scales the snapshot by the live price move", () => {
    // Snapshot: +10 of P&L for a 10-point move → 1 unit of P&L per point.
    const p = position({ currentPrice: 110, unrealizedPnl: 10 });
    expect(computeLivePnl(p, tick(120))).toBeCloseTo(20, 10);
  });

  it("prices a freshly-opened position off contract maths, not a frozen zero", () => {
    // currentPrice === entryPrice, so there is no ratio to derive.
    const p = position({ currentPrice: 100, unrealizedPnl: 0, quantity: 2 });
    expect(computeLivePnl(p, tick(105))).toBeCloseTo(10, 10);
  });

  it("gets the sign right for a short with no snapshot move", () => {
    const p = position({ side: "SHORT", currentPrice: 100, unrealizedPnl: 0 });
    expect(computeLivePnl(p, tick(95, 95))).toBeCloseTo(5, 10);
    expect(computeLivePnl(p, tick(105, 105))).toBeCloseTo(-5, 10);
  });

  it("honours contract size", () => {
    const p = position({ currentPrice: 100, unrealizedPnl: 0, contractSize: 10 });
    expect(computeLivePnl(p, tick(101))).toBeCloseTo(10, 10);
  });

  it("uses bid for longs and ask for shorts", () => {
    const long = position({ currentPrice: 100, unrealizedPnl: 0 });
    expect(computeLivePnl(long, { bid: 101, ask: 109, timestamp: 0 })).toBeCloseTo(1, 10);

    const short = position({ side: "SHORT", currentPrice: 100, unrealizedPnl: 0 });
    expect(computeLivePnl(short, { bid: 91, ask: 99, timestamp: 0 })).toBeCloseTo(1, 10);
  });

  it("never returns NaN", () => {
    const p = position({ currentPrice: 100, unrealizedPnl: 0, contractSize: undefined });
    expect(Number.isFinite(computeLivePnl(p, tick(101)))).toBe(true);
  });
});

describe("computeLivePrice", () => {
  it("falls back to the snapshot price without a tick", () => {
    expect(computeLivePrice(position({ currentPrice: 123 }))).toBe(123);
  });

  it("quotes longs on the bid and shorts on the ask", () => {
    expect(computeLivePrice(position(), { bid: 10, ask: 11, timestamp: 0 })).toBe(10);
    expect(computeLivePrice(position({ side: "SHORT" }), { bid: 10, ask: 11, timestamp: 0 })).toBe(
      11,
    );
  });
});

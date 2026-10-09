import { describe, it, expect } from "vitest";
import type { ClosedTrade } from "./engine/types.ts";
import type { ReplayJournalEntry } from "./session-types.ts";
import { computeSessionStats } from "./stats.ts";

let seq = 0;
function trade(netPnl: number, overrides: Partial<ClosedTrade> = {}): ClosedTrade {
  seq += 1;
  return {
    id: `t${seq}`,
    positionId: `p${seq}`,
    symbol: "XAUUSD",
    side: "LONG",
    quantity: 1,
    entryPrice: 100,
    exitPrice: 100,
    entryTime: seq * 1000,
    exitTime: seq * 1000 + 500,
    exitReason: "MANUAL",
    grossPnl: netPnl,
    commission: 0,
    netPnl,
    initialStopLoss: null,
    takeProfit: null,
    rMultiple: null,
    mae: 0,
    mfe: 0,
    isPartial: false,
    ...overrides,
  };
}

function entry(positionId: string, setup: string, mistakes: string[] = []): ReplayJournalEntry {
  return {
    id: `j-${positionId}`,
    accountId: "acc",
    sessionId: "s",
    positionId,
    tags: [],
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    setup,
    mistakes,
  };
}

describe("computeSessionStats", () => {
  it("returns zeros for an empty session", () => {
    const s = computeSessionStats([], 10_000);
    expect(s.tradeCount).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.netPnl).toBe(0);
    expect(s.profitFactor).toBeNull();
    expect(s.maxDrawdownAbs).toBe(0);
    expect(s.equityCurve).toEqual([]);
  });

  it("computes win rate, profit factor, expectancy and averages", () => {
    const s = computeSessionStats([trade(300), trade(-100), trade(200), trade(-100)], 10_000);
    expect(s.tradeCount).toBe(4);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(2);
    expect(s.winRate).toBeCloseTo(0.5);
    expect(s.grossProfit).toBe(500);
    expect(s.grossLoss).toBe(200);
    expect(s.netPnl).toBe(300);
    expect(s.profitFactor).toBeCloseTo(2.5);
    expect(s.avgWin).toBe(250);
    expect(s.avgLoss).toBe(-100);
    expect(s.expectancy).toBe(75);
    expect(s.largestWin).toBe(300);
    expect(s.largestLoss).toBe(-100);
  });

  it("treats a session with wins and no losses as infinite profit factor", () => {
    expect(computeSessionStats([trade(100)], 1_000).profitFactor).toBe(Number.POSITIVE_INFINITY);
  });

  it("averages R only over trades that have an R-multiple", () => {
    const s = computeSessionStats([trade(200, { rMultiple: 2 }), trade(-100, { rMultiple: -1 }), trade(50)], 1_000);
    expect(s.avgR).toBeCloseTo(0.5);
    expect(s.tradesWithR).toBe(2);
  });

  it("measures max drawdown on closed-trade equity in chronological order", () => {
    const trades = [trade(1000), trade(-500), trade(-1000), trade(2000)];
    const s = computeSessionStats([...trades].reverse(), 10_000);
    // peak 11_000 → trough 9_500
    expect(s.maxDrawdownAbs).toBe(1500);
    expect(s.maxDrawdownPct).toBeCloseTo(1500 / 11_000);
    expect(s.equityCurve.map((p) => p.equity)).toEqual([11_000, 10_500, 9_500, 11_500]);
  });

  it("groups partial closes of one position into a single trade for counts", () => {
    const a = trade(100, { positionId: "same", isPartial: true });
    const b = trade(50, { positionId: "same" });
    const s = computeSessionStats([a, b], 1_000);
    expect(s.tradeCount).toBe(1);
    expect(s.netPnl).toBe(150);
  });

  it("breaks down by side, setup and mistake using journal entries", () => {
    const t1 = trade(100, { side: "LONG" });
    const t2 = trade(-50, { side: "SHORT" });
    const t3 = trade(30, { side: "LONG" });
    const s = computeSessionStats([t1, t2, t3], 1_000, [
      entry(t1.positionId, "Breakout"),
      entry(t2.positionId, "Breakout", ["FOMO entry"]),
    ]);
    expect(s.bySide.LONG).toMatchObject({ count: 2, netPnl: 130 });
    expect(s.bySide.SHORT).toMatchObject({ count: 1, netPnl: -50 });
    expect(s.bySetup.Breakout).toMatchObject({ count: 2, netPnl: 50, winRate: 0.5 });
    expect(s.bySetup.Untagged).toMatchObject({ count: 1, netPnl: 30 });
    expect(s.byMistake["FOMO entry"]).toMatchObject({ count: 1, netPnl: -50 });
  });
});

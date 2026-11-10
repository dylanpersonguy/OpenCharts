import { describe, expect, it } from "vitest";
import {
  estimateOrderFees,
  formatFeeDisclosure,
  formatPercent,
  formatRoundTripDisclosure,
  formatUsd,
  roundTripCost,
} from "../fees";

describe("estimateOrderFees", () => {
  it("taker at 0.1% builder fee on $1000", () => {
    const e = estimateOrderFees({ notional: 1000, side: "buy", isMaker: false, builderFeeTenthsBp: 100 });
    expect(e.builderFee).toBeCloseTo(1.0, 10);
    expect(e.hlFee).toBeCloseTo(0.45, 10);
    expect(e.total).toBeCloseTo(1.45, 10);
    expect(e.effectiveBps).toBeCloseTo(14.5, 8);
    expect(e.builderBps).toBeCloseTo(10, 8);
  });

  it("maker uses the maker rate; builder fee still applies", () => {
    const e = estimateOrderFees({ notional: 1000, side: "sell", isMaker: true, builderFeeTenthsBp: 50 });
    expect(e.builderFee).toBeCloseTo(0.5, 10);
    expect(e.hlFee).toBeCloseTo(0.15, 10);
  });

  it("clamps builder fee to 100 and negatives to 0", () => {
    expect(estimateOrderFees({ notional: 1000, side: "buy", isMaker: false, builderFeeTenthsBp: 500 }).builderFee).toBeCloseTo(1, 10);
    expect(estimateOrderFees({ notional: 1000, side: "buy", isMaker: false, builderFeeTenthsBp: -5 }).builderFee).toBe(0);
    expect(estimateOrderFees({ notional: 1000, side: "buy", isMaker: false, builderFeeTenthsBp: NaN }).builderFee).toBe(0);
  });

  it("applies a HIP-3 multiplier to the HL fee only", () => {
    const e = estimateOrderFees({ notional: 1000, side: "buy", isMaker: false, builderFeeTenthsBp: 100, hlFeeMultiplier: 2 });
    expect(e.hlFee).toBeCloseTo(0.9, 10);
    expect(e.builderFee).toBeCloseTo(1, 10);
  });

  it("supports custom rates including maker rebates", () => {
    const e = estimateOrderFees({
      notional: 10_000,
      side: "buy",
      isMaker: true,
      builderFeeTenthsBp: 30,
      hlFeeRates: { taker: 0.0003, maker: -0.00002 },
    });
    expect(e.hlFee).toBeCloseTo(-0.2, 10);
    expect(e.total).toBeCloseTo(3 - 0.2, 10);
  });

  it("zero notional gives zeros and 0 bps", () => {
    const e = estimateOrderFees({ notional: 0, side: "buy", isMaker: false, builderFeeTenthsBp: 100 });
    expect(e.total).toBe(0);
    expect(e.effectiveBps).toBe(0);
  });

  it("rejects bad notional / multiplier", () => {
    expect(() => estimateOrderFees({ notional: -1, side: "buy", isMaker: false, builderFeeTenthsBp: 1 })).toThrow(RangeError);
    expect(() => estimateOrderFees({ notional: NaN, side: "buy", isMaker: false, builderFeeTenthsBp: 1 })).toThrow(RangeError);
    expect(() =>
      estimateOrderFees({ notional: 1, side: "buy", isMaker: false, builderFeeTenthsBp: 1, hlFeeMultiplier: -1 }),
    ).toThrow(RangeError);
  });
});

describe("roundTripCost", () => {
  it("charges the builder fee on both open and close", () => {
    const rt = roundTripCost({ openNotional: 1000, openIsMaker: false, closeIsMaker: false, builderFeeTenthsBp: 100 });
    expect(rt.builderFee).toBeCloseTo(2, 10);
    expect(rt.hlFee).toBeCloseTo(0.9, 10);
    expect(rt.total).toBeCloseTo(2.9, 10);
    expect(rt.effectiveBps).toBeCloseTo(29, 8);
    expect(rt.breakevenMoveBps).toBeCloseTo(29, 8);
  });

  it("uses a different close notional and mixed maker/taker", () => {
    const rt = roundTripCost({
      openNotional: 1000,
      closeNotional: 1100,
      openIsMaker: true,
      closeIsMaker: false,
      builderFeeTenthsBp: 50,
    });
    expect(rt.open.hlFee).toBeCloseTo(0.15, 10);
    expect(rt.close.hlFee).toBeCloseTo(0.495, 10);
    expect(rt.builderFee).toBeCloseTo(0.5 + 0.55, 10);
  });
});

describe("formatting", () => {
  it("formats percents", () => {
    expect(formatPercent(0.001)).toBe("0.10");
    expect(formatPercent(0.00045)).toBe("0.045");
    expect(formatPercent(0.0003)).toBe("0.03");
    expect(formatPercent(0)).toBe("0.00");
    expect(formatPercent(0.00015)).toBe("0.015");
  });

  it("formats USD", () => {
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(0.45)).toBe("$0.45");
    expect(formatUsd(-0.2)).toBe("-$0.20");
    expect(formatUsd(0.001)).toBe("<$0.01");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("produces the canonical disclosure", () => {
    const e = estimateOrderFees({ notional: 1000, side: "buy", isMaker: false, builderFeeTenthsBp: 100 });
    expect(formatFeeDisclosure(e)).toBe("Platform fee 0.10% ($1.00) + Hyperliquid fee ~0.045% ($0.45)");
  });

  it("discloses zero platform fee honestly", () => {
    const e = estimateOrderFees({ notional: 1000, side: "buy", isMaker: false, builderFeeTenthsBp: 0 });
    expect(formatFeeDisclosure(e)).toBe("No platform fee + Hyperliquid fee ~0.045% ($0.45)");
  });

  it("round trip disclosure mentions both sides", () => {
    const rt = roundTripCost({ openNotional: 1000, openIsMaker: false, closeIsMaker: false, builderFeeTenthsBp: 100 });
    const s = formatRoundTripDisclosure(rt);
    expect(s).toContain("0.29%");
    expect(s).toContain("$2.90");
    expect(s).toContain("open and close");
  });
});

import { describe, expect, it } from "vitest";
import { baseUnit, checkSize, estimateLiquidation, estimateTicket, floorSize } from "../ui/orderMath.ts";

const btc = { coin: "BTC", displayName: "BTC", szDecimals: 5 };
const eur = { coin: "xyz:EUR", displayName: "EUR/USD", szDecimals: 1 };

describe("checkSize", () => {
  it("is silent while empty", () => {
    expect(checkSize("", btc, 100, false)).toEqual({ size: null, notional: null, error: null });
  });
  it("rejects zero, negative and garbage", () => {
    for (const v of ["0", "-1", "abc"]) expect(checkSize(v, btc, 100, false).error).toMatch(/greater than zero/);
  });
  it("enforces szDecimals", () => {
    expect(checkSize("0.123456", btc, 100_000, false).error).toMatch(/at most 5 decimals/);
    expect(checkSize("0.12345", btc, 100_000, false).error).toBeNull();
    expect(checkSize("1.25", eur, 100, false).error).toMatch(/at most 1 decimals/);
    expect(checkSize("2.5", { ...eur, szDecimals: 0 }, 100, false).error).toMatch(/whole units/);
  });
  it("enforces the $10 minimum except for reduce-only", () => {
    expect(checkSize("0.0001", btc, 76_000, false).error).toMatch(/Minimum order value is \$10/);
    expect(checkSize("0.0001", btc, 76_000, true).error).toBeNull();
    const ok = checkSize("0.001", btc, 76_000, false);
    expect(ok.error).toBeNull();
    expect(ok.notional).toBeCloseTo(76);
  });
  it("does not invent a minimum when the price is unknown", () => {
    expect(checkSize("0.0001", btc, null, false).error).toBeNull();
  });
});

describe("helpers", () => {
  it("floors size without float noise", () => {
    expect(floorSize(0.30000000000000004, 1)).toBe(0.3);
    expect(floorSize(1.999, 2)).toBe(1.99);
    expect(floorSize(0.00999, 2)).toBe(0);
  });
  it("derives the base unit", () => {
    expect(baseUnit(btc)).toBe("BTC");
    expect(baseUnit(eur)).toBe("EUR");
  });
});

describe("estimateLiquidation", () => {
  it("long is below entry, short above, for isolated", () => {
    const long = estimateLiquidation({ side: "BUY", entry: 100, leverage: 10, maxLeverage: 40, isCross: false });
    const short = estimateLiquidation({ side: "SELL", entry: 100, leverage: 10, maxLeverage: 40, isCross: false });
    // HL docs: liq = px - side * margin_avail / size / (1 - l * side), l = 1/(2*40)
    // distance = (1/10 - 1/80) / (1 -/+ 1/80)
    expect(long).toBeCloseTo(100 * (1 - 0.0875 / 0.9875), 6);
    expect(short).toBeCloseTo(100 * (1 + 0.0875 / 1.0125), 6);
  });
  it("is null for cross and for bad inputs", () => {
    expect(estimateLiquidation({ side: "BUY", entry: 100, leverage: 10, maxLeverage: 40, isCross: true })).toBeNull();
    expect(estimateLiquidation({ side: "BUY", entry: 0, leverage: 10, maxLeverage: 40, isCross: false })).toBeNull();
  });
  it("higher leverage liquidates closer to entry", () => {
    const a = estimateLiquidation({ side: "BUY", entry: 100, leverage: 5, maxLeverage: 40, isCross: false })!;
    const b = estimateLiquidation({ side: "BUY", entry: 100, leverage: 20, maxLeverage: 40, isCross: false })!;
    expect(b).toBeGreaterThan(a);
  });
});

describe("estimateTicket", () => {
  it("charges the platform fee on both legs of the round trip", () => {
    const t = estimateTicket({
      side: "BUY", size: 1, price: 1000, leverage: 10, maxLeverage: 40, isCross: false, isMaker: false, builderFeeTenthsBp: 100,
    });
    expect(t.notional).toBe(1000);
    expect(t.marginRequired).toBe(100);
    expect(t.fees.builderFee).toBeCloseTo(1);
    expect(t.roundTrip.builderFee).toBeCloseTo(2);
    expect(t.liquidationPx).not.toBeNull();
  });
  it("zero builder fee means no platform fee", () => {
    const t = estimateTicket({
      side: "SELL", size: 1, price: 1000, leverage: 1, maxLeverage: 3, isCross: true, isMaker: true, builderFeeTenthsBp: 0,
    });
    expect(t.fees.builderFee).toBe(0);
    expect(t.liquidationPx).toBeNull();
  });
});

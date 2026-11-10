import { describe, expect, it } from "vitest";
import { estimateOrderFees, hip3FeeMultiplier } from "../fees.ts";
import { classifyMarket, displayNameFor, buildMarket } from "../symbols.ts";
import { formatPrice } from "../ui/format.ts";
import { marketHoursNotice } from "../ui/marketHours.ts";
import { checkSize, estimateLiquidation, estimateTicket, marginTiersFrom } from "../ui/orderMath.ts";

const at = (iso: string) => new Date(`${iso}Z`);

describe("HIP-3 Hyperliquid fee multiplier (docs: scale<1 -> scale+1, else scale*2; growth mode x0.1)", () => {
  it("is 2x for a standard HIP-3 deployer scale of 1", () => {
    expect(hip3FeeMultiplier({ deployerFeeScale: 1 })).toBe(2);
    expect(hip3FeeMultiplier({})).toBe(2);
  });
  it("follows the documented formula for other scales", () => {
    expect(hip3FeeMultiplier({ deployerFeeScale: 0.5 })).toBe(1.5);
    expect(hip3FeeMultiplier({ deployerFeeScale: 3 })).toBe(6);
  });
  it("growth mode cuts protocol fees by 90%", () => {
    expect(hip3FeeMultiplier({ deployerFeeScale: 1, growthMode: true })).toBeCloseTo(0.2);
  });
  it("ignores garbage scales", () => {
    expect(hip3FeeMultiplier({ deployerFeeScale: Number.NaN })).toBe(2);
    expect(hip3FeeMultiplier({ deployerFeeScale: -1 })).toBe(2);
  });
  it("never multiplies a maker rebate", () => {
    const e = estimateOrderFees({
      notional: 1000,
      side: "buy",
      isMaker: true,
      builderFeeTenthsBp: 0,
      hlFeeRates: { taker: 0.00045, maker: -0.00001 },
      hlFeeMultiplier: 2,
    });
    expect(e.hlRate).toBeCloseTo(-0.00001);
  });
  it("estimateTicket applies the market multiplier to the HL part only", () => {
    const t = estimateTicket({
      side: "BUY",
      size: 1,
      price: 1000,
      leverage: 5,
      maxLeverage: 20,
      isCross: false,
      isMaker: false,
      builderFeeTenthsBp: 100,
      hlFeeMultiplier: 2,
    });
    expect(t.fees.hlFee).toBeCloseTo(0.9); // 1000 * 0.045% * 2
    expect(t.fees.builderFee).toBeCloseTo(1);
    expect(t.roundTrip.hlFee).toBeCloseTo(1.8);
  });
  it("buildMarket carries the deployer scale and growth flag from meta", () => {
    const m = buildMarket(
      { name: "xyz:TSLA", szDecimals: 3, maxLeverage: 20, deployerFeeScale: "1.0", growthMode: "enabled" },
      "xyz",
      1,
      1,
      "stocks",
    );
    expect(m.hlFeeMultiplier).toBeCloseTo(0.2);
    const core = buildMarket({ name: "BTC", szDecimals: 5, maxLeverage: 40 }, "", 0, 0, undefined);
    expect(core.hlFeeMultiplier).toBe(1);
    const plain = buildMarket({ name: "xyz:ABC", szDecimals: 1, maxLeverage: 10, deployerFeeScale: "1.0" }, "xyz", 1, 2, "stocks");
    expect(plain.hlFeeMultiplier).toBe(2);
  });
});

describe("isolated liquidation (docs: liq = px - side*margin_avail/size/(1 - l*side), l = 1/maintenance leverage)", () => {
  it("matches the documented formula, including the (1 - l*side) divisor", () => {
    // 10x on a 40x market: mmr = 1/80
    const long = estimateLiquidation({ side: "BUY", entry: 100, leverage: 10, maxLeverage: 40, isCross: false });
    const short = estimateLiquidation({ side: "SELL", entry: 100, leverage: 10, maxLeverage: 40, isCross: false });
    expect(long).toBeCloseTo(100 - 100 * (0.0875 / 0.9875), 6);
    expect(short).toBeCloseTo(100 + 100 * (0.0875 / 1.0125), 6);
  });
  it("uses the margin tier that applies at the position notional, with its maintenance deduction", () => {
    const tiers = marginTiersFrom([
      { lowerBound: "0.0", maxLeverage: 10 },
      { lowerBound: "3000000.0", maxLeverage: 5 },
    ]);
    // notional 4M, 5x: margin 800k; mmr2 = 0.1; deduction = 3M * (0.1 - 0.05) = 150k; mm = 250k
    const liq = estimateLiquidation({
      side: "BUY",
      entry: 100,
      leverage: 5,
      maxLeverage: 10,
      isCross: false,
      notional: 4_000_000,
      tiers,
    });
    expect(liq).toBeCloseTo(100 - (550_000 / 40_000) / 0.9, 4);
  });
  it("returns null when the leverage is above what the notional's tier allows", () => {
    const tiers = marginTiersFrom([
      { lowerBound: "0.0", maxLeverage: 10 },
      { lowerBound: "3000000.0", maxLeverage: 5 },
    ]);
    expect(
      estimateLiquidation({ side: "BUY", entry: 100, leverage: 10, maxLeverage: 10, isCross: false, notional: 4_000_000, tiers }),
    ).toBeNull();
  });
  it("is null for cross and for max-leverage positions with no cushion", () => {
    expect(estimateLiquidation({ side: "BUY", entry: 100, leverage: 10, maxLeverage: 10, isCross: true })).toBeNull();
  });
});

describe("checkSize hardening", () => {
  const btc = { coin: "BTC", displayName: "BTC", szDecimals: 5 };
  it("rejects exponent / hex spellings instead of silently accepting them", () => {
    for (const v of ["1e-3", "0x10", "1e3", "1_0"]) {
      expect(checkSize(v, btc, 100_000, false).error).toBeTruthy();
    }
  });
  it("accepts ordinary decimals, including a leading dot", () => {
    expect(checkSize(".5", btc, 100_000, false).error).toBeNull();
    expect(checkSize("5.", btc, 100_000, false).error).toBeNull();
  });
  it("does not trip the $10 floor on float noise", () => {
    expect(checkSize("3", btc, 3.333333333333333, false).error).toBeNull();
  });
});

describe("formatPrice (display)", () => {
  it("keeps tiny prices readable", () => {
    expect(formatPrice(0.0064)).toBe("0.0064");
    expect(formatPrice(0.005275)).toBe("0.005275");
    expect(formatPrice(0.0000123456)).toBe("0.0000123456");
  });
  it("keeps FX and equity precision", () => {
    expect(formatPrice(1.117)).toBe("1.117");
    expect(formatPrice(1.1)).toBe("1.10");
    expect(formatPrice(158.685)).toBe("158.685");
    expect(formatPrice(4033.15)).toBe("4,033.15");
  });
  it("does not add fake decimals to big prices", () => {
    expect(formatPrice(73810)).toBe("73,810");
    expect(formatPrice(100000)).toBe("100,000");
    expect(formatPrice(1234567.8)).toBe("1,234,568");
  });
  it("shows a dash for non-finite or non-positive input", () => {
    for (const v of [Number.NaN, Infinity, -Infinity, undefined, null, 0, -1]) {
      expect(formatPrice(v as number)).toBe("--");
    }
  });
});

describe("marketHours is New York DST aware", () => {
  // 2026-11-09 Monday, EST (UTC-5): regular session 14:30-21:00 UTC.
  it("winter: 13:30 UTC is still pre-market, 20:30 UTC is still open", () => {
    expect(marketHoursNotice("Stocks", at("2026-11-09T13:30:00"))?.reason).toBe("outside-session");
    expect(marketHoursNotice("Stocks", at("2026-11-09T14:30:00"))).toBeNull();
    expect(marketHoursNotice("Stocks", at("2026-11-09T20:30:00"))).toBeNull();
    expect(marketHoursNotice("Stocks", at("2026-11-09T21:00:00"))?.reason).toBe("outside-session");
  });
  // 2026-07-13 Monday, EDT (UTC-4): 13:30-20:00 UTC.
  it("summer: 13:30-20:00 UTC", () => {
    expect(marketHoursNotice("Stocks", at("2026-07-13T13:29:00"))?.reason).toBe("outside-session");
    expect(marketHoursNotice("Stocks", at("2026-07-13T13:30:00"))).toBeNull();
    expect(marketHoursNotice("Stocks", at("2026-07-13T19:59:00"))).toBeNull();
    expect(marketHoursNotice("Stocks", at("2026-07-13T20:00:00"))?.reason).toBe("outside-session");
  });
  it("flips on the right day: Sunday 2026-11-01 ends DST, Sunday 2026-03-08 starts it", () => {
    // Fri 2026-10-30 still EDT; Mon 2026-11-02 is EST.
    expect(marketHoursNotice("Stocks", at("2026-10-30T13:30:00"))).toBeNull();
    expect(marketHoursNotice("Stocks", at("2026-11-02T13:30:00"))?.reason).toBe("outside-session");
    // Fri 2026-03-06 EST; Mon 2026-03-09 EDT.
    expect(marketHoursNotice("Stocks", at("2026-03-06T13:30:00"))?.reason).toBe("outside-session");
    expect(marketHoursNotice("Stocks", at("2026-03-09T13:30:00"))).toBeNull();
  });
  it("forex weekend follows 17:00 New York (Fri close, Sun reopen)", () => {
    // winter: 22:00 UTC
    expect(marketHoursNotice("Forex", at("2026-11-13T21:59:00"))).toBeNull();
    expect(marketHoursNotice("Forex", at("2026-11-13T22:00:00"))?.reason).toBe("weekend");
    expect(marketHoursNotice("Forex", at("2026-11-15T21:59:00"))?.reason).toBe("weekend");
    expect(marketHoursNotice("Forex", at("2026-11-15T22:00:00"))).toBeNull();
    // summer: 21:00 UTC
    expect(marketHoursNotice("Forex", at("2026-07-10T20:59:00"))).toBeNull();
    expect(marketHoursNotice("Forex", at("2026-07-10T21:00:00"))?.reason).toBe("weekend");
    expect(marketHoursNotice("Commodities", at("2026-07-12T20:59:00"))?.reason).toBe("weekend");
    expect(marketHoursNotice("Commodities", at("2026-07-12T21:00:00"))).toBeNull();
  });
  it("Saturday is always closed, Sunday morning too", () => {
    expect(marketHoursNotice("Forex", at("2026-11-14T00:00:00"))?.reason).toBe("weekend");
    expect(marketHoursNotice("Forex", at("2026-11-15T03:00:00"))?.reason).toBe("weekend");
  });
});

describe("classification fallbacks", () => {
  it("volatility indices are indices, not stocks", () => {
    expect(classifyMarket("mkts:BVIV", "mkts")).toBe("Indices");
  });
  it("Nokia (NOK) is not mistaken for the krone when the API gives no label", () => {
    expect(classifyMarket("io:NOK", "io")).toBe("Stocks");
  });
  it("friendly names for commodities that were shown as raw tickers", () => {
    expect(displayNameFor("xyz:HO", "xyz", "Commodities")).toBe("Heating Oil");
  });
  it("USD/JPY is quoted as USD/JPY (price ~158), EUR as EUR/USD (price ~1.1)", () => {
    expect(displayNameFor("xyz:JPY", "xyz", "Forex")).toBe("USD/JPY");
    expect(displayNameFor("xyz:EUR", "xyz", "Forex")).toBe("EUR/USD");
  });
});

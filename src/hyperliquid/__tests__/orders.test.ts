import { describe, expect, it } from "vitest";
import {
  builderField,
  closeWire,
  defaultLeverageFor,
  formatPx,
  formatSz,
  humanizeHlError,
  minSizeFor,
  newCloid,
  orderEventType,
  parseOrderResponse,
  planClose,
  planOrder,
  positionTpslWire,
  redactSecrets,
  slippagePx,
  TradeError,
  validateLeverage,
  validateTpSl,
  type HlPlaceOrderInput,
} from "../orders.ts";
import type { HlMarket } from "../types.ts";

const BUILDER = { b: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", f: 100 } as const;

const btc: HlMarket = {
  symbol: "BTC",
  coin: "BTC",
  dex: "",
  dexIndex: 0,
  indexInMeta: 0,
  assetId: 0,
  szDecimals: 5,
  maxLeverage: 40,
  onlyIsolated: false,
  category: "Crypto",
  displayName: "BTC",
};
const eur: HlMarket = {
  ...btc,
  symbol: "xyz:EUR",
  coin: "xyz:EUR",
  dex: "xyz",
  dexIndex: 1,
  assetId: 110_003,
  szDecimals: 1,
  maxLeverage: 10,
  onlyIsolated: true,
  category: "Forex",
  displayName: "EUR/USD",
};

const base = (over: Partial<HlPlaceOrderInput> = {}): HlPlaceOrderInput => ({
  accountId: "0xacc",
  symbol: "BTC",
  side: "BUY",
  type: "MARKET",
  quantity: 0.001,
  ...over,
});

describe("formatPx", () => {
  it("keeps at most 5 significant figures and 6 - szDecimals decimals", () => {
    expect(formatPx(65432.123, 5)).toBe("65432");
    expect(formatPx(1234.5678, 3)).toBe("1234.6");
    expect(formatPx(3456.789, 4)).toBe("3456.8");
    expect(formatPx(12.3456789, 2)).toBe("12.346");
    expect(formatPx(0.0012346, 0)).toBe("0.001235");
    expect(formatPx(0.000012345678, 0)).toBe("0.000012");
  });
  it("always allows integer prices, however many digits", () => {
    expect(formatPx(123456, 5)).toBe("123456");
    expect(formatPx(123456.7, 5)).toBe("123457");
    expect(formatPx(1_000_000, 2)).toBe("1000000");
  });
  it("strips trailing zeros", () => {
    expect(formatPx(2.5, 2)).toBe("2.5");
    expect(formatPx(100, 2)).toBe("100");
    expect(formatPx(1.1, 3)).toBe("1.1");
  });
  it("supports directional rounding", () => {
    expect(formatPx(100.123, 2, "up")).toBe("100.13");
    expect(formatPx(100.123, 2, "down")).toBe("100.12");
    expect(formatPx(100.127, 2, "nearest")).toBe("100.13");
    expect(formatPx(100.12, 2, "up")).toBe("100.12"); // already on the grid: no float drift
  });
  it("rejects non-positive and non-finite prices", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => formatPx(bad, 2)).toThrow(TradeError);
    }
  });
});

describe("formatSz", () => {
  it("rounds DOWN to szDecimals", () => {
    expect(formatSz(0.123456, 3)).toBe("0.123");
    expect(formatSz(1.9999, 2)).toBe("1.99");
    expect(formatSz(0.00099, 3)).toBe("0");
    expect(formatSz(5, 0)).toBe("5");
    expect(formatSz(5.9, 0)).toBe("5");
  });
  it("is robust to float noise", () => {
    expect(formatSz(0.29, 2)).toBe("0.29");
    expect(formatSz(0.3, 1)).toBe("0.3");
    expect(formatSz(1.1, 1)).toBe("1.1");
  });
  it("rejects negatives", () => {
    expect(() => formatSz(-1, 2)).toThrow(TradeError);
  });
});

describe("slippagePx / minSizeFor / newCloid", () => {
  it("pushes the price through the book in the aggressive direction", () => {
    expect(slippagePx(65000, true, 0.03, 5)).toBe("66950");
    expect(slippagePx(65000, false, 0.03, 5)).toBe("63050");
    expect(slippagePx(100, true, 0.03, 2)).toBe("103");
    expect(slippagePx(100, false, 0.03, 2)).toBe("97");
  });
  it("rounds buy up and sell down", () => {
    // 1.2345 * 1.03 = 1.271535 -> 5 sig figs / 4 decimals (szDecimals 2)
    expect(slippagePx(1.2345, true, 0.03, 2)).toBe("1.2716");
    expect(slippagePx(1.2345, false, 0.03, 2)).toBe("1.1974");
  });
  it("rejects absurd slippage", () => {
    expect(() => slippagePx(100, true, 0, 2)).toThrow(TradeError);
    expect(() => slippagePx(100, true, 0.9, 2)).toThrow(TradeError);
  });
  it("computes the smallest size that clears $10", () => {
    expect(minSizeFor(65000, 5)).toBe(0.00016);
    expect(minSizeFor(2, 0)).toBe(5);
  });
  it("generates 16-byte hex client order ids", () => {
    const a = newCloid();
    expect(a).toMatch(/^0x[0-9a-f]{32}$/);
    expect(newCloid()).not.toBe(a);
  });
});

describe("builderField", () => {
  it("omits the builder when none is configured or the fee is zero", () => {
    expect(builderField(undefined)).toEqual({});
    expect(builderField({ ...BUILDER, f: 0 })).toEqual({});
  });
  it("never lets f exceed the 100 (0.1%) perps cap", () => {
    expect(builderField({ ...BUILDER, f: 500 })).toEqual({ builder: { b: BUILDER.b, f: 100 } });
    expect(builderField({ ...BUILDER, f: 25 })).toEqual({ builder: { b: BUILDER.b, f: 25 } });
  });
});

describe("planOrder: entry types", () => {
  const ctx = { market: btc, mid: 65000, builder: BUILDER };

  it("MARKET becomes an Ioc limit at mid + slippage, with the builder on the action", () => {
    const plan = planOrder(base(), ctx);
    expect(plan.action).toEqual({
      orders: [{ a: 0, b: true, p: "66950", s: "0.001", r: false, t: { limit: { tif: "Ioc" } }, c: plan.cloid }],
      grouping: "na",
      builder: { b: BUILDER.b, f: 100 },
    });
    expect(plan.notional).toBeCloseTo(65);
  });

  it("MARKET sell prices below mid and honours a per-order slippage", () => {
    const plan = planOrder(base({ side: "SELL", slippage: 0.01 }), ctx);
    expect(plan.action.orders[0]).toMatchObject({ b: false, p: "64350" });
  });

  it("MARKET without a live price is refused", () => {
    expect(() => planOrder(base(), { ...ctx, mid: 0 })).toThrow(/live price/);
  });

  it("LIMIT is Gtc, or Alo when postOnly", () => {
    const gtc = planOrder(base({ type: "LIMIT", price: 64000.4 }), ctx);
    expect(gtc.action.orders[0]).toMatchObject({ p: "64000", t: { limit: { tif: "Gtc" } }, r: false });
    const alo = planOrder(base({ type: "LIMIT", price: 64000, postOnly: true }), ctx);
    expect(alo.action.orders[0]).toMatchObject({ t: { limit: { tif: "Alo" } } });
    expect(alo.action.builder).toEqual({ b: BUILDER.b, f: 100 });
  });

  it("LIMIT needs a price", () => {
    expect(() => planOrder(base({ type: "LIMIT" }), ctx)).toThrow(/price/);
  });

  it("STOP is a market trigger with tpsl 'sl' and a slippage worst-price", () => {
    const plan = planOrder(base({ type: "STOP", stopPrice: 66000 }), ctx);
    expect(plan.action.orders[0]).toMatchObject({
      b: true,
      p: "67980",
      t: { trigger: { isMarket: true, triggerPx: "66000", tpsl: "sl" } },
      r: false,
    });
    expect(plan.action.builder).toEqual({ b: BUILDER.b, f: 100 });
  });

  it("STOP_LIMIT is a limit trigger priced at the limit", () => {
    const plan = planOrder(base({ type: "STOP_LIMIT", stopPrice: 66000, price: 66100, side: "SELL" }), ctx);
    expect(plan.action.orders[0]).toMatchObject({
      b: false,
      p: "66100",
      t: { trigger: { isMarket: false, triggerPx: "66000", tpsl: "sl" } },
    });
  });

  it("STOP / STOP_LIMIT need their prices", () => {
    expect(() => planOrder(base({ type: "STOP" }), ctx)).toThrow(/trigger/);
    expect(() => planOrder(base({ type: "STOP_LIMIT", stopPrice: 1 }), ctx)).toThrow(/limit price/);
  });

  it("uses the market's asset id (HIP-3 offset) and size grid", () => {
    const plan = planOrder(base({ symbol: "xyz:EUR", type: "LIMIT", price: 1.1, quantity: 100.78 }), {
      market: eur,
      mid: 1.1,
    });
    expect(plan.action.orders[0]).toMatchObject({ a: 110_003, s: "100.7", p: "1.1" });
  });

  it("omits builder entirely when not configured", () => {
    const plan = planOrder(base(), { market: btc, mid: 65000 });
    expect("builder" in plan.action).toBe(false);
  });

  it("clamps an over-cap builder fee on every order type", () => {
    const over = { ...BUILDER, f: 9999 };
    for (const input of [
      base(),
      base({ type: "LIMIT", price: 64000 }),
      base({ type: "STOP", stopPrice: 66000 }),
      base({ type: "MARKET", takeProfit: 70000, stopLoss: 60000 }),
    ]) {
      expect(planOrder(input, { market: btc, mid: 65000, builder: over }).action.builder?.f).toBe(100);
    }
  });
});

describe("planOrder: validation", () => {
  const ctx = { market: btc, mid: 65000, builder: BUILDER };

  it("rejects non-positive quantity", () => {
    expect(() => planOrder(base({ quantity: 0 }), ctx)).toThrow(/greater than zero/);
    expect(() => planOrder(base({ quantity: -1 }), ctx)).toThrow(TradeError);
  });

  it("rejects sizes that round to zero", () => {
    expect(() => planOrder(base({ quantity: 0.000001 }), ctx)).toThrow(/smallest increment/);
  });

  it("enforces the $10 minimum with a clear, actionable message", () => {
    try {
      planOrder(base({ quantity: 0.0001 }), ctx);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TradeError);
      const err = e as TradeError;
      expect(err.code).toBe("min_notional");
      expect(err.message).toContain("$10");
      expect(err.message).toContain("0.00016");
    }
  });

  it("accepts exactly the minimum and exempts reduce-only", () => {
    expect(() => planOrder(base({ quantity: 0.00016 }), ctx)).not.toThrow();
    const ro = planOrder(base({ quantity: 0.00001, reduceOnly: true }), ctx);
    expect(ro.action.orders[0]).toMatchObject({ r: true });
  });

  it("checks the minimum against the order's own price, not the mid", () => {
    expect(() => planOrder(base({ type: "LIMIT", price: 1000, quantity: 0.005 }), ctx)).toThrow(/minimum/);
  });

  it("refuses TP/SL on reduce-only orders", () => {
    expect(() => planOrder(base({ reduceOnly: true, takeProfit: 70000 }), ctx)).toThrow(/reduce-only/);
  });
});

describe("planOrder: TP/SL grouping", () => {
  const ctx = { market: btc, mid: 65000, builder: BUILDER };

  it("adds reduce-only opposite-side trigger children under normalTpsl", () => {
    const plan = planOrder(base({ takeProfit: 70000, stopLoss: 60000 }), ctx);
    expect(plan.action.grouping).toBe("normalTpsl");
    expect(plan.hasTpsl).toBe(true);
    expect(plan.action.orders).toHaveLength(3);
    const [entry, tp, sl] = plan.action.orders;
    expect(entry).toMatchObject({ b: true, r: false });
    expect(tp).toMatchObject({
      b: false,
      r: true,
      s: "0.001",
      p: "67900",
      t: { trigger: { isMarket: true, triggerPx: "70000", tpsl: "tp" } },
    });
    expect(sl).toMatchObject({
      b: false,
      r: true,
      p: "58200",
      t: { trigger: { isMarket: true, triggerPx: "60000", tpsl: "sl" } },
    });
    expect(plan.action.builder).toEqual({ b: BUILDER.b, f: 100 });
  });

  it("works with only one leg and with a short", () => {
    const only = planOrder(base({ stopLoss: 60000 }), ctx);
    expect(only.action.orders).toHaveLength(2);
    const short = planOrder(base({ side: "SELL", takeProfit: 60000, stopLoss: 70000 }), ctx);
    expect(short.action.orders[1]).toMatchObject({ b: true, p: "61800" });
    expect(short.action.orders[2]).toMatchObject({ b: true, p: "72100" });
  });

  it("applies to limit and stop entries too, carrying the builder", () => {
    const limit = planOrder(base({ type: "LIMIT", price: 64000, takeProfit: 70000, stopLoss: 60000 }), ctx);
    expect(limit.action.grouping).toBe("normalTpsl");
    expect(limit.action.builder).toEqual({ b: BUILDER.b, f: 100 });
    const stop = planOrder(base({ type: "STOP", stopPrice: 66000, takeProfit: 70000 }), ctx);
    expect(stop.action.grouping).toBe("normalTpsl");
    expect(stop.action.builder).toEqual({ b: BUILDER.b, f: 100 });
  });

  it("validates TP/SL against the entry price", () => {
    expect(() => planOrder(base({ takeProfit: 64000 }), ctx)).toThrow(/Take profit must be above/);
    expect(() => planOrder(base({ stopLoss: 66000 }), ctx)).toThrow(/Stop loss must be below/);
    expect(() => planOrder(base({ side: "SELL", takeProfit: 66000 }), ctx)).toThrow(/below/);
    expect(() => planOrder(base({ side: "SELL", stopLoss: 64000 }), ctx)).toThrow(/above/);
  });

  it("validateTpSl treats null as 'no leg'", () => {
    expect(() => validateTpSl(true, 100, null, null)).not.toThrow();
  });
});

describe("closeWire / planClose", () => {
  it("closes a long with a reduce-only Ioc sell below mid, builder on the action", () => {
    const plan = planClose({ market: btc, mid: 65000, szi: 0.5, builder: BUILDER });
    expect(plan.action).toEqual({
      orders: [{ a: 0, b: false, p: "63050", s: "0.5", r: true, t: { limit: { tif: "Ioc" } }, c: plan.cloid }],
      grouping: "na",
      builder: { b: BUILDER.b, f: 100 },
    });
  });

  it("closes a short by buying above mid", () => {
    const { wire } = closeWire({ market: btc, mid: 65000, szi: -0.25 });
    expect(wire).toMatchObject({ b: true, p: "66950", s: "0.25", r: true });
  });

  it("handles partial closes, clamped to the position and rounded down", () => {
    expect(closeWire({ market: btc, mid: 65000, szi: 1, quantity: 0.123456789 }).size).toBe("0.12345");
    expect(closeWire({ market: btc, mid: 65000, szi: 1, quantity: 5 }).size).toBe("1");
  });

  it("refuses when there's nothing to close or no price", () => {
    expect(() => closeWire({ market: btc, mid: 65000, szi: 0 })).toThrow(/no open/);
    expect(() => closeWire({ market: btc, mid: 0, szi: 1 })).toThrow(/live price/);
    expect(() => closeWire({ market: btc, mid: 65000, szi: 1, quantity: 0 })).toThrow(TradeError);
  });
});

describe("positionTpslWire", () => {
  it("builds a reduce-only trigger on the exit side", () => {
    expect(positionTpslWire(btc, 0.5, "tp", 70000)).toMatchObject({
      b: false,
      r: true,
      s: "0.5",
      t: { trigger: { isMarket: true, triggerPx: "70000", tpsl: "tp" } },
    });
    expect(positionTpslWire(btc, -0.5, "sl", 70000)).toMatchObject({ b: true, p: "72100" });
  });
});

describe("leverage helpers", () => {
  it("validates leverage and margin mode", () => {
    expect(() => validateLeverage(btc, 10, true)).not.toThrow();
    expect(() => validateLeverage(btc, 0, true)).toThrow(/at least 1x/);
    expect(() => validateLeverage(btc, 2.5, true)).toThrow(/whole number/);
    expect(() => validateLeverage(btc, 50, true)).toThrow(/at most 40x/);
    expect(() => validateLeverage(eur, 5, true)).toThrow(/isolated margin/);
    expect(() => validateLeverage(eur, 5, false)).not.toThrow();
  });
  it("defaults to min(max, 5)x, cross unless isolated-only", () => {
    expect(defaultLeverageFor(btc, { defaultLeverage: 5, preferCross: true })).toEqual({ leverage: 5, isCross: true });
    expect(defaultLeverageFor(eur, { defaultLeverage: 20, preferCross: true })).toEqual({ leverage: 10, isCross: false });
    expect(defaultLeverageFor(btc, { defaultLeverage: 5, preferCross: false })).toEqual({ leverage: 5, isCross: false });
  });
});

describe("parseOrderResponse", () => {
  const ok = (statuses: unknown[]) => ({ status: "ok", response: { type: "order", data: { statuses } } });

  it("parses resting, filled and waiting statuses", () => {
    const { statuses } = parseOrderResponse(
      ok([
        { resting: { oid: 1, cloid: "0xaa" } },
        { filled: { oid: 2, totalSz: "0.5", avgPx: "65010.5" } },
        "waitingForTrigger",
        "waitingForFill",
      ]),
    );
    expect(statuses).toEqual([
      { kind: "resting", oid: 1, cloid: "0xaa" },
      { kind: "filled", oid: 2, totalSz: 0.5, avgPx: 65010.5 },
      { kind: "waiting", reason: "trigger" },
      { kind: "waiting", reason: "fill" },
    ]);
  });

  it("humanises per-order errors", () => {
    const { statuses } = parseOrderResponse(ok([{ error: "Insufficient margin to place order. asset=0" }]));
    expect(statuses[0]).toMatchObject({ kind: "error" });
    expect((statuses[0] as { message: string }).message).toMatch(/Not enough margin/);
  });

  it("handles a top-level rejection and garbage", () => {
    expect(parseOrderResponse({ status: "err", response: "User or API Wallet 0xabc does not exist." }).error).toMatch(/no longer authorised/);
    expect(parseOrderResponse(null).error).toBeDefined();
    expect(parseOrderResponse({ status: "ok", response: { type: "default" } }).statuses).toEqual([]);
    expect(parseOrderResponse(ok([42])).statuses[0]).toMatchObject({ kind: "error" });
  });
});

describe("humanizeHlError", () => {
  const cases: Array<[string, RegExp]> = [
    ["Insufficient margin to place order. asset=0", /Not enough margin/],
    ["Order must have minimum value of $10. asset=0", /\$10 minimum/],
    ["Reduce only order would increase position. asset=0", /Reduce-only/],
    ["Order price cannot be more than 80% away from the reference price", /too far from the market/],
    ["Price too far from oracle", /too far from the market/],
    ["Order could not immediately match against any resting orders. asset=0", /No liquidity/],
    ["Post only order would have immediately matched, bbo was 64000@64001. asset=0", /Post-only/],
    ["Order has invalid price.", /tick size/],
    ["Order has zero size.", /size isn't valid/],
    ["Too many cumulative requests sent (1000 > 900) for cumulative volume traded $100", /rate-limiting/],
    ["User or API Wallet 0x1234 does not exist.", /no longer authorised/],
    ["Builder fee has not been approved.", /fee hasn't been approved/],
    ["Cannot place more than 1000 open orders", /too many open orders/i],
    ["Order was never placed, already canceled, or filled.", /already filled or cancelled/],
    ["Invalid TP/SL price.", /trigger price/],
    ["Insufficient spot balance asset=1", /Insufficient balance/],
  ];
  for (const [raw, expected] of cases) {
    it(`maps "${raw.slice(0, 48)}"`, () => {
      expect(humanizeHlError(raw)).toMatch(expected);
    });
  }

  it("passes unknown errors through, prefixed and bounded", () => {
    const msg = humanizeHlError("Some brand new failure " + "x".repeat(500));
    expect(msg.startsWith("Hyperliquid rejected the order: Some brand new failure")).toBe(true);
    expect(msg.length).toBeLessThan(260);
    expect(humanizeHlError("")).toBe("Hyperliquid rejected the order.");
  });

  it("never leaks signature/key-looking hex", () => {
    const sig = "0x" + "ab".repeat(65);
    expect(redactSecrets(`bad sig ${sig}`)).toBe("bad sig [redacted]");
    expect(humanizeHlError(`weird ${sig}`)).not.toContain("abab");
  });
});

describe("orderEventType", () => {
  it("maps order-status strings to terminal events", () => {
    expect(orderEventType("open")).toBe("order.placed");
    expect(orderEventType("filled")).toBe("order.filled");
    expect(orderEventType("canceled")).toBe("order.canceled");
    expect(orderEventType("marginCanceled")).toBe("order.canceled");
    expect(orderEventType("siblingFilledCanceled")).toBe("order.canceled");
    expect(orderEventType("scheduledCancel")).toBe("order.canceled");
    expect(orderEventType("rejected")).toBe("order.rejected");
    expect(orderEventType("minTradeNtlRejected")).toBe("order.rejected");
    expect(orderEventType("triggered")).toBeNull();
    expect(orderEventType("somethingNew")).toBeNull();
  });
});

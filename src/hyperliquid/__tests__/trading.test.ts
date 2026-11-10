import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalAccount } from "viem";
import type { TradingEvent } from "../../adapter/types.ts";
import { getBuilderParam } from "../config.ts";
import { createHyperliquidTrading, type HyperliquidTrading } from "../trading.ts";
import { ExchangeRunner, type ExchangeApi, type HlInfoApi, type HlStreams } from "../exchange.ts";
import { TradeError } from "../orders.ts";
import { hlSession } from "../session.ts";
import type { HlMarket, MarketRegistry } from "../types.ts";

vi.mock("../config.ts", async (orig) => ({
  ...(await orig<typeof import("../config.ts")>()),
  getBuilderParam: vi.fn(),
}));

const ADDR = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";
const BUILDER = { b: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", f: 100 } as const;

class ApiRequestError extends Error {
  response: unknown;
  constructor(response: unknown, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.response = response;
  }
}
class HttpRequestError extends Error {
  response?: { status: number };
  constructor(status?: number) {
    super(status ? `${status} Error` : "fetch failed");
    this.name = "HttpRequestError";
    if (status) this.response = { status };
  }
}

const market = (symbol: string, over: Partial<HlMarket> = {}): HlMarket => ({
  symbol,
  coin: symbol,
  dex: "",
  dexIndex: 0,
  indexInMeta: 0,
  assetId: 0,
  szDecimals: 5,
  maxLeverage: 40,
  onlyIsolated: false,
  category: "Crypto",
  displayName: symbol,
  ...over,
});
const MARKETS: HlMarket[] = [
  market("BTC"),
  market("ETH", { assetId: 1, szDecimals: 4, maxLeverage: 25 }),
  market("xyz:EUR", { dex: "xyz", dexIndex: 1, assetId: 110_003, szDecimals: 1, maxLeverage: 10, onlyIsolated: true }),
];
const registry: MarketRegistry = {
  load: async () => undefined,
  markets: () => MARKETS,
  bySymbol: (s) => MARKETS.find((m) => m.symbol === s),
};

const okOrder = (statuses: unknown[]) => ({ status: "ok", response: { type: "order", data: { statuses } } });
const filled = (oid = 100, totalSz = "0.001", avgPx = "65010") => ({ filled: { oid, totalSz, avgPx } });

interface PosSpec {
  coin: string;
  szi: string;
  entryPx?: string;
  upnl?: string;
}
function chs(positions: PosSpec[] = [], accountValue = 1000) {
  const s = { accountValue: String(accountValue), totalNtlPos: "0", totalRawUsd: "0", totalMarginUsed: "0" };
  return {
    marginSummary: s,
    crossMarginSummary: s,
    crossMaintenanceMarginUsed: "0",
    withdrawable: String(accountValue),
    assetPositions: positions.map((p) => ({
      type: "oneWay",
      position: {
        coin: p.coin,
        szi: p.szi,
        leverage: { type: "cross", value: 5 },
        entryPx: p.entryPx ?? "60000",
        positionValue: "0",
        unrealizedPnl: p.upnl ?? "0",
        returnOnEquity: "0",
        liquidationPx: null,
        marginUsed: "10",
        maxLeverage: 40,
        cumFunding: { allTime: "0", sinceOpen: "0", sinceChange: "0" },
      },
    })),
    time: 0,
  };
}

function openOrd(over: Record<string, unknown>) {
  return {
    coin: "BTC",
    side: "B",
    limitPx: "64000",
    sz: "0.5",
    oid: 1,
    timestamp: 1_700_000_000_000,
    origSz: "0.5",
    triggerCondition: "N/A",
    isTrigger: false,
    triggerPx: "0",
    children: [],
    isPositionTpsl: false,
    reduceOnly: false,
    orderType: "Limit",
    tif: "Gtc",
    cloid: null,
    ...over,
  };
}

interface World {
  /** Per-dex clearinghouse positions; mutate to simulate fills. */
  positions: Record<string, PosSpec[]>;
  openOrders: Record<string, unknown[]>;
  leverage: { type: "cross" | "isolated"; value: number };
}

function makeEnv(overrides: { exchange?: Partial<Record<keyof ExchangeApi, unknown>> } = {}) {
  const world: World = { positions: {}, openOrders: {}, leverage: { type: "cross", value: 40 } };
  const defaults = {
    order: vi.fn(async (_action: unknown) => okOrder([filled()])),
    modify: vi.fn(async () => ({ status: "ok", response: { type: "default" } })),
    cancel: vi.fn(async () => ({ status: "ok", response: { type: "cancel", data: { statuses: ["success"] } } })),
    cancelByCloid: vi.fn(async () => ({ status: "ok", response: { type: "cancel", data: { statuses: ["success"] } } })),
    updateLeverage: vi.fn(async () => ({ status: "ok", response: { type: "default" } })),
  };
  const exchange = { ...defaults, ...(overrides.exchange as Partial<typeof defaults> | undefined) };
  const info = {
    allMids: vi.fn(async (p?: { dex?: string }) =>
      p?.dex === "xyz" ? { "xyz:EUR": "1.1" } : { BTC: "65000", ETH: "3000" },
    ),
    l2Book: vi.fn(),
    clearinghouseState: vi.fn(async (p: { dex?: string }) => chs(world.positions[p.dex ?? ""] ?? [])),
    frontendOpenOrders: vi.fn(async (p: { dex?: string }) => world.openOrders[p.dex ?? ""] ?? []),
    orderStatus: vi.fn(async () => ({ status: "unknownOid" })),
    userFills: vi.fn(async () => []),
    activeAssetData: vi.fn(async () => ({ leverage: world.leverage })),
  };
  const exchangeFactory = vi.fn(() => exchange as unknown as ExchangeApi);
  const make = (extra: Partial<Parameters<typeof createHyperliquidTrading>[0]> = {}): HyperliquidTrading =>
    createHyperliquidTrading({
      registry,
      info: info as unknown as HlInfoApi,
      exchangeFactory,
      getBuilder: () => BUILDER,
      runner: new ExchangeRunner({ sleep: async () => undefined }),
      sleep: async () => undefined,
      ...extra,
    });
  return { world, exchange, info, exchangeFactory, make };
}

function setSession(over: Record<string, unknown> = {}) {
  hlSession.setState({
    network: "mainnet",
    address: ADDR,
    agent: { address: AGENT, account: { address: AGENT } as unknown as LocalAccount, validUntil: Date.now() + 1e9 },
    status: "ready",
    ...over,
  });
}

beforeEach(() => setSession());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  hlSession.setState({ address: null, agent: null, status: "disconnected" });
});

const input = (over: Record<string, unknown> = {}) => ({
  accountId: ADDR,
  symbol: "BTC",
  side: "BUY" as const,
  type: "MARKET" as const,
  quantity: 0.001,
  ...over,
});

describe("placeOrder", () => {
  it("market order: signs with the AGENT account, sets default leverage first, builder on the action", async () => {
    const { exchange, exchangeFactory, make } = makeEnv();
    const t = make();
    const order = await t.placeOrder(input());

    const [wallet, network] = exchangeFactory.mock.calls[0] as unknown as [LocalAccount, string];
    expect(wallet.address).toBe(AGENT);
    expect(network).toBe("mainnet");

    expect(exchange.updateLeverage).toHaveBeenCalledWith({ asset: 0, isCross: true, leverage: 5 });
    expect(exchange.updateLeverage.mock.invocationCallOrder[0]).toBeLessThan(exchange.order.mock.invocationCallOrder[0] ?? 0);

    const action = (exchange.order.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(action.builder).toEqual({ b: BUILDER.b, f: 100 });
    expect(action.grouping).toBe("na");
    expect(action).not.toHaveProperty("vaultAddress");
    expect((action.orders as Array<Record<string, unknown>>)[0]).toMatchObject({ a: 0, b: true, p: "66950", s: "0.001", r: false, t: { limit: { tif: "Ioc" } } });

    expect(order).toMatchObject({ id: "100", status: "FILLED", filledQuantity: 0.001, avgFillPrice: 65010, symbolName: "BTC", side: "BUY", type: "MARKET" });
    expect(exchange.cancel).not.toHaveBeenCalled();
  });

  it("puts the builder on market, limit, stop, stop-limit and TP/SL actions (and nothing else)", async () => {
    const { exchange, make } = makeEnv({ exchange: { order: vi.fn(async () => okOrder([{ resting: { oid: 7 } }, { resting: { oid: 8 } }, { resting: { oid: 9 } }])) } });
    const t = make();
    const variants = [
      input(),
      input({ type: "LIMIT", price: 64000 }),
      input({ type: "STOP", stopPrice: 66000 }),
      input({ type: "STOP_LIMIT", stopPrice: 66000, price: 66100 }),
      input({ type: "LIMIT", price: 64000.5, takeProfit: 70000, stopLoss: 60000 }),
      input({ type: "MARKET", side: "SELL", takeProfit: 60000, stopLoss: 70000 }),
    ];
    for (const v of variants) await t.placeOrder(v);
    expect(exchange.order).toHaveBeenCalledTimes(variants.length);
    for (const call of exchange.order.mock.calls) {
      const action = (call as unknown[])[0] as { builder?: { b: string; f: number } };
      expect(action.builder).toEqual({ b: BUILDER.b, f: 100 });
    }
    const tpsl = (exchange.order.mock.calls[4] as unknown[])[0] as { grouping: string; orders: unknown[] };
    expect(tpsl.grouping).toBe("normalTpsl");
    expect(tpsl.orders).toHaveLength(3);
    // cancel / modify / leverage actions carry no builder
    await t.cancelOrder("7");
    const cancelArg = (exchange.cancel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(cancelArg).not.toHaveProperty("builder");
  });

  it("uses the configured builder (env) by default and never exceeds f=100", async () => {
    vi.mocked(getBuilderParam).mockReturnValue({ b: BUILDER.b, f: 5000 });
    const { exchange, make } = makeEnv();
    const t = make({ getBuilder: undefined });
    await t.placeOrder(input());
    const action = (exchange.order.mock.calls[0] as unknown[])[0] as { builder: { b: string; f: number } };
    expect(action.builder).toEqual({ b: BUILDER.b, f: 100 });
  });

  it("sends no builder when none is configured", async () => {
    const { exchange, make } = makeEnv();
    await make({ getBuilder: () => undefined }).placeOrder(input());
    expect((exchange.order.mock.calls[0] as unknown[])[0]).not.toHaveProperty("builder");
  });

  it("returns a pending order for a resting limit and remembers its market for cancels", async () => {
    const { exchange, info, make } = makeEnv({ exchange: { order: vi.fn(async () => okOrder([{ resting: { oid: 55 } }])) } });
    const t = make();
    const order = await t.placeOrder(input({ type: "LIMIT", price: 64000 }));
    expect(order).toMatchObject({ id: "55", status: "PENDING", price: 64000, filledQuantity: 0, avgFillPrice: null, type: "LIMIT" });
    await t.cancelOrder("55");
    expect(info.orderStatus).not.toHaveBeenCalled();
    expect(exchange.cancel).toHaveBeenCalledWith({ cancels: [{ a: 0, o: 55 }] });
  });

  it("maps STOP_LIMIT to the schema's STOP type", async () => {
    const { make } = makeEnv({ exchange: { order: vi.fn(async () => okOrder([{ resting: { oid: 3 } }])) } });
    const order = await make().placeOrder(input({ type: "STOP_LIMIT", stopPrice: 66000, price: 66100 }));
    expect(order).toMatchObject({ type: "STOP", price: 66100, stopPrice: 66000 });
  });

  it("rejects below-minimum orders before any network write", async () => {
    const { exchange, make } = makeEnv();
    await expect(make().placeOrder(input({ quantity: 0.0001 }))).rejects.toMatchObject({ code: "min_notional" });
    expect(exchange.order).not.toHaveBeenCalled();
    expect(exchange.updateLeverage).not.toHaveBeenCalled();
  });

  it("rejects unknown markets and a not-ready session without calling the exchange", async () => {
    const { exchange, make } = makeEnv();
    await expect(make().placeOrder(input({ symbol: "NOPE" }))).rejects.toMatchObject({ code: "unknown_market" });
    setSession({ status: "needs-agent", agent: null });
    await expect(make().placeOrder(input())).rejects.toMatchObject({ code: "not_ready" });
    expect(exchange.order).not.toHaveBeenCalled();
  });

  it("turns an exchange rejection into a human message", async () => {
    const rejection = new ApiRequestError(okOrder([{ error: "Insufficient margin to place order. asset=0" }]), "order 0: Insufficient margin");
    const { make } = makeEnv({ exchange: { order: vi.fn(async () => { throw rejection; }) } });
    const err = await make().placeOrder(input()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TradeError);
    expect((err as TradeError).message).toMatch(/Not enough margin/);
    expect((err as TradeError).code).toBe("exchange");
  });

  it("keeps a live entry when only the TP/SL child is refused, and says so", async () => {
    const partial = new ApiRequestError(okOrder([{ resting: { oid: 12 } }, { error: "Invalid TP/SL price." }]), "order 1: Invalid TP/SL price.");
    const { make } = makeEnv({ exchange: { order: vi.fn(async () => { throw partial; }) } });
    const order = await make().placeOrder(input({ type: "LIMIT", price: 64000, takeProfit: 70000 }));
    expect(order.id).toBe("12");
    expect(order.comment).toMatch(/not attached/);
  });

  it("surfaces a missing-liquidity IOC as a clear error", async () => {
    const rejection = new ApiRequestError(okOrder([{ error: "Order could not immediately match against any resting orders. asset=0" }]), "x");
    const { make } = makeEnv({ exchange: { order: vi.fn(async () => { throw rejection; }) } });
    await expect(make().placeOrder(input())).rejects.toThrow(/No liquidity/);
  });

  it("on a network error after sending, finds the order by cloid instead of resending", async () => {
    const { exchange, info, make } = makeEnv({ exchange: { order: vi.fn(async () => { throw new HttpRequestError(); }) } });
    info.orderStatus.mockResolvedValue({
      status: "order",
      order: { order: openOrd({ oid: 900, coin: "BTC" }), status: "open", statusTimestamp: 1 },
    } as never);
    const order = await make().placeOrder(input({ type: "LIMIT", price: 64000 }));
    expect(order).toMatchObject({ id: "900", status: "PENDING" });
    expect(exchange.order).toHaveBeenCalledTimes(1);
    const sentCloid = ((exchange.order.mock.calls[0] as unknown[])[0] as { orders: Array<{ c: string }> }).orders[0]?.c;
    expect((info.orderStatus.mock.calls[0] as unknown[])[0]).toEqual({ user: ADDR, oid: sentCloid });
  });

  it("reports 'unconfirmed' (never a blind retry) when the order can't be found afterwards", async () => {
    const { exchange, info, make } = makeEnv({ exchange: { order: vi.fn(async () => { throw new HttpRequestError(); }) } });
    const err = await make().placeOrder(input()).catch((e: unknown) => e);
    expect((err as TradeError).code).toBe("unconfirmed");
    expect((err as TradeError).message).toMatch(/most likely not placed/);
    expect(exchange.order).toHaveBeenCalledTimes(1);
    expect(info.orderStatus).toHaveBeenCalledTimes(3);
  });

  it("recovers a filled order found by cloid", async () => {
    const { info, make } = makeEnv({ exchange: { order: vi.fn(async () => { throw new HttpRequestError(502); }) } });
    info.orderStatus.mockResolvedValue({
      status: "order",
      order: { order: openOrd({ oid: 901, sz: "0", origSz: "0.001" }), status: "filled", statusTimestamp: 1 },
    } as never);
    const order = await make().placeOrder(input());
    expect(order).toMatchObject({ id: "901", status: "FILLED", filledQuantity: 0.001 });
  });

  it("retries rate-limit refusals transparently (safe: nothing was applied)", async () => {
    const order = vi.fn().mockRejectedValueOnce(new HttpRequestError(429)).mockResolvedValue(okOrder([filled()]));
    const { exchange, make } = makeEnv({ exchange: { order } });
    await make().placeOrder(input());
    expect(exchange.order).toHaveBeenCalledTimes(2);
  });

  it("a double-click while in flight is one order, not two", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const order = vi.fn(async () => {
      await gate;
      return okOrder([filled()]);
    });
    const { exchange, make } = makeEnv({ exchange: { order } });
    const t = make();
    const a = t.placeOrder(input());
    const b = t.placeOrder(input());
    await vi.waitFor(() => expect(exchange.order).toHaveBeenCalled());
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(exchange.order).toHaveBeenCalledTimes(1);
    expect(rb).toBe(ra);
    // after completion the same order can be placed again
    await t.placeOrder(input());
    expect(exchange.order).toHaveBeenCalledTimes(2);
  });
});

describe("leverage", () => {
  it("defaults isolated-only markets to isolated at min(max, 5)x", async () => {
    const { world, exchange, make } = makeEnv();
    world.leverage = { type: "isolated", value: 10 }; // == market max -> untouched default
    await make().placeOrder(input({ symbol: "xyz:EUR", type: "LIMIT", price: 1.1, quantity: 100 }));
    expect(exchange.updateLeverage).toHaveBeenCalledWith({ asset: 110_003, isCross: false, leverage: 5 });
  });

  it("respects leverage the user already chose", async () => {
    const { world, exchange, make } = makeEnv();
    world.leverage = { type: "cross", value: 12 };
    await make().placeOrder(input());
    expect(exchange.updateLeverage).not.toHaveBeenCalled();
  });

  it("does not touch leverage under an open position", async () => {
    const { world, exchange, make } = makeEnv();
    world.positions[""] = [{ coin: "BTC", szi: "0.2" }];
    await make().placeOrder(input());
    expect(exchange.updateLeverage).not.toHaveBeenCalled();
  });

  it("configures a market once per session", async () => {
    const { exchange, make } = makeEnv();
    const t = make();
    await t.placeOrder(input());
    await t.placeOrder(input({ quantity: 0.002 }));
    expect(exchange.updateLeverage).toHaveBeenCalledTimes(1);
  });

  it("applies an explicit leverage on the order and validates it", async () => {
    const { exchange, make } = makeEnv();
    const t = make();
    await t.placeOrder(input({ leverage: 10, isCross: false }));
    expect(exchange.updateLeverage).toHaveBeenCalledWith({ asset: 0, isCross: false, leverage: 10 });
    await expect(t.placeOrder(input({ quantity: 0.002, leverage: 99 }))).rejects.toThrow(/at most 40x/);
  });

  it("a failed default-leverage update does not block the order", async () => {
    const { exchange, make } = makeEnv({ exchange: { updateLeverage: vi.fn(async () => { throw new ApiRequestError({}, "nope"); }) } });
    await expect(make().placeOrder(input())).resolves.toMatchObject({ status: "FILLED" });
    expect(exchange.order).toHaveBeenCalled();
  });

  it("setLeverage validates, sends, and suppresses the default afterwards", async () => {
    const { exchange, make } = makeEnv();
    const t = make();
    await expect(t.setLeverage("BTC", 0, true)).rejects.toThrow(/at least 1x/);
    await expect(t.setLeverage("xyz:EUR", 5, true)).rejects.toThrow(/isolated/);
    await expect(t.setLeverage("BTC", 41, true)).rejects.toThrow(/at most 40x/);
    expect(exchange.updateLeverage).not.toHaveBeenCalled();
    await t.setLeverage("BTC", 7, true);
    expect(exchange.updateLeverage).toHaveBeenCalledWith({ asset: 0, isCross: true, leverage: 7 });
    await t.placeOrder(input());
    expect(exchange.updateLeverage).toHaveBeenCalledTimes(1);
  });

  it("setLeverage surfaces exchange refusals in plain language", async () => {
    const { make } = makeEnv({ exchange: { updateLeverage: vi.fn(async () => { throw new ApiRequestError({}, "Leverage exceeds max leverage"); }) } });
    await expect(make().setLeverage("BTC", 10, true)).rejects.toThrow(/higher than this market allows/);
  });

  it("getLeverage reads activeAssetData for the main address", async () => {
    const { world, info, make } = makeEnv();
    world.leverage = { type: "isolated", value: 3 };
    await expect(make().getLeverage("BTC")).resolves.toEqual({ leverage: 3, isCross: false, maxLeverage: 40 });
    expect(info.activeAssetData).toHaveBeenCalledWith({ user: ADDR, coin: "BTC" });
  });
});

describe("closing", () => {
  it("closePosition: reduce-only Ioc opposite side at slippage, with builder", async () => {
    const { world, exchange, make } = makeEnv();
    world.positions[""] = [{ coin: "BTC", szi: "0.5" }];
    await make().closePosition("BTC");
    const action = (exchange.order.mock.calls[0] as unknown[])[0] as { orders: Array<Record<string, unknown>>; builder: unknown; grouping: string };
    expect(action.orders).toHaveLength(1);
    expect(action.orders[0]).toMatchObject({ a: 0, b: false, p: "63050", s: "0.5", r: true, t: { limit: { tif: "Ioc" } } });
    expect(action.builder).toEqual({ b: BUILDER.b, f: 100 });
    expect(action.grouping).toBe("na");
  });

  it("closePosition supports a partial quantity and shorts", async () => {
    const { world, exchange, make } = makeEnv();
    world.positions[""] = [{ coin: "ETH", szi: "-3" }];
    await make().closePosition("ETH", 1.23456);
    const wire = ((exchange.order.mock.calls[0] as unknown[])[0] as { orders: Array<Record<string, unknown>> }).orders[0];
    expect(wire).toMatchObject({ a: 1, b: true, s: "1.2345", r: true });
  });

  it("closePosition errors when flat and when the IOC finds no liquidity", async () => {
    const env = makeEnv();
    await expect(env.make().closePosition("BTC")).rejects.toThrow(/no open BTC position/);
    const rej = new ApiRequestError(okOrder([{ error: "Order could not immediately match against any resting orders." }]), "x");
    const env2 = makeEnv({ exchange: { order: vi.fn(async () => { throw rej; }) } });
    env2.world.positions[""] = [{ coin: "BTC", szi: "1" }];
    await expect(env2.make().closePosition("BTC")).rejects.toThrow(/BTC: No liquidity/);
  });

  it("closeAllPositions sends ONE batched action across dexes", async () => {
    const { world, exchange, make } = makeEnv({ exchange: { order: vi.fn(async () => okOrder([filled(1), filled(2), filled(3)])) } });
    world.positions[""] = [{ coin: "BTC", szi: "0.5" }, { coin: "ETH", szi: "-2" }];
    world.positions.xyz = [{ coin: "xyz:EUR", szi: "100" }];
    await make().closeAllPositions();
    expect(exchange.order).toHaveBeenCalledTimes(1);
    const action = (exchange.order.mock.calls[0] as unknown[])[0] as { orders: Array<Record<string, unknown>>; builder: unknown };
    expect(action.orders.map((o) => [o.a, o.b, o.r])).toEqual([[0, false, true], [1, true, true], [110_003, false, true]]);
    expect(action.builder).toEqual({ b: BUILDER.b, f: 100 });
  });

  it("closeAllPositions reports which coins failed", async () => {
    const rej = new ApiRequestError(okOrder([filled(1), { error: "Order could not immediately match against any resting orders." }]), "x");
    const { world, make } = makeEnv({ exchange: { order: vi.fn(async () => { throw rej; }) } });
    world.positions[""] = [{ coin: "BTC", szi: "0.5" }, { coin: "ETH", szi: "-2" }];
    await expect(make().closeAllPositions()).rejects.toThrow(/ETH: No liquidity/);
  });

  it("closeAllPositions is a no-op when flat", async () => {
    const { exchange, make } = makeEnv();
    await make().closeAllPositions();
    expect(exchange.order).not.toHaveBeenCalled();
  });
});

describe("cancel / modify", () => {
  it("cancelOrder looks the market up when the order wasn't placed here", async () => {
    const { exchange, info, make } = makeEnv();
    info.orderStatus.mockResolvedValue({
      status: "order",
      order: { order: openOrd({ oid: 123, coin: "ETH" }), status: "open", statusTimestamp: 1 },
    } as never);
    await make().cancelOrder("123");
    expect(info.orderStatus).toHaveBeenCalledWith({ user: ADDR, oid: 123 });
    expect(exchange.cancel).toHaveBeenCalledWith({ cancels: [{ a: 1, o: 123 }] });
  });

  it("cancelOrder is idempotent for already-gone orders", async () => {
    const { exchange, make } = makeEnv();
    await expect(make().cancelOrder("5")).resolves.toBeUndefined(); // unknownOid
    expect(exchange.cancel).not.toHaveBeenCalled();
    const gone = new ApiRequestError({}, "Order was never placed, already canceled, or filled.");
    const env = makeEnv({ exchange: { cancel: vi.fn(async () => { throw gone; }) } });
    env.info.orderStatus.mockResolvedValue({ status: "order", order: { order: openOrd({ oid: 5 }), status: "open", statusTimestamp: 1 } } as never);
    await expect(env.make().cancelOrder("5")).resolves.toBeUndefined();
  });

  it("cancelOrder supports client order ids", async () => {
    const { exchange, info, make } = makeEnv();
    const cloid = "0x" + "ab".repeat(16);
    info.orderStatus.mockResolvedValue({ status: "order", order: { order: openOrd({ oid: 9, coin: "BTC" }), status: "open", statusTimestamp: 1 } } as never);
    await make().cancelOrder(cloid);
    expect(exchange.cancelByCloid).toHaveBeenCalledWith({ cancels: [{ asset: 0, cloid }] });
  });

  it("cancelAllOrders cancels every dex's open orders in one action", async () => {
    const { world, exchange, make } = makeEnv();
    world.openOrders[""] = [openOrd({ oid: 1 }), openOrd({ oid: 2, coin: "ETH" })];
    world.openOrders.xyz = [openOrd({ oid: 3, coin: "xyz:EUR" })];
    await make().cancelAllOrders();
    expect(exchange.cancel).toHaveBeenCalledTimes(1);
    expect(exchange.cancel).toHaveBeenCalledWith({ cancels: [{ a: 0, o: 1 }, { a: 1, o: 2 }, { a: 110_003, o: 3 }] });
  });

  it("cancelAllOrders does nothing when there are none", async () => {
    const { exchange, make } = makeEnv();
    await make().cancelAllOrders();
    expect(exchange.cancel).not.toHaveBeenCalled();
  });

  describe("modifyOrder", () => {
    const resting = { status: "order", order: { order: openOrd({ oid: 30, side: "B", limitPx: "64000", sz: "0.5" }), status: "open", statusTimestamp: 1 } };

    it("modifies price and size in place via `modify` (no builder field exists on that action)", async () => {
      const { exchange, info, make } = makeEnv();
      info.orderStatus.mockResolvedValue(resting as never);
      const out = await make().modifyOrder("30", { price: 64500.4, quantity: 0.25 });
      expect(exchange.modify).toHaveBeenCalledTimes(1);
      const arg = (exchange.modify.mock.calls[0] as unknown[])[0] as { oid: number; order: Record<string, unknown> };
      expect(arg.oid).toBe(30);
      expect(arg.order).toMatchObject({ a: 0, b: true, p: "64500", s: "0.25", r: false, t: { limit: { tif: "Gtc" } } });
      expect(arg.order.c).toMatch(/^0x[0-9a-f]{32}$/);
      expect(arg).not.toHaveProperty("builder");
      expect(out.id).toBe("30");
    });

    it("preserves trigger type and reduce-only when moving a stop", async () => {
      const { exchange, info, make } = makeEnv();
      info.orderStatus.mockResolvedValue({
        status: "order",
        order: {
          order: openOrd({ oid: 31, side: "A", isTrigger: true, reduceOnly: true, orderType: "Stop Market", triggerPx: "60000", sz: "0.5" }),
          status: "open",
          statusTimestamp: 1,
        },
      } as never);
      await make().modifyOrder("31", { stopPrice: 61000 });
      const wire = ((exchange.modify.mock.calls[0] as unknown[])[0] as { order: Record<string, unknown> }).order;
      expect(wire).toMatchObject({ b: false, r: true, t: { trigger: { isMarket: true, triggerPx: "61000", tpsl: "sl" } } });
    });

    it("refuses closed orders and TP/SL edits on pending orders", async () => {
      const { exchange, info, make } = makeEnv();
      info.orderStatus.mockResolvedValue({ status: "order", order: { order: openOrd({ oid: 32 }), status: "filled", statusTimestamp: 1 } } as never);
      await expect(make().modifyOrder("32", { price: 1 })).rejects.toThrow(/no longer open/);
      await expect(make().modifyOrder("32", { takeProfit: 70000 })).rejects.toThrow(/open position/);
      expect(exchange.modify).not.toHaveBeenCalled();
    });
  });
});

describe("modifyPosition (TP/SL)", () => {
  const protect = () => [
    openOrd({ oid: 41, side: "A", isTrigger: true, reduceOnly: true, isPositionTpsl: true, orderType: "Take Profit Market", triggerPx: "70000" }),
    openOrd({ oid: 42, side: "A", isTrigger: true, reduceOnly: true, isPositionTpsl: true, orderType: "Stop Market", triggerPx: "60000" }),
  ];

  it("places positionTpsl triggers (with builder) BEFORE cancelling the replaced ones", async () => {
    const { world, exchange, make } = makeEnv({ exchange: { order: vi.fn(async () => okOrder([{ resting: { oid: 50 } }])) } });
    world.positions[""] = [{ coin: "BTC", szi: "0.5" }];
    world.openOrders[""] = protect();
    const pos = await make().modifyPosition("BTC", { takeProfit: 72000, stopLoss: null });

    const action = (exchange.order.mock.calls[0] as unknown[])[0] as { grouping: string; builder: unknown; orders: Array<Record<string, unknown>> };
    expect(action.grouping).toBe("positionTpsl");
    expect(action.builder).toEqual({ b: BUILDER.b, f: 100 });
    expect(action.orders).toHaveLength(1);
    expect(action.orders[0]).toMatchObject({ a: 0, b: false, r: true, s: "0.5", t: { trigger: { isMarket: true, triggerPx: "72000", tpsl: "tp" } } });

    expect(exchange.cancel).toHaveBeenCalledWith({ cancels: [{ a: 0, o: 41 }, { a: 0, o: 42 }] });
    expect(exchange.order.mock.invocationCallOrder[0]).toBeLessThan(exchange.cancel.mock.invocationCallOrder[0] ?? 0);
    expect(pos.id).toBe("BTC");
  });

  it("clearing a leg only cancels, and leaves untouched legs alone", async () => {
    const { world, exchange, make } = makeEnv();
    world.positions[""] = [{ coin: "BTC", szi: "0.5" }];
    world.openOrders[""] = protect();
    await make().modifyPosition("BTC", { stopLoss: null });
    expect(exchange.order).not.toHaveBeenCalled();
    expect(exchange.cancel).toHaveBeenCalledWith({ cancels: [{ a: 0, o: 42 }] });
  });

  it("does not cancel existing protection when the replacement is refused", async () => {
    const rej = new ApiRequestError(okOrder([{ error: "Invalid TP/SL price." }]), "x");
    const { world, exchange, make } = makeEnv({ exchange: { order: vi.fn(async () => { throw rej; }) } });
    world.positions[""] = [{ coin: "BTC", szi: "0.5" }];
    world.openOrders[""] = protect();
    await expect(make().modifyPosition("BTC", { takeProfit: 72000 })).rejects.toThrow();
    expect(exchange.cancel).not.toHaveBeenCalled();
  });

  it("validates sides against the current price and handles shorts", async () => {
    const { world, exchange, make } = makeEnv();
    world.positions[""] = [{ coin: "BTC", szi: "-0.5" }];
    await expect(make().modifyPosition("BTC", { takeProfit: 70000 })).rejects.toThrow(/below/);
    await make().modifyPosition("BTC", { takeProfit: 60000, stopLoss: 70000 }).catch(() => undefined);
    const wires = ((exchange.order.mock.calls[0] as unknown[])[0] as { orders: Array<Record<string, unknown>> }).orders;
    expect(wires.map((w) => w.b)).toEqual([true, true]); // shorts exit by buying
  });

  it("errors when there is no position", async () => {
    await expect(makeEnv().make().modifyPosition("BTC", { takeProfit: 1 })).rejects.toThrow(/no open BTC position/);
  });
});

describe("reads", () => {
  it("returns one synthetic account for the MAIN address (not the agent)", async () => {
    const { world, info, make } = makeEnv();
    world.positions[""] = [{ coin: "BTC", szi: "0.1", upnl: "50" }];
    const accounts = await make().getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: ADDR, phase: "LIVE", equity: 2000 });
    for (const call of info.clearinghouseState.mock.calls) {
      expect((call as unknown[])[0]).toMatchObject({ user: ADDR });
    }
  });

  it("returns empty lists when no wallet is connected", async () => {
    setSession({ address: null, agent: null, status: "disconnected" });
    const t = makeEnv().make();
    expect(await t.getAccounts()).toEqual([]);
    expect(await t.getPositions(ADDR)).toEqual([]);
    expect(await t.getOrders(ADDR)).toEqual([]);
    expect((await t.getClosedPositions(ADDR)).data).toEqual([]);
  });

  it("works for a connected wallet that isn't ready to trade yet", async () => {
    setSession({ status: "needs-builder-approval" });
    await expect(makeEnv().make().getAccounts()).resolves.toHaveLength(1);
  });
});

describe("subscribe", () => {
  function fakeStreams() {
    const cbs: {
      orders?: (e: unknown) => void;
      fills?: (e: unknown) => void;
      state?: (e: unknown) => void;
      reconnect?: () => void;
    } = {};
    const unsubscribe = vi.fn(async () => undefined);
    const streams = {
      orderUpdates: vi.fn(async (_u: string, cb: (e: unknown) => void) => {
        cbs.orders = cb;
        return { unsubscribe };
      }),
      userFills: vi.fn(async (_u: string, cb: (e: unknown) => void) => {
        cbs.fills = cb;
        return { unsubscribe };
      }),
      allDexsClearinghouseState: vi.fn(async (_u: string, cb: (e: unknown) => void) => {
        cbs.state = cb;
        return { unsubscribe };
      }),
      onReconnect: vi.fn((cb: () => void) => {
        cbs.reconnect = cb;
        return () => undefined;
      }),
      close: vi.fn(),
    };
    return { streams: streams as unknown as HlStreams, raw: streams, cbs, unsubscribe };
  }
  const update = (oid: number, status: string, extra: Record<string, unknown> = {}) => [
    { order: { coin: "BTC", side: "B", limitPx: "64000", sz: "0.5", oid, timestamp: 1_700_000_000_000, origSz: "0.5", ...extra }, status, statusTimestamp: 1 },
  ];

  it("emits order, position and account events from the websocket, deduped", async () => {
    const { streams, raw, cbs } = fakeStreams();
    const { make } = makeEnv();
    const t = make({ streamsFactory: () => streams });
    const events: TradingEvent[] = [];
    const off = t.subscribe((e) => events.push(e));
    await vi.waitFor(() => expect(raw.allDexsClearinghouseState).toHaveBeenCalled());
    expect(raw.orderUpdates).toHaveBeenCalledWith(ADDR, expect.any(Function));
    expect(events).toEqual([]); // seeding is silent

    cbs.orders?.(update(5, "open"));
    cbs.orders?.(update(5, "open")); // duplicate after a reconnect
    cbs.orders?.(update(5, "filled"));
    cbs.orders?.(update(6, "marginCanceled"));
    cbs.orders?.(update(7, "minTradeNtlRejected"));
    cbs.orders?.(update(8, "triggered")); // not an event
    expect(events.map((e) => [e.type, "orderId" in e ? e.orderId : ""])).toEqual([
      ["order.placed", "5"],
      ["order.filled", "5"],
      ["order.canceled", "6"],
      ["order.rejected", "7"],
    ]);
    expect((events[0] as { entity?: { status: string } }).entity?.status).toBe("PENDING");

    events.length = 0;
    const state = (positions: PosSpec[], equity: number) => ({ user: ADDR, clearinghouseStates: [["", chs(positions, equity)]] });
    cbs.state?.(state([{ coin: "BTC", szi: "0.1", upnl: "10" }], 1010));
    cbs.state?.(state([{ coin: "BTC", szi: "0.1", upnl: "20" }], 1020));
    cbs.state?.(state([{ coin: "BTC", szi: "0.1", upnl: "20" }], 1020)); // unchanged
    cbs.state?.(state([], 1020));
    expect(events.map((e) => e.type)).toEqual([
      "position.opened",
      "account.updated",
      "position.updated",
      "account.updated",
      "position.closed",
      "account.updated", // balance shifts once the position's unrealised PnL is realised
    ]);
    const opened = events[0] as { entity?: { side: string; quantity: number } };
    expect(opened.entity).toMatchObject({ side: "LONG", quantity: 0.1 });
    off();
  });

  it("unsubscribing stops delivery and tears the streams down", async () => {
    const { streams, raw, cbs, unsubscribe } = fakeStreams();
    const t = makeEnv().make({ streamsFactory: () => streams });
    const events: TradingEvent[] = [];
    const off = t.subscribe((e) => events.push(e));
    await vi.waitFor(() => expect(raw.allDexsClearinghouseState).toHaveBeenCalled());
    off();
    cbs.orders?.(update(1, "open"));
    expect(events).toEqual([]);
    expect(unsubscribe).toHaveBeenCalledTimes(3);
    expect(raw.close).toHaveBeenCalled();
  });

  it("dispose() ends everything even with live subscribers", async () => {
    const { streams, raw, cbs } = fakeStreams();
    const t = makeEnv().make({ streamsFactory: () => streams });
    const events: TradingEvent[] = [];
    t.subscribe((e) => events.push(e));
    await vi.waitFor(() => expect(raw.allDexsClearinghouseState).toHaveBeenCalled());
    t.dispose();
    cbs.orders?.(update(1, "open"));
    expect(events).toEqual([]);
    expect(raw.close).toHaveBeenCalled();
  });

  it("re-syncs after a reconnect so missed order events are recovered", async () => {
    const { streams, raw, cbs } = fakeStreams();
    const { world, make } = makeEnv();
    const t = make({ streamsFactory: () => streams });
    const events: TradingEvent[] = [];
    t.subscribe((e) => events.push(e));
    await vi.waitFor(() => expect(raw.onReconnect).toHaveBeenCalled());
    world.openOrders[""] = [openOrd({ oid: 77 })]; // appeared while the socket was down
    cbs.reconnect?.();
    await vi.waitFor(() => expect(events.some((e) => e.type === "order.placed")).toBe(true));
    expect(events.find((e) => e.type === "order.placed")).toMatchObject({ orderId: "77" });
  });

  it("falls back to REST polling when the websocket can't be created", async () => {
    vi.useFakeTimers();
    const { world, make } = makeEnv();
    const t = make({
      streamsFactory: () => {
        throw new Error("no websocket");
      },
      pollIntervalMs: 1000,
    });
    const events: TradingEvent[] = [];
    t.subscribe((e) => events.push(e));
    await vi.advanceTimersByTimeAsync(50); // seed
    world.positions[""] = [{ coin: "BTC", szi: "0.3" }];
    world.openOrders[""] = [openOrd({ oid: 8 })];
    await vi.advanceTimersByTimeAsync(1100);
    expect(events.map((e) => e.type).sort()).toEqual(["order.placed", "position.opened"].sort());
    // an order that vanishes is resolved through orderStatus
    world.openOrders[""] = [];
    await vi.advanceTimersByTimeAsync(1100);
    expect(events.some((e) => e.type === "order.canceled")).toBe(true);
    t.dispose();
  });

  it("does not stream until a wallet is connected, then starts when one is", async () => {
    setSession({ address: null, agent: null, status: "disconnected" });
    const { streams, raw } = fakeStreams();
    const t = makeEnv().make({ streamsFactory: () => streams });
    t.subscribe(() => undefined);
    await Promise.resolve();
    expect(raw.orderUpdates).not.toHaveBeenCalled();
    setSession();
    await vi.waitFor(() => expect(raw.orderUpdates).toHaveBeenCalled());
    t.dispose();
  });
});

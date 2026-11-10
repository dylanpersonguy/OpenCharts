import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalAccount } from "viem";
import type { TradingEvent } from "../../adapter/types.ts";
import { createHyperliquidTrading, type HyperliquidTrading } from "../trading.ts";
import { ExchangeRunner, type ExchangeApi, type HlInfoApi, type HlStreams } from "../exchange.ts";
import { builderField } from "../orders.ts";
import { createAccountReader, mapClosedPositions, mapOpenOrder, summarizeStates, type DexState, type UserFill } from "../accountState.ts";
import { hlSession } from "../session.ts";
import type { HlMarket, MarketRegistry } from "../types.ts";

/** Adversarial-review regressions for trading / orders / exchange / accountState. Mocks only. */

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

const market = (symbol: string, over: Partial<HlMarket> = {}): HlMarket => ({
  symbol, coin: symbol, dex: "", dexIndex: 0, indexInMeta: 0, assetId: 0, szDecimals: 5,
  maxLeverage: 40, onlyIsolated: false, category: "Crypto", displayName: symbol, ...over,
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
const filled = { filled: { oid: 100, totalSz: "0.001", avgPx: "65010" } };

interface Pos { coin: string; szi: string; upnl?: string }
function chs(positions: Pos[] = [], accountValue = 1000) {
  const s = { accountValue: String(accountValue), totalNtlPos: "0", totalRawUsd: "0", totalMarginUsed: "0" };
  return {
    marginSummary: s, crossMarginSummary: s, crossMaintenanceMarginUsed: "0", withdrawable: String(accountValue),
    assetPositions: positions.map((p) => ({
      type: "oneWay",
      position: {
        coin: p.coin, szi: p.szi, leverage: { type: "cross", value: 5 }, entryPx: "60000", positionValue: "0",
        unrealizedPnl: p.upnl ?? "0", returnOnEquity: "0", liquidationPx: null, marginUsed: "10", maxLeverage: 40,
        cumFunding: { allTime: "0", sinceOpen: "0", sinceChange: "0" },
      },
    })),
    time: 0,
  };
}

function makeEnv() {
  const world = {
    positions: {} as Record<string, Pos[]>,
    leverage: { type: "cross" as "cross" | "isolated", value: 40 },
    failDex: new Set<string>(),
    gate: null as null | Promise<void>,
  };
  const exchange = {
    order: vi.fn(async (_a: unknown) => okOrder([filled])),
    modify: vi.fn(async () => ({ status: "ok", response: { type: "default" } })),
    cancel: vi.fn(async (_a: unknown) => ({ status: "ok", response: { type: "cancel", data: { statuses: ["success"] } } })),
    cancelByCloid: vi.fn(async () => ({ status: "ok", response: { type: "cancel", data: { statuses: ["success"] } } })),
    updateLeverage: vi.fn(async (_a: unknown) => ({ status: "ok", response: { type: "default" } })),
  };
  const info = {
    allMids: vi.fn(async (p?: { dex?: string }) => (p?.dex === "xyz" ? { "xyz:EUR": "1.1" } : { BTC: "65000", ETH: "3000" })),
    l2Book: vi.fn(),
    clearinghouseState: vi.fn(async (p: { dex?: string }) => {
      const dex = p.dex ?? "";
      const gate = world.gate;
      if (gate && dex === "") await gate;
      if (world.failDex.has(dex)) throw new Error("dex down");
      return chs(world.positions[dex] ?? []);
    }),
    frontendOpenOrders: vi.fn(async (_p: { dex?: string }) => [] as unknown[]),
    orderStatus: vi.fn(async () => ({ status: "unknownOid" })),
    userFills: vi.fn(async () => []),
    activeAssetData: vi.fn(async () => ({ leverage: world.leverage })),
    userAbstraction: vi.fn(async () => "default"),
    spotClearinghouseState: vi.fn(async () => ({ balances: [] })),
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

beforeEach(() =>
  hlSession.setState({
    network: "mainnet",
    address: ADDR,
    agent: { address: AGENT, account: { address: AGENT } as unknown as LocalAccount, validUntil: Date.now() + 1e9 },
    status: "ready",
  }),
);
afterEach(() => hlSession.setState({ address: null, agent: null, status: "disconnected" }));

const input = (over: Record<string, unknown> = {}) => ({
  accountId: ADDR, symbol: "BTC", side: "BUY" as const, type: "MARKET" as const, quantity: 0.001, ...over,
});

describe("builderField hardening", () => {
  it("lowercases the builder address, floors and caps the fee", () => {
    expect(builderField({ b: "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD", f: 100 })).toEqual({
      builder: { b: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", f: 100 },
    });
    expect(builderField({ b: BUILDER.b, f: 5000 }).builder?.f).toBe(100);
    expect(builderField({ b: BUILDER.b, f: 12.9 }).builder?.f).toBe(12);
  });
  it("drops a malformed builder instead of sending HL something it will reject", () => {
    expect(builderField({ b: "0x123" as `0x${string}`, f: 10 })).toEqual({});
    expect(builderField({ b: BUILDER.b, f: Number.NaN })).toEqual({});
    expect(builderField({ b: BUILDER.b, f: -1 })).toEqual({});
  });
});

describe("leverage is never changed on a guess", () => {
  it("does not touch leverage when the position check fails (a failed read is not 'flat')", async () => {
    const { world, exchange, make } = makeEnv();
    world.failDex.add(""); // clearinghouseState throws
    // the order itself is not blocked by the leverage step; it just must not overwrite leverage
    await make().placeOrder(input()).catch(() => undefined);
    expect(exchange.updateLeverage).not.toHaveBeenCalled();
  });

  it("does not touch leverage when the current leverage can't be read", async () => {
    const { info, exchange, make } = makeEnv();
    info.activeAssetData.mockRejectedValue(new Error("boom"));
    await expect(make().placeOrder(input())).resolves.toMatchObject({ status: "FILLED" });
    expect(exchange.updateLeverage).not.toHaveBeenCalled();
  });

  it("does not flip a deliberately isolated market (even at max leverage) to cross", async () => {
    const { world, exchange, make } = makeEnv();
    world.leverage = { type: "isolated", value: 40 }; // == BTC max, but isolated: the user's choice
    await make().placeOrder(input());
    expect(exchange.updateLeverage).not.toHaveBeenCalled();
  });

  it("an explicit request under an open position can't silently switch margin mode", async () => {
    const { world, exchange, make } = makeEnv();
    world.positions[""] = [{ coin: "BTC", szi: "0.2" }];
    world.leverage = { type: "cross", value: 10 };
    await expect(make().placeOrder(input({ leverage: 5, isCross: false }))).rejects.toThrow(/margin/i);
    expect(exchange.order).not.toHaveBeenCalled();
    expect(exchange.updateLeverage).not.toHaveBeenCalled();
  });

  it("an explicit leverage under a position (same mode) is applied rather than silently ignored", async () => {
    const { world, exchange, make } = makeEnv();
    world.positions[""] = [{ coin: "BTC", szi: "0.2" }];
    world.leverage = { type: "cross", value: 10 };
    await make().placeOrder(input({ leverage: 7, isCross: true }));
    expect(exchange.updateLeverage).toHaveBeenCalledWith({ asset: 0, isCross: true, leverage: 7 });
  });
});

describe("closing", () => {
  it("closeAllPositions fails loudly when a dex can't be read instead of leaving its positions open", async () => {
    const { world, exchange, make } = makeEnv();
    world.positions[""] = [{ coin: "BTC", szi: "0.2" }];
    world.positions.xyz = [{ coin: "xyz:EUR", szi: "-5" }];
    world.failDex.add("xyz");
    await expect(make().closeAllPositions()).rejects.toThrow();
    expect(exchange.order).not.toHaveBeenCalled();
  });

  it("a double-clicked partial close is one order", async () => {
    const { world, exchange, make } = makeEnv();
    world.positions[""] = [{ coin: "BTC", szi: "1" }];
    const t = make();
    await Promise.all([t.closePosition("BTC", 0.25), t.closePosition("BTC", 0.25)]);
    expect(exchange.order).toHaveBeenCalledTimes(1);
  });

  it("closes a HIP-3 short with a buy on the right asset id and a rounded-up price", async () => {
    const { world, exchange, make } = makeEnv();
    world.positions.xyz = [{ coin: "xyz:EUR", szi: "-382.8" }];
    await make().closePosition("xyz:EUR");
    const a = exchange.order.mock.calls[0]?.[0] as { orders: Array<Record<string, unknown>>; builder: unknown };
    expect(a.orders[0]).toMatchObject({ a: 110_003, b: true, r: true, s: "382.8", p: "1.133" });
    expect(a.builder).toEqual(BUILDER);
  });
});

describe("cancel batches", () => {
  it("cancelAll keeps going when some orders in a chunk are already gone", async () => {
    const { info, exchange, make } = makeEnv();
    const orders = Array.from({ length: 150 }, (_, i) => ({
      coin: "BTC", side: "B", limitPx: "1", sz: "1", oid: i + 1, timestamp: 1, origSz: "1", isTrigger: false,
      reduceOnly: false, isPositionTpsl: false, orderType: "Limit", children: [], triggerPx: "0",
    }));
    info.frontendOpenOrders.mockImplementation(async (p: { dex?: string }) => (p.dex ? [] : orders));
    exchange.cancel.mockRejectedValueOnce(new ApiRequestError({}, "cancel 3: Order was never placed, already canceled, or filled."));
    await expect(make().cancelAllOrders()).resolves.toBeUndefined();
    expect(exchange.cancel).toHaveBeenCalledTimes(2);
  });
});

describe("recovery after an ambiguous failure", () => {
  it("does not report the slippage bound as the average fill price", async () => {
    const { info, exchange, make } = makeEnv();
    exchange.order.mockRejectedValueOnce(new Error("fetch failed"));
    info.orderStatus.mockResolvedValue({
      status: "order",
      order: { order: { coin: "BTC", side: "B", limitPx: "66950", sz: "0.0", oid: 9, timestamp: 1, origSz: "0.001" }, status: "filled", statusTimestamp: 1 },
    } as never);
    const o = await make().placeOrder(input());
    expect(o.status).toBe("FILLED");
    expect(o.avgFillPrice).toBeNull();
  });
});

describe("dispose", () => {
  it("drops cached agent signing clients", async () => {
    const { exchangeFactory, make } = makeEnv();
    const t = make();
    await t.placeOrder(input());
    t.dispose();
    await t.placeOrder(input({ quantity: 0.002 }));
    expect(exchangeFactory).toHaveBeenCalledTimes(2);
  });
});

describe("live state ordering", () => {
  function fakeStreams() {
    const cbs: { state?: (e: unknown) => void; reconnect?: () => void } = {};
    const h = { unsubscribe: vi.fn(async () => undefined) };
    const raw = {
      orderUpdates: vi.fn(async () => h),
      userFills: vi.fn(async () => h),
      allDexsClearinghouseState: vi.fn(async (_u: string, cb: (e: unknown) => void) => {
        cbs.state = cb;
        return h;
      }),
      onReconnect: vi.fn((cb: () => void) => {
        cbs.reconnect = cb;
        return () => undefined;
      }),
      close: vi.fn(),
    };
    return { streams: raw as unknown as HlStreams, raw, cbs };
  }

  it("a slow REST snapshot can't resurrect a position the websocket already reported closed", async () => {
    const { world, make } = makeEnv();
    world.positions[""] = [{ coin: "BTC", szi: "0.1" }];
    const { streams, raw, cbs } = fakeStreams();
    const t = make({ streamsFactory: () => streams });
    const events: TradingEvent[] = [];
    t.subscribe((e) => events.push(e));
    await vi.waitFor(() => expect(raw.allDexsClearinghouseState).toHaveBeenCalled());

    let release: () => void = () => undefined;
    world.gate = new Promise<void>((r) => (release = r));
    cbs.reconnect?.(); // REST sync starts, blocked on the (old) state
    await Promise.resolve();
    world.positions[""] = []; // the position closes; the websocket says so first
    cbs.state?.({ user: ADDR, clearinghouseStates: [["", chs([])]] });
    expect(events.map((e) => e.type)).toContain("position.closed");
    events.length = 0;
    world.gate = null;
    release();
    await new Promise((r) => setTimeout(r, 30));
    expect(events.map((e) => e.type)).not.toContain("position.opened");
    t.dispose();
  });

  it("a dex that fails to load for one tick doesn't announce its positions as closed", async () => {
    vi.useFakeTimers();
    const { world, make } = makeEnv();
    world.positions.xyz = [{ coin: "xyz:EUR", szi: "-5" }];
    const t = make({
      streamsFactory: () => {
        throw new Error("no ws");
      },
      pollIntervalMs: 1000,
    });
    const events: TradingEvent[] = [];
    t.subscribe((e) => events.push(e));
    await vi.advanceTimersByTimeAsync(50);
    world.failDex.add("xyz");
    await vi.advanceTimersByTimeAsync(2100);
    expect(events.map((e) => e.type)).not.toContain("position.closed");
    t.dispose();
    vi.useRealTimers();
  });
});

describe("accountState", () => {
  const state = (accountValue: string, upnl: string, used: string, withdrawable: string): DexState => ({
    dex: "",
    state: {
      ...chs([{ coin: "ETH", szi: "1", upnl }], Number(accountValue)),
      marginSummary: { accountValue, totalNtlPos: "0", totalRawUsd: "0", totalMarginUsed: used },
      withdrawable,
    } as never,
  });

  it("unified accounts: equity/free margin come from the spot collateral, not the near-empty perp slice", () => {
    // Shape observed live: perp accountValue 223.9 / withdrawable 0 while spot USDC total is 479.8.
    const s = summarizeStates([state("223.938", "-29.599", "90.48", "0.0")], { total: 479.84, available: 426.07 });
    expect(s.balance).toBeCloseTo(479.84);
    expect(s.equity).toBeCloseTo(479.84 - 29.599);
    expect(s.freeMargin).toBeCloseTo(426.07);
    expect(s.margin).toBeCloseTo(90.48);
  });

  it("standard accounts are unchanged", () => {
    const s = summarizeStates([state("1000", "50", "100", "900")]);
    expect(s).toMatchObject({ equity: 1000, balance: 950, margin: 100, freeMargin: 900 });
  });

  it("reader.getAccount uses spot collateral only for unifiedAccount and caches the lookup", async () => {
    const { info } = makeEnv();
    info.userAbstraction.mockResolvedValue("unifiedAccount");
    info.spotClearinghouseState.mockResolvedValue({
      balances: [{ coin: "USDC", token: 0, total: "479.84", hold: "271", entryNtl: "0" }],
      tokenToAvailableAfterMaintenance: [[0, "426.06"]],
    } as never);
    const reader = createAccountReader({ info: info as unknown as HlInfoApi, registry });
    const a = await reader.getAccount(ADDR);
    expect(a.equity).toBeCloseTo(479.84);
    expect(a.freeMargin).toBeCloseTo(426.06);
    await reader.getAccount(ADDR);
    expect(info.userAbstraction).toHaveBeenCalledTimes(1);
  });

  it("falls back to the perp view if the abstraction can't be determined", async () => {
    const { info } = makeEnv();
    info.userAbstraction.mockRejectedValue(new Error("x"));
    const reader = createAccountReader({ info: info as unknown as HlInfoApi, registry });
    expect((await reader.getAccount(ADDR)).equity).toBe(2000); // core + xyz mock slices, perp view
  });

  it("one malformed order timestamp doesn't throw", () => {
    const o = mapOpenOrder(ADDR, { coin: "BTC", side: "B", limitPx: "1", sz: "1", oid: 1, timestamp: Number.NaN, origSz: "1" });
    expect(Number.isNaN(Date.parse(o.createdAt))).toBe(false);
  });

  it("a fill without a dir doesn't crash closed-position mapping", () => {
    const f = { coin: "BTC", px: "1", sz: "1", side: "A", time: 1, startPosition: "1", closedPnl: "0", fee: "0", oid: 1, tid: 1 } as unknown as UserFill;
    expect(mapClosedPositions(ADDR, [f])).toEqual([]);
  });
});

describe("builder-fee-unapproved code", () => {
  it("survives humanising, for top-level, per-order and thrown errors", async () => {
    const { isBuilderFeeUnapprovedError, TradeError } = await import("../orders.ts");
    const raw = "Builder fee has not been approved.";
    for (const reject of [
      new ApiRequestError({ status: "err", response: raw }, raw),
      new ApiRequestError({ status: "ok", response: { type: "order", data: { statuses: [{ error: raw }] } } }, `order 0: ${raw}`),
    ]) {
      const { exchange, make } = makeEnv();
      exchange.order.mockRejectedValueOnce(reject);
      const err = await make().placeOrder(input()).catch((e: unknown) => e);
      expect(isBuilderFeeUnapprovedError(err)).toBe(true);
      expect((err as Error).message).not.toMatch(/Builder fee has not/); // still humanised
    }
    const { exchange, make } = makeEnv();
    exchange.order.mockResolvedValueOnce({ status: "ok", response: { type: "order", data: { statuses: [{ error: raw }] } } });
    expect(isBuilderFeeUnapprovedError(await make().placeOrder(input()).catch((e: unknown) => e))).toBe(true);
    expect(isBuilderFeeUnapprovedError(new TradeError("Builder fee has not been approved."))).toBe(false);
    expect(isBuilderFeeUnapprovedError(new Error(raw))).toBe(false);
  });
});

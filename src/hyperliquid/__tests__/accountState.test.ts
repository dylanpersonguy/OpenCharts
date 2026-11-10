import { describe, expect, it, vi } from "vitest";
import {
  buildAccount,
  createAccountReader,
  isClosingFill,
  mapClosedPositions,
  mapOpenOrder,
  mapPositions,
  OpenedAtTracker,
  protectionFor,
  summarizeStates,
  type ClearinghouseState,
  type DexState,
  type FrontendOpenOrder,
  type UserFill,
} from "../accountState.ts";
import type { HlInfoApi } from "../exchange.ts";
import type { HlMarket, MarketRegistry } from "../types.ts";
import { AccountSchema, ClosedPositionSchema, OrderSchema, PositionSchema } from "../../services/schemas.ts";

const ADDR = "0x1111111111111111111111111111111111111111";

interface P {
  coin: string;
  szi: string;
  entryPx: string;
  upnl: string;
  margin: string;
}
function chs(positions: P[], accountValue: number, withdrawable: number, marginUsed: number): ClearinghouseState {
  const summary = {
    accountValue: String(accountValue),
    totalNtlPos: "0",
    totalRawUsd: "0",
    totalMarginUsed: String(marginUsed),
  };
  return {
    marginSummary: summary,
    crossMarginSummary: summary,
    crossMaintenanceMarginUsed: "0",
    withdrawable: String(withdrawable),
    assetPositions: positions.map((p) => ({
      type: "oneWay",
      position: {
        coin: p.coin,
        szi: p.szi,
        leverage: { type: "cross", value: 5 },
        entryPx: p.entryPx,
        positionValue: "0",
        unrealizedPnl: p.upnl,
        returnOnEquity: "0",
        liquidationPx: null,
        marginUsed: p.margin,
        maxLeverage: 40,
        cumFunding: { allTime: "0", sinceOpen: "0", sinceChange: "0" },
      },
    })),
    time: 0,
  } as unknown as ClearinghouseState;
}

function ord(over: Partial<FrontendOpenOrder> & { oid: number; coin: string }): FrontendOpenOrder {
  return {
    side: "A",
    limitPx: "0",
    sz: "1",
    timestamp: 1_700_000_000_000,
    origSz: "1",
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
  } as FrontendOpenOrder;
}

function fill(over: Partial<UserFill> & { oid: number; tid: number }): UserFill {
  return {
    coin: "BTC",
    px: "65000",
    sz: "0.1",
    side: "A",
    time: 1_700_000_000_000,
    startPosition: "0.1",
    dir: "Close Long",
    closedPnl: "100",
    hash: "0x00",
    crossed: true,
    fee: "1.5",
    feeToken: "USDC",
    ...over,
  } as unknown as UserFill;
}

const market = (symbol: string, dex = "", over: Partial<HlMarket> = {}): HlMarket => ({
  symbol,
  coin: symbol,
  dex,
  dexIndex: dex ? 1 : 0,
  indexInMeta: 0,
  assetId: 0,
  szDecimals: 5,
  maxLeverage: 40,
  onlyIsolated: false,
  category: "Crypto",
  displayName: symbol,
  ...over,
});

const registry = (markets: HlMarket[]): MarketRegistry => ({
  load: async () => undefined,
  markets: () => markets,
  bySymbol: (s) => markets.find((m) => m.symbol === s),
});

describe("summarizeStates / buildAccount", () => {
  it("sums equity, margin and withdrawable across dexes; balance excludes unrealised PnL", () => {
    const states: DexState[] = [
      { dex: "", state: chs([{ coin: "BTC", szi: "0.1", entryPx: "60000", upnl: "500", margin: "1200" }], 10_500, 8_000, 1_200) },
      { dex: "xyz", state: chs([{ coin: "xyz:EUR", szi: "-100", entryPx: "1.1", upnl: "-20", margin: "50" }], 980, 900, 50) },
    ];
    const s = summarizeStates(states);
    expect(s.equity).toBe(11_480);
    expect(s.unrealizedPnl).toBe(480);
    expect(s.balance).toBe(11_000);
    expect(s.margin).toBe(1_250);
    expect(s.freeMargin).toBe(8_900);
  });

  it("produces an object that satisfies AccountSchema with neutral live values", () => {
    const acc = buildAccount(ADDR, { equity: 100, balance: 90, margin: 10, freeMargin: 80, unrealizedPnl: 10 }, 90);
    expect(() => AccountSchema.parse(acc)).not.toThrow();
    expect(acc.id).toBe(ADDR);
    expect(acc.phase).toBe("LIVE");
    expect(acc.templateId).toBe("hyperliquid");
  });
});

describe("protectionFor", () => {
  const orders = [
    ord({ oid: 1, coin: "BTC", side: "A", isTrigger: true, reduceOnly: true, orderType: "Take Profit Market", triggerPx: "70000" }),
    ord({ oid: 2, coin: "BTC", side: "A", isTrigger: true, reduceOnly: true, orderType: "Stop Market", triggerPx: "60000" }),
    ord({ oid: 3, coin: "BTC", side: "B", isTrigger: true, reduceOnly: true, orderType: "Stop Market", triggerPx: "99999" }),
    ord({ oid: 4, coin: "ETH", side: "A", isTrigger: true, reduceOnly: true, orderType: "Stop Market", triggerPx: "1" }),
    ord({ oid: 5, coin: "BTC", side: "A", isTrigger: true, reduceOnly: false, orderType: "Stop Market", triggerPx: "1" }),
  ];
  it("finds exit-side reduce-only triggers for a long", () => {
    const p = protectionFor(orders, "BTC", true);
    expect(p.takeProfit).toBe(70000);
    expect(p.stopLoss).toBe(60000);
    expect(p.tpOids).toEqual([1]);
    expect(p.slOids).toEqual([2]);
  });
  it("uses the buy side as exit for a short", () => {
    const p = protectionFor(orders, "BTC", false);
    expect(p.stopLoss).toBe(99999);
    expect(p.takeProfit).toBeNull();
  });
});

describe("mapPositions", () => {
  const states: DexState[] = [
    {
      dex: "",
      state: chs(
        [
          { coin: "BTC", szi: "0.5", entryPx: "60000", upnl: "2500", margin: "6000" },
          { coin: "ETH", szi: "-2", entryPx: "3000", upnl: "-40", margin: "1200" },
          { coin: "SOL", szi: "0", entryPx: "100", upnl: "0", margin: "0" },
        ],
        10_000,
        4_000,
        7_200,
      ),
    },
  ];
  const orders = [
    ord({ oid: 1, coin: "BTC", side: "A", isTrigger: true, reduceOnly: true, orderType: "Take Profit Market", triggerPx: "70000" }),
  ];

  it("maps long and short, skips flat, and attaches TP/SL and mid", () => {
    const tracker = new OpenedAtTracker();
    const mids = new Map([["BTC", 65_000]]);
    const out = mapPositions(ADDR, states, mids, orders, tracker);
    expect(out.map((p) => p.id)).toEqual(["BTC", "ETH"]);
    const btc = out[0]!;
    const eth = out[1]!;
    expect(btc).toMatchObject({ side: "LONG", quantity: 0.5, entryPrice: 60000, unrealizedPnl: 2500, margin: 6000, currentPrice: 65000, takeProfit: 70000, stopLoss: null });
    expect(eth).toMatchObject({ side: "SHORT", quantity: 2, takeProfit: null });
    expect(eth.currentPrice).toBeUndefined();
    for (const p of out) expect(() => PositionSchema.parse(p)).not.toThrow();
  });

  it("keeps openedAt stable across calls and resets when the side flips", () => {
    const tracker = new OpenedAtTracker();
    const t1 = new Date("2025-01-01T00:00:00Z");
    const t2 = new Date("2025-01-02T00:00:00Z");
    const a = mapPositions(ADDR, states, new Map(), [], tracker, t1);
    const b = mapPositions(ADDR, states, new Map(), [], tracker, t2);
    expect(b[0]!.openedAt).toBe(a[0]!.openedAt);
    const flipped: DexState[] = [{ dex: "", state: chs([{ coin: "BTC", szi: "-0.5", entryPx: "1", upnl: "0", margin: "1" }], 1, 1, 1) }];
    const c = mapPositions(ADDR, flipped, new Map(), [], tracker, t2);
    expect(c[0]!.openedAt).toBe(t2.toISOString());
  });
});

describe("mapOpenOrder", () => {
  it("maps a resting limit order", () => {
    const o = mapOpenOrder(ADDR, ord({ oid: 77, coin: "BTC", side: "B", limitPx: "64000", sz: "0.3", origSz: "0.5" }));
    expect(o).toMatchObject({ id: "77", side: "BUY", type: "LIMIT", price: 64000, stopPrice: null, quantity: 0.5, filledQuantity: 0.2, status: "PENDING" });
    expect(() => OrderSchema.parse(o)).not.toThrow();
  });

  it("maps a stop-market trigger order with a null price", () => {
    const o = mapOpenOrder(
      ADDR,
      ord({ oid: 8, coin: "BTC", isTrigger: true, reduceOnly: true, orderType: "Stop Market", triggerPx: "59000", limitPx: "58000" }),
    );
    expect(o).toMatchObject({ type: "STOP", price: null, stopPrice: 59000, side: "SELL", comment: "Stop loss" });
  });

  it("keeps the limit price of a stop-limit order and labels position TP/SL", () => {
    const o = mapOpenOrder(
      ADDR,
      ord({ oid: 9, coin: "BTC", isTrigger: true, isPositionTpsl: true, orderType: "Take Profit Limit", triggerPx: "70000", limitPx: "69900" }),
    );
    expect(o).toMatchObject({ type: "STOP", price: 69900, stopPrice: 70000, comment: "Position take profit" });
  });

  it("surfaces TP/SL from child orders of a parent", () => {
    const parent = ord({
      oid: 10,
      coin: "BTC",
      side: "B",
      limitPx: "64000",
      children: [
        ord({ oid: 11, coin: "BTC", orderType: "Take Profit Market", triggerPx: "70000", isTrigger: true }),
        ord({ oid: 12, coin: "BTC", orderType: "Stop Market", triggerPx: "60000", isTrigger: true }),
      ],
    });
    expect(mapOpenOrder(ADDR, parent)).toMatchObject({ takeProfit: 70000, stopLoss: 60000 });
  });
});

describe("closed positions from fills", () => {
  it("only closing fills count", () => {
    expect(isClosingFill(fill({ oid: 1, tid: 1, dir: "Open Long", closedPnl: "0" }))).toBe(false);
    expect(isClosingFill(fill({ oid: 1, tid: 1, dir: "Close Long", closedPnl: "0" }))).toBe(true);
    expect(isClosingFill(fill({ oid: 1, tid: 1, dir: "Long > Short", closedPnl: "-3" }))).toBe(true);
  });

  it("aggregates fills of one order, derives entry from PnL, sums fee", () => {
    const fills = [
      fill({ oid: 5, tid: 1, sz: "0.1", px: "65000", closedPnl: "500", fee: "1", startPosition: "0.3", time: 1000 }),
      fill({ oid: 5, tid: 2, sz: "0.2", px: "66000", closedPnl: "1200", fee: "2", startPosition: "0.2", time: 1500 }),
      fill({ oid: 6, tid: 3, dir: "Open Long", closedPnl: "0" }),
    ];
    const out = mapClosedPositions(ADDR, fills);
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.side).toBe("LONG");
    expect(c.quantity).toBeCloseTo(0.3);
    expect(c.exitPrice).toBeCloseTo((0.1 * 65000 + 0.2 * 66000) / 0.3);
    expect(c.realizedPnl).toBe(1700);
    expect(c.commission).toBe(3);
    expect(c.entryPrice).toBeCloseTo(c.exitPrice - 1700 / 0.3);
    expect(c.isPartialClose).toBe(false);
    expect(() => ClosedPositionSchema.parse(c)).not.toThrow();
  });

  it("treats a buy as closing a short and flags partial closes, newest first", () => {
    const out = mapClosedPositions(ADDR, [
      fill({ oid: 1, tid: 1, side: "B", dir: "Close Short", sz: "1", px: "3000", closedPnl: "100", startPosition: "-3", time: 1000 }),
      fill({ oid: 2, tid: 2, side: "A", dir: "Close Long", time: 2000 }),
    ]);
    expect(out.map((c) => c.id)).toEqual(["BTC:2", "BTC:1"]);
    const short = out[1]!;
    expect(short.side).toBe("SHORT");
    expect(short.entryPrice).toBeCloseTo(3000 + 100);
    expect(short.isPartialClose).toBe(true);
  });
});

describe("createAccountReader", () => {
  function setup(extra: Partial<Record<keyof HlInfoApi, unknown>> = {}) {
    const info = {
      clearinghouseState: vi.fn(async (p: { dex?: string }) =>
        p.dex === "xyz"
          ? chs([{ coin: "xyz:EUR", szi: "100", entryPx: "1.1", upnl: "5", margin: "10" }], 205, 150, 10)
          : chs([{ coin: "BTC", szi: "0.1", entryPx: "60000", upnl: "500", margin: "1200" }], 10_500, 8_000, 1_200),
      ),
      frontendOpenOrders: vi.fn(async (p: { dex?: string }) =>
        p.dex === "xyz" ? [ord({ oid: 2, coin: "xyz:EUR", timestamp: 2000 })] : [ord({ oid: 1, coin: "BTC", timestamp: 1000 })],
      ),
      allMids: vi.fn(async (p?: { dex?: string }) => (p?.dex === "xyz" ? { "xyz:EUR": "1.2" } : { BTC: "65000" })),
      l2Book: vi.fn(),
      userFills: vi.fn(async () => [] as UserFill[]),
      orderStatus: vi.fn(),
      activeAssetData: vi.fn(),
      ...extra,
    };
    const reg = registry([market("BTC"), market("xyz:EUR", "xyz")]);
    return { info, reader: createAccountReader({ info: info as unknown as HlInfoApi, registry: reg, pageSize: 2 }) };
  }

  it("queries the core dex and every HIP-3 dex", async () => {
    const { info, reader } = setup();
    expect(reader.dexes()).toEqual(["", "xyz"]);
    const acc = await reader.getAccount(ADDR);
    expect(info.clearinghouseState).toHaveBeenCalledTimes(2);
    expect(acc.equity).toBe(10_705);
    expect(acc.freeMargin).toBe(8_150);
    expect(acc.margin).toBe(1_210);
    expect(acc.balance).toBe(10_200);
    expect(acc.template?.startingBalance).toBe(10_705);
  });

  it("survives a failing HIP-3 dex but not a failing core dex", async () => {
    const ok = setup({
      clearinghouseState: vi.fn(async (p: { dex?: string }) => {
        if (p.dex === "xyz") throw new Error("boom");
        return chs([], 10, 10, 0);
      }),
    });
    expect((await ok.reader.getAccount(ADDR)).equity).toBe(10);
    const bad = setup({
      clearinghouseState: vi.fn(async () => {
        throw new Error("down");
      }),
    });
    await expect(bad.reader.getAccount(ADDR)).rejects.toThrow("down");
  });

  it("returns positions with live mids per dex", async () => {
    const { reader } = setup();
    const positions = await reader.getPositions(ADDR);
    expect(positions.map((p) => [p.id, p.currentPrice])).toEqual([
      ["BTC", 65000],
      ["xyz:EUR", 1.2],
    ]);
  });

  it("lists only open orders, newest first, and honours the status filter", async () => {
    const { reader } = setup();
    expect((await reader.getOrders(ADDR)).map((o) => o.id)).toEqual(["2", "1"]);
    expect(await reader.getOrders(ADDR, "PENDING")).toHaveLength(2);
    expect(await reader.getOrders(ADDR, "FILLED")).toEqual([]);
  });

  it("pages closed positions", async () => {
    const fills = [1, 2, 3].map((i) => fill({ oid: i, tid: i, time: i * 1000 }));
    const { reader } = setup({ userFills: vi.fn(async () => fills) });
    const p1 = await reader.getClosedPositions(ADDR, 1);
    const p2 = await reader.getClosedPositions(ADDR, 2);
    expect(p1).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
    expect(p1.data.map((c) => c.id)).toEqual(["BTC:3", "BTC:2"]);
    expect(p2.data.map((c) => c.id)).toEqual(["BTC:1"]);
  });

  it("prices from allMids, falling back to the order book", async () => {
    const m = market("BTC");
    const a = setup();
    expect(await a.reader.mid(m)).toBe(65000);
    const b = setup({
      allMids: vi.fn(async () => ({})),
      l2Book: vi.fn(async () => ({ levels: [[{ px: "64990" }], [{ px: "65010" }]] })),
    });
    expect(await b.reader.mid(m)).toBe(65000);
    const c = setup({ allMids: vi.fn(async () => ({})), l2Book: vi.fn(async () => ({ levels: [[], []] })) });
    await expect(c.reader.mid(m)).rejects.toThrow(/live price/);
  });

  it("reads a signed position size for one market", async () => {
    const { reader } = setup();
    expect(await reader.positionSize(ADDR, market("BTC"))).toBe(0.1);
    expect(await reader.positionSize(ADDR, market("ETH"))).toBe(0);
  });
});

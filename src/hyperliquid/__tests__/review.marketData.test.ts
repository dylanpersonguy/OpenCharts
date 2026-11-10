import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketEvent } from "../../adapter/types.ts";
import type { HlRawCandle, InfoClient } from "../info.ts";
import { createInfoClient } from "../info.ts";
import { createHyperliquidMarketData, toCandle } from "../marketData.ts";
import { createMarketRegistry } from "../symbols.ts";
import { FakeWebSocket, FakeWebSocketCtor } from "./fakeSocket.ts";

/**
 * Adversarial review regressions for the live market-data path.
 */

function api(handler: (body: Record<string, unknown>) => unknown) {
  return vi.fn((_u: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(new Response(JSON.stringify(handler(body)), { status: 200 }));
  }) as unknown as typeof fetch;
}

const universe = {
  perpDexs: [null, { name: "xyz" }],
  core: [
    { name: "BTC", szDecimals: 5, maxLeverage: 40 },
    { name: "ETH", szDecimals: 4, maxLeverage: 25 },
    { name: "SOL", szDecimals: 2, maxLeverage: 20 },
  ],
};

function makeMd() {
  const fetchImpl = api((b) => {
    switch (b.type) {
      case "perpDexs":
        return universe.perpDexs;
      case "perpCategories":
        return [];
      case "meta":
        return b.dex === "xyz"
          ? { universe: [{ name: "xyz:EUR", szDecimals: 1, maxLeverage: 50 }], collateralToken: 0 }
          : { universe: universe.core };
      case "allMids":
        return {};
      default:
        return {};
    }
  });
  return createHyperliquidMarketData({
    info: createInfoClient({ fetchImpl, sleep: () => Promise.resolve() }),
    webSocketImpl: FakeWebSocketCtor,
  });
}

async function started(interest: string[]) {
  const md = makeMd();
  await md.getSymbols();
  const events: MarketEvent[] = [];
  md.subscribe((e) => events.push(e));
  md.setSymbolInterest?.(interest);
  md.connect!();
  const ws = FakeWebSocket.last();
  ws.open();
  return { md, ws, events };
}

beforeEach(() => FakeWebSocket.reset());

describe("one upstream frame yields exactly one event (no N-fold fan-out)", () => {
  it("bbo: three subscribed coins, one frame -> one tick", async () => {
    const { ws, events } = await started(["BTC", "ETH", "SOL"]);
    ws.push({ channel: "bbo", data: { coin: "ETH", time: 10, bbo: [{ px: "99" }, { px: "101" }] } });
    expect(events.filter((e) => e.type === "tick")).toHaveLength(1);
  });

  it("candle: two charted timeframes, one frame -> one candle event", async () => {
    const { md, ws, events } = await started(["BTC"]);
    await md.getCandles({ symbol: "BTC", timeframe: "1m", limit: 5 }).catch(() => undefined);
    await md.getCandles({ symbol: "BTC", timeframe: "5m", limit: 5 }).catch(() => undefined);
    ws.push({
      channel: "candle",
      data: { t: 1_700_000_100_000, T: 1_700_000_159_999, s: "BTC", i: "1m", o: "1", c: "2", h: "3", l: "1", v: "1", n: 1 },
    });
    expect(events.filter((e) => e.type === "candle")).toHaveLength(1);
  });
});

describe("allMids only ticks listed perp markets", () => {
  it("ignores spot pair names such as PURR/USDC that ride the core allMids frame", async () => {
    const { ws, events } = await started([]);
    ws.push({ channel: "allMids", data: { mids: { ETH: "2000", "PURR/USDC": "0.1", "@5": "3" } } });
    const syms = events.filter((e) => e.type === "tick").map((e) => (e as { symbol: string }).symbol);
    expect(syms).toEqual(["ETH"]);
  });
});

describe("candle mapping", () => {
  const base: HlRawCandle = { t: 1_700_000_100_999, T: 0, s: "BTC", i: "1m", o: "1", c: "2", h: "3", l: "0.5", v: "7", n: 1 };
  it("uses the bar OPEN time in seconds", () => {
    expect(toCandle(base).time).toBe(1_700_000_100);
  });
  it("never leaks NaN volume into the chart", () => {
    const c = toCandle({ ...base, v: undefined as unknown as string });
    expect(c.volume).toBe(0);
  });
  it("accepts a candle frame delivered as a one-element array", async () => {
    const { md, ws, events } = await started(["BTC"]);
    await md.getCandles({ symbol: "BTC", timeframe: "1m", limit: 5 }).catch(() => undefined);
    ws.push({ channel: "candle", data: [{ ...base, T: base.t + 59_999 }] });
    expect(events.filter((e) => e.type === "candle")).toHaveLength(1);
  });
});

describe("registry resilience", () => {
  function infoStub(failXyzFirst: boolean): { info: InfoClient; metaCalls: () => number } {
    let xyzCalls = 0;
    const info = {
      perpDexs: async () => [null, { name: "xyz" }],
      perpCategories: async () => [],
      meta: async (dex?: string) => {
        if (dex === "xyz") {
          xyzCalls += 1;
          if (failXyzFirst && xyzCalls === 1) throw new Error("boom");
          return { universe: [{ name: "xyz:EUR", szDecimals: 1, maxLeverage: 50 }], collateralToken: 0 };
        }
        return { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }] };
      },
    } as unknown as InfoClient;
    return { info, metaCalls: () => xyzCalls };
  }

  it("retries a builder dex that failed on the first load instead of hiding it forever", async () => {
    let t = 0;
    const { info } = infoStub(true);
    const reg = createMarketRegistry(info, () => t);
    await reg.load();
    expect(reg.markets().map((m) => m.symbol)).toEqual(["BTC"]);
    t += 60_000;
    await reg.load();
    expect(reg.markets().map((m) => m.symbol).sort()).toEqual(["BTC", "xyz:EUR"]);
  });

  it("does not refetch within the freshness window when everything loaded", async () => {
    let t = 0;
    const { info, metaCalls } = infoStub(false);
    const reg = createMarketRegistry(info, () => t);
    await reg.load();
    t += 5_000;
    await reg.load();
    expect(metaCalls()).toBe(1);
  });
});

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAdapterConformance } from "../../adapter/conformance.ts";
import type { MarketEvent } from "../../adapter/types.ts";
import { createInfoClient } from "../info.ts";
import type { HlRawCandle } from "../info.ts";
import { createHyperliquidMarketData } from "../marketData.ts";
import { FakeWebSocket, FakeWebSocketCtor } from "./fakeSocket.ts";

const MIN = 60_000;

/** A deterministic fake of the HL info API. */
function createApi(opts: { candleCount?: number; listedAt?: number } = {}) {
  const now = Math.floor(Date.now() / MIN) * MIN;
  const count = opts.candleCount ?? 8000;
  const calls: Record<string, unknown>[] = [];

  const raw = (t: number): HlRawCandle => ({
    t,
    T: t + MIN - 1,
    s: "BTC",
    i: "1m",
    o: "100",
    c: "101",
    h: "102",
    l: "99",
    v: "5",
    n: 3,
  });

  const handler = (body: Record<string, unknown>): unknown => {
    calls.push(body);
    switch (body.type) {
      case "perpDexs":
        return [null, { name: "xyz" }];
      case "perpCategories":
        return [["xyz:EUR", "fx"]];
      case "meta":
        return body.dex === "xyz"
          ? { universe: [{ name: "xyz:EUR", szDecimals: 1, maxLeverage: 50 }], collateralToken: 0 }
          : { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }, { name: "ETH", szDecimals: 4, maxLeverage: 25 }] };
      case "allMids":
        return body.dex === "xyz" ? { "xyz:EUR": "1.1167" } : { BTC: "76101.5", "@107": "9", "#1": "0.5" };
      case "l2Book":
        return {
          coin: body.coin,
          time: 123,
          levels: [[{ px: "100", sz: "1", n: 1 }], [{ px: "101", sz: "1", n: 1 }]],
        };
      case "candleSnapshot": {
        const req = body.req as { startTime: number; endTime?: number };
        const end = req.endTime ?? now;
        const first = now - (count - 1) * MIN;
        const out: HlRawCandle[] = [];
        for (let t = first; t <= now; t += MIN) {
          if (t >= req.startTime && t <= end) out.push(raw(t));
        }
        return out.slice(-5000);
      }
      default:
        return {};
    }
  };

  const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(new Response(JSON.stringify(handler(body)), { status: 200 }));
  }) as unknown as typeof fetch;

  return { fetchImpl, calls, now };
}

function makeSource(opts: Parameters<typeof createApi>[0] = {}) {
  const api = createApi(opts);
  const md = createHyperliquidMarketData({
    info: createInfoClient({ fetchImpl: api.fetchImpl, sleep: () => Promise.resolve() }),
    webSocketImpl: FakeWebSocketCtor,
  });
  return { md, api };
}

beforeEach(() => FakeWebSocket.reset());

describe("getSymbols", () => {
  it("returns every live market with price-derived tick sizes", async () => {
    const { md } = makeSource();
    const symbols = await md.getSymbols();
    expect(symbols.map((s) => s.name).sort()).toEqual(["BTC", "ETH", "xyz:EUR"]);
    const eur = symbols.find((s) => s.name === "xyz:EUR")!;
    expect(eur.displayName).toBe("EUR/USD");
    expect(eur.category).toBe("Forex");
    expect(eur.tickSize).toBe(0.0001);
    expect(symbols.find((s) => s.name === "BTC")!.tickSize).toBe(1);
  });

  it("memoises within the TTL", async () => {
    const { md, api } = makeSource();
    await md.getSymbols();
    const n = api.calls.length;
    await md.getSymbols();
    expect(api.calls.length).toBe(n);
  });
});

describe("getCandles", () => {
  it("returns oldest-first candles in SECONDS, honouring limit", async () => {
    const { md, api } = makeSource();
    const c = await md.getCandles({ symbol: "BTC", timeframe: "1m", limit: 50 });
    expect(c).toHaveLength(50);
    expect(c.at(-1)!.time).toBe(api.now / 1000);
    expect(c[0]!.time).toBeLessThan(c[1]!.time);
    expect(c[0]!.time).toBeLessThan(1e11);
    expect(c[0]).toMatchObject({ open: 100, high: 102, low: 99, close: 101, volume: 5 });
  });

  it("treats toMs as EXCLUSIVE and fromMs as inclusive", async () => {
    const { md, api } = makeSource();
    const toMs = api.now - 10 * MIN;
    const c = await md.getCandles({ symbol: "BTC", timeframe: "1m", toMs, limit: 5 });
    expect(c.at(-1)!.time * 1000).toBe(toMs - MIN);
    const w = await md.getCandles({
      symbol: "BTC",
      timeframe: "1m",
      fromMs: api.now - 4 * MIN,
      toMs: api.now - MIN,
    });
    expect(w.map((x) => x.time * 1000)).toEqual([api.now - 4 * MIN, api.now - 3 * MIN, api.now - 2 * MIN]);
  });

  it("returns [] past the available history so scroll-back terminates", async () => {
    const { md, api } = makeSource({ candleCount: 100 });
    const earliest = api.now - 99 * MIN;
    const c = await md.getCandles({ symbol: "BTC", timeframe: "1m", toMs: earliest, limit: 200 });
    expect(c).toEqual([]);
  });

  it("widens the window once when the market has gaps", async () => {
    const { md, api } = makeSource();
    await md.getCandles({ symbol: "BTC", timeframe: "1m", limit: 4000 });
    const snaps = api.calls.filter((c) => c.type === "candleSnapshot");
    expect(snaps.length).toBeLessThanOrEqual(2);
  });

  it("caps at 5000 bars", async () => {
    const { md } = makeSource();
    const c = await md.getCandles({ symbol: "BTC", timeframe: "1m", limit: 99999 });
    expect(c.length).toBeLessThanOrEqual(5000);
    expect(c.length).toBeGreaterThan(4000);
  });

  it("rejects (never throws synchronously) with readable messages", async () => {
    const { md } = makeSource();
    let p: Promise<unknown> | undefined;
    expect(() => {
      p = md.getCandles({ symbol: "NOPE", timeframe: "1m" });
    }).not.toThrow();
    await expect(p).rejects.toThrow(/Unknown Hyperliquid market "NOPE"/);
    await expect(md.getCandles({ symbol: "BTC", timeframe: "2m" })).rejects.toThrow(/Unsupported timeframe/);
    await expect(md.getCandles({ symbol: "BTC", timeframe: "toString" })).rejects.toThrow(/Unsupported timeframe/);
  });

  it("wraps network failures", async () => {
    const md = createHyperliquidMarketData({
      info: createInfoClient({
        fetchImpl: (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch,
        sleep: () => Promise.resolve(),
        maxRetries: 0,
      }),
      webSocketImpl: FakeWebSocketCtor,
    });
    await expect(md.getCandles({ symbol: "BTC", timeframe: "1m" })).rejects.toThrow(/Could not load Hyperliquid markets/);
  });
});

describe("getQuote", () => {
  it("uses the top of the book", async () => {
    const { md } = makeSource();
    expect(await md.getQuote!("BTC")).toEqual({ symbol: "BTC", bid: 100, ask: 101, timestamp: 123 });
  });
  it("is null for unknown symbols", async () => {
    const { md } = makeSource();
    expect(await md.getQuote!("NOPE")).toBeNull();
  });
});

describe("live streaming", () => {
  afterEach(() => vi.restoreAllMocks());

  async function started(interest: string[] = []) {
    const s = makeSource();
    await s.md.getSymbols();
    const events: MarketEvent[] = [];
    s.md.subscribe((e) => events.push(e));
    s.md.setSymbolInterest?.(interest);
    s.md.connect!();
    const ws = FakeWebSocket.last();
    ws.open();
    return { ...s, ws, events };
  }

  const subs = (ws: FakeWebSocket) =>
    ws.sent
      .filter((m): m is { method: string; subscription: Record<string, string> } =>
        (m as { method?: string }).method === "subscribe")
      .map((m) => m.subscription);

  it("subscribes bbo only for interest symbols and allMids per dex", async () => {
    const { ws } = await started(["BTC"]);
    const s = subs(ws);
    expect(s).toContainEqual({ type: "bbo", coin: "BTC" });
    expect(s).toContainEqual({ type: "allMids" });
    expect(s.filter((x) => x.type === "bbo")).toHaveLength(1);
  });

  it("subscribes allMids for every dex when nothing is on interest", async () => {
    const { ws } = await started([]);
    const s = subs(ws);
    expect(s).toContainEqual({ type: "allMids" });
    expect(s).toContainEqual({ type: "allMids", dex: "xyz" });
    expect(s.some((x) => x.type === "bbo")).toBe(false);
  });

  it("caps bbo subscriptions", async () => {
    const many = Array.from({ length: 60 }, (_, i) => `xyz:C${i}`);
    const { ws } = await started(many);
    expect(subs(ws).filter((x) => x.type === "bbo").length).toBeLessThanOrEqual(10);
  });

  it("charting a symbol adds candle + bbo and emits candle events (seconds)", async () => {
    const { md, ws, events } = await started(["BTC"]);
    await md.getCandles({ symbol: "BTC", timeframe: "5m", limit: 10 });
    expect(subs(ws)).toContainEqual({ type: "candle", coin: "BTC", interval: "5m" });

    ws.push({
      channel: "candle",
      data: { t: 1_700_000_100_000, T: 1_700_000_399_999, s: "BTC", i: "5m", o: "1", c: "3", h: "4", l: "0.5", v: "7", n: 2 },
    });
    // not subscribed -> ignored
    ws.push({ channel: "candle", data: { t: 1, T: 2, s: "ETH", i: "1m", o: "1", c: "1", h: "1", l: "1", v: "1", n: 1 } });
    expect(events).toEqual([
      {
        type: "candle",
        symbol: "BTC",
        timeframe: "5m",
        open: 1,
        high: 4,
        low: 0.5,
        close: 3,
        volume: 7,
        timestamp: 1_700_000_100,
      },
    ]);
  });

  it("emits bbo ticks with ms timestamps and ignores one-sided books", async () => {
    const { ws, events } = await started(["BTC"]);
    ws.push({ channel: "bbo", data: { coin: "BTC", time: 1_700_000_000_123, bbo: [{ px: "100" }, { px: "101" }] } });
    ws.push({ channel: "bbo", data: { coin: "BTC", time: 5, bbo: [{ px: "100" }, null] } });
    ws.push({ channel: "bbo", data: { coin: "ETH", time: 5, bbo: [{ px: "1" }, { px: "2" }] } });
    expect(events).toEqual([{ type: "tick", symbol: "BTC", bid: 100, ask: 101, timestamp: 1_700_000_000_123 }]);
  });

  it("turns allMids into mid ticks, skipping spot/outcome keys, unchanged mids and bbo symbols", async () => {
    const { ws, events } = await started(["BTC"]);
    ws.push({ channel: "allMids", data: { mids: { BTC: "5", ETH: "2000", "@107": "1", "#9": "1" } } });
    ws.push({ channel: "allMids", data: { mids: { ETH: "2000" } } }); // unchanged
    ws.push({ channel: "allMids", data: { mids: { ETH: "2001" } } });
    ws.push({ channel: "allMids", data: { dex: "xyz", mids: { "xyz:EUR": "1.11" } } });
    const ticks = events.filter((e): e is Extract<MarketEvent, { type: "tick" }> => e.type === "tick");
    expect(ticks.map((t) => [t.symbol, t.bid, t.ask])).toEqual([
      ["ETH", 2000, 2000],
      ["ETH", 2001, 2001],
    ]);
  });

  it("drops subscriptions that fall out of interest", async () => {
    const { md, ws } = await started(["BTC", "xyz:EUR"]);
    md.setSymbolInterest?.(["xyz:EUR"]);
    expect(ws.sent).toContainEqual({ method: "unsubscribe", subscription: { type: "bbo", coin: "BTC" } });
  });

  it("stops delivering to an unsubscribed handler and after disconnect", async () => {
    const { md, ws } = await started(["BTC"]);
    const got = vi.fn();
    const off = md.subscribe(got);
    off();
    ws.push({ channel: "bbo", data: { coin: "BTC", time: 1, bbo: [{ px: "1" }, { px: "2" }] } });
    expect(got).not.toHaveBeenCalled();
    md.disconnect!();
    expect(md.getConnectionState!()).toBe("disconnected");
  });

  it("reports connection state changes", async () => {
    const { md, ws } = await started(["BTC"]);
    const seen: string[] = [];
    md.onConnectionChange!((s) => seen.push(s));
    expect(seen).toEqual(["connected"]);
    ws.drop();
    expect(seen).toContain("reconnecting");
  });
});

// ── The real adapter conformance suite against a mocked network ──

const timers: ReturnType<typeof setInterval>[] = [];
afterAll(() => timers.forEach(clearInterval));

runAdapterConformance(
  "hyperliquid (mocked network)",
  () => {
    const api = createApi();
    const md = createHyperliquidMarketData({
      info: createInfoClient({ fetchImpl: api.fetchImpl, sleep: () => Promise.resolve() }),
      webSocketImpl: FakeWebSocketCtor,
    });
    // Feed a quote as soon as the terminal has connected.
    timers.push(
      setInterval(() => {
        const ws = FakeWebSocket.instances.at(-1);
        if (ws?.readyState === 0) ws.open();
        if (ws?.readyState === 1) {
          ws.push({ channel: "bbo", data: { coin: "BTC", time: Date.now(), bbo: [{ px: "100" }, { px: "101" }] } });
        }
      }, 10),
    );
    return { name: "hyperliquid", marketData: md };
  },
  { symbol: "BTC", timeframe: "1m", tickTimeoutMs: 1000 },
);

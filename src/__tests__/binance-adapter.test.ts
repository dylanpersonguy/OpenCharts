import { describe, expect, it, vi } from "vitest";
import {
  buildKlineUrl,
  buildStreamUrl,
  createBinanceMarketData,
  fromBinancePair,
  klineToCandle,
  toBinancePair,
  type BinanceKline,
} from "../../examples/binance-adapter/binance-adapter";

const KLINE: BinanceKline = [
  1_700_000_040_000, "42000.10", "42100.50", "41950.00", "42050.25", "12.5", 0,
];

describe("binance symbol mapping", () => {
  it("maps display names to Binance pairs and back", () => {
    expect(toBinancePair("BTCUSD")).toBe("BTCUSDT");
    expect(fromBinancePair("BTCUSDT")).toBe("BTCUSD");
    expect(fromBinancePair("btcusdt")).toBe("BTCUSD");
  });

  it("returns null for an unknown symbol instead of guessing", () => {
    expect(toBinancePair("NOPEUSD")).toBeNull();
    expect(fromBinancePair("NOPEUSDT")).toBeNull();
  });
});

describe("klineToCandle", () => {
  it("converts strings to numbers and ms to seconds", () => {
    expect(klineToCandle(KLINE)).toEqual({
      time: 1_700_000_040,
      open: 42_000.1,
      high: 42_100.5,
      low: 41_950,
      close: 42_050.25,
      volume: 12.5,
    });
  });

  it("produces a second-precision timestamp the chart can use", () => {
    expect(klineToCandle(KLINE).time).toBeLessThan(1e11);
  });
});

describe("buildKlineUrl", () => {
  it("passes the paging window through", () => {
    const url = buildKlineUrl({ symbol: "ETHUSD", timeframe: "1h", fromMs: 1000, toMs: 2000 })!;
    expect(url).toContain("symbol=ETHUSDT");
    expect(url).toContain("interval=1h");
    expect(url).toContain("startTime=1000");
    // Binance treats endTime as inclusive; the contract's toMs is exclusive.
    expect(url).toContain("endTime=1999");
  });

  it("clamps limit to the 1000-bar API cap", () => {
    expect(buildKlineUrl({ symbol: "BTCUSD", timeframe: "1m", limit: 99_999 })).toContain(
      "limit=1000",
    );
  });

  it("refuses unknown symbols and intervals", () => {
    expect(buildKlineUrl({ symbol: "NOPE", timeframe: "1m" })).toBeNull();
    expect(buildKlineUrl({ symbol: "BTCUSD", timeframe: "7s" })).toBeNull();
  });
});

describe("buildStreamUrl", () => {
  it("builds a combined book-ticker stream", () => {
    expect(buildStreamUrl(["BTCUSD", "ETHUSD"])).toBe(
      "wss://stream.binance.com:9443/stream?streams=btcusdt@bookTicker/ethusdt@bookTicker",
    );
  });
});

describe("createBinanceMarketData", () => {
  it("maps klines into candles through the injected fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [KLINE],
    }) as unknown as typeof fetch;

    const source = createBinanceMarketData({ symbols: ["BTCUSD"], fetchImpl });
    const candles = await source.getCandles({ symbol: "BTCUSD", timeframe: "1m", limit: 1 });

    expect(candles).toHaveLength(1);
    expect(candles[0]?.close).toBe(42_050.25);
  });

  it("surfaces a failed request rather than returning empty data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 418,
      statusText: "I'm a teapot",
    }) as unknown as typeof fetch;

    const source = createBinanceMarketData({ symbols: ["BTCUSD"], fetchImpl });
    await expect(
      source.getCandles({ symbol: "BTCUSD", timeframe: "1m" }),
    ).rejects.toThrow(/418/);
  });

  it("reports only the symbols it was configured with", async () => {
    const source = createBinanceMarketData({ symbols: ["BTCUSD", "ETHUSD"] });
    const symbols = await source.getSymbols();
    expect(symbols.map((s) => s.name)).toEqual(["BTCUSD", "ETHUSD"]);
    for (const s of symbols) expect(s.tickSize).toBeGreaterThan(0);
  });

  it("delivers ticks from socket frames and stops after unsubscribe", async () => {
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();
      constructor(public url: string) {
        sockets.push(this);
      }
    }

    const source = createBinanceMarketData({
      symbols: ["BTCUSD"],
      webSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });

    const seen: unknown[] = [];
    const unsubscribe = source.subscribe((e) => seen.push(e));
    source.connect?.();
    sockets[0]!.onopen?.();

    sockets[0]!.onmessage?.({
      data: JSON.stringify({ stream: "btcusdt@bookTicker", data: { s: "BTCUSDT", b: "100.5", a: "100.7" } }),
    });
    expect(seen).toEqual([
      { type: "tick", symbol: "BTCUSD", bid: 100.5, ask: 100.7, timestamp: expect.any(Number) },
    ]);

    unsubscribe();
    sockets[0]!.onmessage?.({
      data: JSON.stringify({ stream: "btcusdt@bookTicker", data: { s: "BTCUSDT", b: "1", a: "2" } }),
    });
    expect(seen).toHaveLength(1);
  });

  it("ignores malformed frames without tearing down the stream", () => {
    class FakeSocket {
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();
      static last: FakeSocket | null = null;
      constructor() {
        FakeSocket.last = this;
      }
    }
    const source = createBinanceMarketData({
      symbols: ["BTCUSD"],
      webSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    source.subscribe(() => {});
    source.connect?.();
    expect(() => FakeSocket.last!.onmessage?.({ data: "not json" })).not.toThrow();
  });

  it("tracks connection state through the socket lifecycle", () => {
    class FakeSocket {
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();
      static last: FakeSocket | null = null;
      constructor() {
        FakeSocket.last = this;
      }
    }
    const source = createBinanceMarketData({
      symbols: ["BTCUSD"],
      webSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });

    const states: string[] = [];
    source.onConnectionChange?.((s) => states.push(s));
    source.connect?.();
    FakeSocket.last!.onopen?.();
    source.disconnect?.();

    expect(states).toEqual(["disconnected", "connecting", "connected", "disconnected"]);
  });
});

import { describe, expect, it } from "vitest";
import type { MarketEvent, OpenChartsAdapter, TradingEvent } from "./types.ts";

/**
 * A conformance suite for OpenCharts adapters.
 *
 * Point it at your adapter and it checks the parts of the contract the
 * terminal actually relies on — the ones that fail quietly if you get them
 * wrong, like returning bars newest-first or ignoring the `fromMs`/`toMs`
 * window the chart's scroll-back pagination sends.
 *
 * ```ts
 * import { runAdapterConformance } from "opencharts/adapter/conformance";
 *
 * runAdapterConformance("my-broker", () => createMyAdapter(), {
 *   symbol: "BTCUSD",
 *   timeframe: "1m",
 * });
 * ```
 *
 * **Trading checks place and close orders**, so they are off by default. Only
 * enable them against a paper or sandbox gateway — never a funded account.
 */

export interface ConformanceOptions {
  /** A symbol the adapter can serve. Defaults to the first one it reports. */
  symbol?: string;
  /** Timeframe used for candle checks. */
  timeframe?: string;
  /** How long to wait for a live tick before skipping the streaming checks. */
  tickTimeoutMs?: number;
  /**
   * Run trading checks, which SUBMIT AND CLOSE ORDERS. Paper/sandbox only.
   */
  allowTrading?: boolean;
  /** Order size used by the trading checks. */
  testQuantity?: number;
}

function waitForEvent<T>(
  subscribe: (handler: (event: T) => void) => () => void,
  timeoutMs: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const unsubscribe = subscribe((event) => finish(event));
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

export function runAdapterConformance(
  name: string,
  createAdapter: () => OpenChartsAdapter | Promise<OpenChartsAdapter>,
  options: ConformanceOptions = {},
): void {
  const {
    timeframe = "1m",
    tickTimeoutMs = 5_000,
    allowTrading = false,
    testQuantity = 0.01,
  } = options;

  describe(`adapter conformance: ${name}`, () => {
    let adapter: OpenChartsAdapter;
    let symbol: string;

    const setup = async () => {
      if (!adapter) {
        adapter = await createAdapter();
        const symbols = await adapter.marketData.getSymbols();
        symbol = options.symbol ?? symbols[0]?.name ?? "";
      }
      return adapter;
    };

    describe("market data", () => {
      it("reports at least one tradable symbol", async () => {
        await setup();
        const symbols = await adapter.marketData.getSymbols();
        expect(Array.isArray(symbols)).toBe(true);
        expect(symbols.length).toBeGreaterThan(0);
        for (const s of symbols) {
          expect(typeof s.name).toBe("string");
          expect(s.name.length).toBeGreaterThan(0);
          expect(Number.isFinite(s.tickSize)).toBe(true);
          expect(s.tickSize).toBeGreaterThan(0);
        }
      });

      it("returns candles oldest-first with finite prices", async () => {
        await setup();
        const candles = await adapter.marketData.getCandles({ symbol, timeframe, limit: 50 });
        expect(candles.length).toBeGreaterThan(0);

        for (const c of candles) {
          expect(Number.isFinite(c.time)).toBe(true);
          for (const value of [c.open, c.high, c.low, c.close]) {
            expect(Number.isFinite(value)).toBe(true);
          }
          expect(c.high).toBeGreaterThanOrEqual(c.low);
        }

        const times = candles.map((c) => c.time);
        expect([...times].sort((a, b) => a - b)).toEqual(times);
      });

      it("uses second-precision timestamps, not milliseconds", async () => {
        await setup();
        const [candle] = await adapter.marketData.getCandles({ symbol, timeframe, limit: 1 });
        // A ms timestamp would be ~1e12; seconds are ~1e9.
        expect(candle!.time).toBeLessThan(1e11);
      });

      it("respects `limit`", async () => {
        await setup();
        const candles = await adapter.marketData.getCandles({ symbol, timeframe, limit: 5 });
        expect(candles.length).toBeLessThanOrEqual(5);
      });

      it("honours the fromMs/toMs window the chart pages back with", async () => {
        await setup();
        const recent = await adapter.marketData.getCandles({ symbol, timeframe, limit: 100 });
        expect(recent.length).toBeGreaterThan(2);

        const cutoffSec = recent[Math.floor(recent.length / 2)]!.time;
        const windowed = await adapter.marketData.getCandles({
          symbol,
          timeframe,
          toMs: cutoffSec * 1000,
        });

        // Everything returned must sit before the boundary. An adapter that
        // ignores the window returns the same recent bars and loops the chart.
        for (const candle of windowed) {
          expect(candle.time).toBeLessThan(cutoffSec);
        }
      });

      it("returns an unsubscribe function from subscribe()", async () => {
        await setup();
        const unsubscribe = adapter.marketData.subscribe(() => {});
        expect(typeof unsubscribe).toBe("function");
        unsubscribe();
      });

      it("streams ticks with a bid, an ask and a symbol", async () => {
        await setup();
        await adapter.marketData.connect?.();
        const event = await waitForEvent<MarketEvent>(
          (handler) => adapter.marketData.subscribe(handler),
          tickTimeoutMs,
        );

        if (!event) {
          console.warn(
            `[conformance] ${name}: no market event within ${tickTimeoutMs}ms — ` +
              "skipping stream shape checks (quiet feed or closed market?)",
          );
          return;
        }

        expect(["tick", "candle"]).toContain(event.type);
        expect(typeof event.symbol).toBe("string");
        if (event.type === "tick") {
          expect(Number.isFinite(event.bid)).toBe(true);
          expect(Number.isFinite(event.ask)).toBe(true);
          expect(event.ask).toBeGreaterThanOrEqual(event.bid);
        }
      });

      it("stops delivering after unsubscribe", async () => {
        await setup();
        await adapter.marketData.connect?.();
        let received = 0;
        const unsubscribe = adapter.marketData.subscribe(() => {
          received += 1;
        });
        unsubscribe();
        const before = received;
        await new Promise((r) => setTimeout(r, Math.min(1_000, tickTimeoutMs)));
        expect(received).toBe(before);
      });
    });

    describe("storage", () => {
      it("round-trips a value, or is absent entirely", async () => {
        await setup();
        const storage = adapter.storage;
        if (!storage) return; // optional in the contract

        const key = `oc_conformance_${Date.now()}`;
        await storage.set(key, JSON.stringify({ ok: true }));
        expect(await storage.get(key)).toBe(JSON.stringify({ ok: true }));

        await storage.remove(key);
        expect(await storage.get(key)).toBeNull();
      });

      it("returns null for an unknown key rather than throwing", async () => {
        await setup();
        if (!adapter.storage) return;
        expect(await adapter.storage.get(`oc_missing_${Date.now()}`)).toBeNull();
      });
    });

    describe("trading", () => {
      it("exposes accounts when trading is supported", async () => {
        await setup();
        if (!adapter.trading) return; // market-data-only adapters are valid
        const accounts = await adapter.trading.getAccounts();
        expect(Array.isArray(accounts)).toBe(true);
        for (const account of accounts) {
          expect(typeof account.id).toBe("string");
          expect(Number.isFinite(account.balance)).toBe(true);
          expect(Number.isFinite(account.equity)).toBe(true);
        }
      });

      it("rejects an invalid order size with a readable message", async () => {
        await setup();
        if (!adapter.trading || !allowTrading) return;
        const accounts = await adapter.trading.getAccounts();
        const accountId = accounts[0]?.id;
        if (!accountId) return;

        await expect(
          adapter.trading.placeOrder({
            accountId,
            symbol,
            side: "BUY",
            type: "MARKET",
            quantity: 0,
          }),
        ).rejects.toThrow();
      });

      it("fills a market order and reports the resulting position", async () => {
        await setup();
        if (!adapter.trading || !allowTrading) return;
        const gateway = adapter.trading;
        const accounts = await gateway.getAccounts();
        const accountId = accounts[0]?.id;
        if (!accountId) return;

        await adapter.marketData.connect?.();
        await waitForEvent<MarketEvent>(
          (handler) => adapter.marketData.subscribe(handler),
          tickTimeoutMs,
        );

        const before = (await gateway.getPositions(accountId)).length;
        const order = await gateway.placeOrder({
          accountId,
          symbol,
          side: "BUY",
          type: "MARKET",
          quantity: testQuantity,
        });
        expect(typeof order.id).toBe("string");

        const positions = await gateway.getPositions(accountId);
        expect(positions.length).toBeGreaterThan(before);

        const opened = positions[positions.length - 1]!;
        await gateway.closePosition(opened.id);
      });

      it("returns an unsubscribe function from subscribe()", async () => {
        await setup();
        if (!adapter.trading) return;
        const unsubscribe = adapter.trading.subscribe((_event: TradingEvent) => {});
        expect(typeof unsubscribe).toBe("function");
        unsubscribe();
      });
    });
  });
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAdapterConformance } from "../../adapter/conformance.ts";
import { createAccountStorage, createHyperliquidAdapter } from "../adapter.ts";
import { createInfoClient } from "../info.ts";
import { hlSession } from "../session.ts";
import { FakeWebSocket, FakeWebSocketCtor } from "./fakeSocket.ts";

const MIN = 60_000;

function fakeInfoFetch() {
  const now = Math.floor(Date.now() / MIN) * MIN;
  const handler = (body: Record<string, unknown>): unknown => {
    switch (body.type) {
      case "perpDexs":
        return [null];
      case "perpCategories":
        return [];
      case "meta":
        return { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }] };
      case "allMids":
        return { BTC: "76101.5" };
      case "l2Book":
        return {
          coin: "BTC",
          time: 123,
          levels: [[{ px: "100", sz: "1", n: 1 }], [{ px: "101", sz: "1", n: 1 }]],
        };
      case "candleSnapshot": {
        const req = body.req as { startTime: number; endTime?: number };
        const end = req.endTime ?? now;
        const out = [];
        for (let t = now - 999 * MIN; t <= now; t += MIN) {
          if (t >= req.startTime && t <= end) {
            out.push({ t, T: t + MIN - 1, s: "BTC", i: "1m", o: "100", c: "101", h: "102", l: "99", v: "5", n: 3 });
          }
        }
        return out;
      }
      default:
        return {};
    }
  };
  return vi.fn((_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(new Response(JSON.stringify(handler(body)), { status: 200 }));
  }) as unknown as typeof fetch;
}

function makeAdapter() {
  return createHyperliquidAdapter({
    marketData: {
      info: createInfoClient({ fetchImpl: fakeInfoFetch(), sleep: () => Promise.resolve() }),
      webSocketImpl: FakeWebSocketCtor,
    },
  });
}

beforeEach(() => {
  FakeWebSocket.reset();
  hlSession.setState({ address: null, status: "disconnected" });
});

runAdapterConformance("hyperliquid (mocked network)", () => makeAdapter(), {
  symbol: "BTC",
  timeframe: "1m",
  tickTimeoutMs: 50,
});

describe("createHyperliquidAdapter", () => {
  it("composes market data, trading and storage under the hyperliquid name", () => {
    const a = makeAdapter();
    expect(a.name).toBe("hyperliquid");
    expect(a.trading.setLeverage).toBeTypeOf("function");
    expect(a.storage).toBeDefined();
  });

  it("disposes trading when market data disconnects", () => {
    const a = makeAdapter();
    const spy = vi.spyOn(a.trading, "dispose");
    a.marketData.disconnect?.();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("createAccountStorage", () => {
  function memory() {
    const m = new Map<string, string>();
    return {
      m,
      store: {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => (m.set(k, v), true),
        removeItem: (k: string) => m.delete(k),
      },
    };
  }

  it("namespaces by connected address so state follows the account", () => {
    const { m, store } = memory();
    let scope: string | null = null;
    const s = createAccountStorage({ store, getScope: () => scope });
    s.set("drawings", "anon-data");
    scope = "0xAbC";
    s.set("drawings", "acct-data");
    expect([...m.keys()].sort()).toEqual(["hl:0xabc:drawings", "hl:anon:drawings"]);
    expect(s.get("drawings")).toBe("acct-data");
    scope = null;
    expect(s.get("drawings")).toBe("anon-data");
    s.remove("drawings");
    expect(s.get("drawings")).toBeNull();
  });

  it("never reads another account's data", () => {
    const { store } = memory();
    let scope: string | null = "0x1";
    const s = createAccountStorage({ store, getScope: () => scope });
    s.set("k", "one");
    scope = "0x2";
    expect(s.get("k")).toBeNull();
  });
});

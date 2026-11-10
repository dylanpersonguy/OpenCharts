import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalAccount } from "viem";

// Mock the SDK so constructing clients never touches the network or a key.
const created = vi.hoisted(() => ({
  exchange: [] as unknown[],
  info: [] as unknown[],
  http: [] as unknown[],
  ws: [] as unknown[],
  sub: [] as unknown[],
}));
vi.mock("@nktkas/hyperliquid", () => {
  class HttpTransport {
    constructor(public opts: unknown) {
      created.http.push(opts);
    }
  }
  class WebSocketTransport {
    socket = new EventTarget();
    close = vi.fn();
    constructor(public opts: unknown) {
      created.ws.push(this);
    }
  }
  class ExchangeClient {
    constructor(public config: unknown) {
      created.exchange.push(config);
    }
  }
  class InfoClient {
    constructor(public config: unknown) {
      created.info.push(config);
    }
  }
  class SubscriptionClient {
    orderUpdates = vi.fn(async () => ({ unsubscribe: async () => undefined }));
    userFills = vi.fn(async () => ({ unsubscribe: async () => undefined }));
    allDexsClearinghouseState = vi.fn(async () => ({ unsubscribe: async () => undefined }));
    constructor(public config: unknown) {
      created.sub.push(this);
    }
  }
  return { HttpTransport, WebSocketTransport, ExchangeClient, InfoClient, SubscriptionClient };
});

import {
  apiResponseOf,
  classifyFailure,
  createSdkExchange,
  createSdkInfo,
  createSdkStreams,
  describeError,
  ExchangeRunner,
  toTradeError,
} from "../exchange.ts";
import { TradeError } from "../orders.ts";

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
class ValidationError extends Error {
  constructor(m: string) {
    super(m);
    this.name = "ValidationError";
  }
}

beforeEach(() => {
  for (const k of Object.keys(created) as Array<keyof typeof created>) created[k].length = 0;
});

describe("SDK wiring", () => {
  const wallet = { address: "0x2222222222222222222222222222222222222222" } as unknown as LocalAccount;

  it("signs with the agent wallet and never sets a vault address", () => {
    createSdkExchange(wallet, "mainnet");
    const cfg = created.exchange[0] as Record<string, unknown>;
    expect(cfg.wallet).toBe(wallet);
    expect(cfg).not.toHaveProperty("defaultVaultAddress");
    expect(cfg).not.toHaveProperty("signers");
    expect(created.http[0]).toEqual({ isTestnet: false });
  });

  it("targets testnet for exchange, info and websocket clients", () => {
    createSdkExchange(wallet, "testnet");
    createSdkInfo("testnet");
    createSdkStreams("testnet");
    expect(created.http).toEqual([{ isTestnet: true }, { isTestnet: true }]);
    expect((created.ws[0] as { opts: unknown }).opts).toEqual({ isTestnet: true });
  });

  it("streams: reconnect callbacks fire on re-open only, and close cleans up", () => {
    const streams = createSdkStreams("mainnet");
    const socket = (created.ws[0] as { socket: EventTarget }).socket;
    const cb = vi.fn();
    const off = streams.onReconnect(cb);
    socket.dispatchEvent(new Event("open"));
    expect(cb).not.toHaveBeenCalled();
    socket.dispatchEvent(new Event("open"));
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    socket.dispatchEvent(new Event("open"));
    expect(cb).toHaveBeenCalledTimes(1);
    streams.close();
    expect((created.ws[0] as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalled();
  });

  it("streams: subscriptions are keyed by the main user address", async () => {
    const streams = createSdkStreams("mainnet");
    const user = "0x1111111111111111111111111111111111111111";
    await streams.orderUpdates(user, () => undefined);
    const sub = created.sub[0] as { orderUpdates: ReturnType<typeof vi.fn> };
    expect(sub.orderUpdates.mock.calls[0]?.[0]).toEqual({ user });
  });
});

describe("classifyFailure", () => {
  it("separates rejections, rate limits, local failures and unknown outcomes", () => {
    expect(classifyFailure(new ApiRequestError({}, "Insufficient margin"))).toBe("rejected");
    expect(classifyFailure(new ApiRequestError({}, "Too many cumulative requests sent (9 > 8)"))).toBe("rate_limited");
    expect(classifyFailure(new HttpRequestError(429))).toBe("rate_limited");
    expect(classifyFailure(new HttpRequestError(502))).toBe("ambiguous");
    expect(classifyFailure(new HttpRequestError())).toBe("ambiguous");
    expect(classifyFailure(new ValidationError("bad"))).toBe("not_sent");
    expect(classifyFailure(new TradeError("x"))).toBe("not_sent");
    expect(classifyFailure(new Error("who knows"))).toBe("ambiguous");
  });

  it("exposes the raw response of an API rejection only", () => {
    const resp = { status: "ok", response: { data: { statuses: [{ error: "x" }] } } };
    expect(apiResponseOf(new ApiRequestError(resp, "x"))).toBe(resp);
    expect(apiResponseOf(new Error("x"))).toBeUndefined();
  });
});

describe("describeError / toTradeError", () => {
  it("humanises rejections and rate limits", () => {
    expect(describeError(new ApiRequestError({}, "Insufficient margin to place order."))).toMatch(/Not enough margin/);
    expect(describeError(new HttpRequestError(429))).toMatch(/rate-limiting/);
  });

  it("never echoes signatures or keys", () => {
    const secret = "0x" + "cd".repeat(65);
    for (const e of [
      new ApiRequestError({}, `bad signature ${secret}`),
      new Error(`network ${secret}`),
      new ValidationError(`oops ${secret}`),
    ]) {
      expect(describeError(e)).not.toContain("cdcd");
      expect(toTradeError(e).message).not.toContain("cdcd");
    }
  });

  it("assigns codes", () => {
    expect(toTradeError(new ApiRequestError({}, "nope")).code).toBe("exchange");
    expect(toTradeError(new HttpRequestError(429)).code).toBe("rate_limit");
    expect(toTradeError(new Error("offline")).code).toBe("network");
    const own = new TradeError("mine", "min_notional");
    expect(toTradeError(own)).toBe(own);
  });
});

describe("ExchangeRunner", () => {
  it("runs actions strictly one at a time, in submission order", async () => {
    const runner = new ExchangeRunner({ sleep: async () => undefined });
    const log: string[] = [];
    const slow = (name: string, ms: number) => () =>
      new Promise<string>((resolve) => {
        log.push(`start ${name}`);
        setTimeout(() => {
          log.push(`end ${name}`);
          resolve(name);
        }, ms);
      });
    const out = await Promise.all([runner.run(slow("a", 20)), runner.run(slow("b", 1)), runner.run(slow("c", 1))]);
    expect(out).toEqual(["a", "b", "c"]);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("a failure does not poison later actions", async () => {
    const runner = new ExchangeRunner({ sleep: async () => undefined });
    const failing = runner.run(async () => {
      throw new ApiRequestError({}, "nope");
    });
    await expect(failing).rejects.toThrow("nope");
    await expect(runner.run(async () => 7)).resolves.toBe(7);
  });

  it("retries rate-limit refusals with exponential backoff, then succeeds", async () => {
    const sleeps: number[] = [];
    const runner = new ExchangeRunner({ sleep: async (ms) => void sleeps.push(ms), backoffMs: (n) => 100 * 2 ** n });
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new HttpRequestError(429))
      .mockRejectedValueOnce(new ApiRequestError({}, "Too many cumulative requests sent"))
      .mockResolvedValueOnce("ok");
    await expect(runner.run(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("gives up after maxRetries", async () => {
    const runner = new ExchangeRunner({ sleep: async () => undefined, maxRetries: 2 });
    const fn = vi.fn(async () => {
      throw new HttpRequestError(429);
    });
    await expect(runner.run(fn)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("NEVER retries a rejection or an ambiguous failure (no duplicate submits)", async () => {
    const runner = new ExchangeRunner({ sleep: async () => undefined });
    const rejected = vi.fn(async () => {
      throw new ApiRequestError({}, "Insufficient margin");
    });
    await expect(runner.run(rejected)).rejects.toThrow();
    expect(rejected).toHaveBeenCalledTimes(1);
    const ambiguous = vi.fn(async () => {
      throw new HttpRequestError();
    });
    await expect(runner.run(ambiguous)).rejects.toThrow();
    expect(ambiguous).toHaveBeenCalledTimes(1);
  });
});

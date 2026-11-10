import { describe, expect, it, vi } from "vitest";
import { createInfoClient, HlInfoError } from "../info.ts";

function jsonRes(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

const noSleep = () => Promise.resolve();

describe("info client", () => {
  it("POSTs the typed body to /info", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ BTC: "100" }));
    const info = createInfoClient({ fetchImpl, baseUrl: "https://x.test", sleep: noSleep });
    expect(await info.allMids("xyz")).toEqual({ BTC: "100" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://x.test/info");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ type: "allMids", dex: "xyz" });
  });

  it("omits dex for the core dex and builds user queries", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonRes({})));
    const info = createInfoClient({ fetchImpl, sleep: noSleep });
    await info.meta();
    await info.clearinghouseState("0xabc", "xyz");
    await info.maxBuilderFee("0xabc", "0xdef");
    const bodies = fetchImpl.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(bodies).toEqual([
      { type: "meta" },
      { type: "clearinghouseState", user: "0xabc", dex: "xyz" },
      { type: "maxBuilderFee", user: "0xabc", builder: "0xdef" },
    ]);
  });

  it("retries 429 and 5xx then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonRes("slow down", 429))
      .mockResolvedValueOnce(jsonRes("boom", 503))
      .mockResolvedValueOnce(jsonRes([1]));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const info = createInfoClient({ fetchImpl, sleep });
    expect(await info.post({ type: "x" })).toEqual([1]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("honours Retry-After", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonRes("x", 429, { "retry-after": "2" }))
      .mockResolvedValueOnce(jsonRes({ ok: 1 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await createInfoClient({ fetchImpl, sleep }).post({ type: "x" });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("gives up after bounded retries with a readable error", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonRes("down", 500)));
    const info = createInfoClient({ fetchImpl, sleep: noSleep, maxRetries: 2 });
    await expect(info.post({ type: "meta" })).rejects.toThrow(/HTTP 500/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry 4xx", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonRes("bad", 422)));
    const info = createInfoClient({ fetchImpl, sleep: noSleep });
    const err = await info.post({ type: "meta" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HlInfoError);
    expect((err as HlInfoError).status).toBe(422);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries network failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonRes({ a: 1 }));
    const info = createInfoClient({ fetchImpl, sleep: noSleep });
    expect(await info.post({ type: "x" })).toEqual({ a: 1 });
  });

  it("de-duplicates identical in-flight requests", async () => {
    let resolve: (r: Response) => void = () => {};
    const fetchImpl = vi.fn().mockImplementation(
      () => new Promise<Response>((r) => (resolve = r)),
    );
    const info = createInfoClient({ fetchImpl, sleep: noSleep });
    const a = info.allMids();
    const b = info.allMids();
    resolve(jsonRes({ BTC: "1" }));
    expect(await a).toEqual(await b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches meta until the TTL passes or invalidate() is called", async () => {
    let t = 0;
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonRes({ universe: [] })));
    const info = createInfoClient({ fetchImpl, sleep: noSleep, cacheTtlMs: 1000, now: () => t });
    await info.meta("xyz");
    await info.meta("xyz");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await info.meta(); // different key
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    t = 2000;
    await info.meta("xyz");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    info.invalidate();
    await info.meta("xyz");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("does not cache failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonRes("bad", 400))
      .mockResolvedValueOnce(jsonRes([null]));
    const info = createInfoClient({ fetchImpl, sleep: noSleep });
    await expect(info.perpDexs()).rejects.toThrow();
    expect(await info.perpDexs()).toEqual([null]);
  });

  it("does not cache live data", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonRes({})));
    const info = createInfoClient({ fetchImpl, sleep: noSleep });
    await info.allMids();
    await info.allMids();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

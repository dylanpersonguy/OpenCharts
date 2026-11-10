import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBuilderParam, setBuilderOverride } from "../config";
import {
  fetchFeeConfigOnce,
  isBuilderFeeApprovalError,
  parseFeeConfig,
  startFeeConfigPolling,
  useFeeConfigStore,
} from "../feeConfig";

const ENV = { VITE_HL_BUILDER_ADDRESS: "0x" + "ab".repeat(20), VITE_HL_BUILDER_FEE: "50" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  setBuilderOverride({});
  useFeeConfigStore.setState({ message: null, enabled: null, feeTenthsBp: null, lastOkAt: null, lastError: null });
});
afterEach(() => {
  vi.useRealTimers();
  setBuilderOverride({});
});

describe("parseFeeConfig", () => {
  it("accepts valid documents", () => {
    expect(parseFeeConfig({ enabled: true })).toEqual({ enabled: true });
    expect(parseFeeConfig({ enabled: false, feeTenthsBp: 10, message: "hi" })).toBeDefined();
  });
  it("rejects invalid documents", () => {
    expect(parseFeeConfig({})).toBeUndefined();
    expect(parseFeeConfig({ enabled: "yes" })).toBeUndefined();
    expect(parseFeeConfig({ enabled: true, feeTenthsBp: -1 })).toBeUndefined();
    expect(parseFeeConfig(null)).toBeUndefined();
  });
});

describe("fetchFeeConfigOnce", () => {
  it("applies the kill switch", async () => {
    expect(getBuilderParam(ENV)).toEqual({ b: ENV.VITE_HL_BUILDER_ADDRESS, f: 50 });
    const ok = await fetchFeeConfigOnce("http://x", { fetchImpl: async () => jsonResponse({ enabled: false, message: "paused" }) });
    expect(ok).toBe(true);
    expect(getBuilderParam(ENV)).toBeUndefined();
    expect(useFeeConfigStore.getState().message).toBe("paused");
  });

  it("applies a dynamic fee and never exceeds 100", async () => {
    await fetchFeeConfigOnce("http://x", { fetchImpl: async () => jsonResponse({ enabled: true, feeTenthsBp: 30 }) });
    expect(getBuilderParam(ENV)?.f).toBe(30);
    await fetchFeeConfigOnce("http://x", { fetchImpl: async () => jsonResponse({ enabled: true, feeTenthsBp: 9999 }) });
    expect(getBuilderParam(ENV)?.f).toBe(100);
  });

  it("keeps last known good on HTTP error, bad schema, and network failure", async () => {
    await fetchFeeConfigOnce("http://x", { fetchImpl: async () => jsonResponse({ enabled: true, feeTenthsBp: 20 }) });
    expect(await fetchFeeConfigOnce("http://x", { fetchImpl: async () => jsonResponse({}, 500) })).toBe(false);
    expect(await fetchFeeConfigOnce("http://x", { fetchImpl: async () => jsonResponse({ nope: 1 }) })).toBe(false);
    expect(
      await fetchFeeConfigOnce("http://x", {
        fetchImpl: async () => {
          throw new Error("offline");
        },
      }),
    ).toBe(false);
    expect(getBuilderParam(ENV)?.f).toBe(20);
    expect(useFeeConfigStore.getState().lastError).toBe("offline");
  });

  it("fails open to the compiled default before any success", async () => {
    await fetchFeeConfigOnce("http://x", { fetchImpl: async () => jsonResponse({}, 503) });
    expect(getBuilderParam(ENV)?.f).toBe(50);
  });

  it("times out hung requests", async () => {
    const hang: typeof fetch = (_u, init) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
      });
    expect(await fetchFeeConfigOnce("http://x", { fetchImpl: hang, timeoutMs: 10 })).toBe(false);
    expect(getBuilderParam(ENV)?.f).toBe(50);
  });
});

describe("startFeeConfigPolling", () => {
  it("is a no-op without a URL", () => {
    const stop = startFeeConfigPolling(undefined);
    expect(typeof stop).toBe("function");
    stop();
  });

  it("polls on an interval and stops", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => jsonResponse({ enabled: true, feeTenthsBp: 10 }));
    const stop = startFeeConfigPolling("http://x", { intervalMs: 1000, fetchImpl: fetchImpl as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("isBuilderFeeApprovalError", () => {
  it("matches HL's observed text and variants", () => {
    expect(isBuilderFeeApprovalError("Builder fee has not been approved.")).toBe(true);
    expect(isBuilderFeeApprovalError(new Error("Order rejected: builder fee has not been approved"))).toBe(true);
    expect(isBuilderFeeApprovalError("You must approve the builder fee first")).toBe(true);
  });
  it("does not match unrelated errors", () => {
    expect(isBuilderFeeApprovalError("Insufficient margin to place order.")).toBe(false);
    expect(isBuilderFeeApprovalError("")).toBe(false);
    expect(isBuilderFeeApprovalError(undefined)).toBe(false);
  });
});

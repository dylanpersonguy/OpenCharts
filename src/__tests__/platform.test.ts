import { afterEach, describe, expect, it, vi } from "vitest";
import { safeStorage } from "@/lib/safe-storage";
import { uid } from "@/lib/uid";
import { publish, subscribeChannel, __resetBus } from "@/services/demo/bus";

afterEach(() => {
  vi.restoreAllMocks();
  __resetBus();
});

describe("safeStorage", () => {
  it("round-trips values", () => {
    expect(safeStorage.setItem("oc_test", "value")).toBe(true);
    expect(safeStorage.getItem("oc_test")).toBe("value");
    safeStorage.removeItem("oc_test");
    expect(safeStorage.getItem("oc_test")).toBeNull();
  });

  it("reports failure instead of throwing when the quota is exhausted", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => safeStorage.setItem("oc_test", "x")).not.toThrow();
    expect(safeStorage.setItem("oc_test", "x")).toBe(false);
  });

  it("returns null instead of throwing when storage access is blocked", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    expect(safeStorage.getItem("oc_test")).toBeNull();
  });

  it("falls back when the stored JSON is corrupt", () => {
    safeStorage.setItem("oc_bad_json", "{not json");
    expect(safeStorage.getJSON("oc_bad_json", { ok: true })).toEqual({ ok: true });
    safeStorage.removeItem("oc_bad_json");
  });

  it("falls back when the key is missing", () => {
    expect(safeStorage.getJSON("oc_absent", null)).toBeNull();
  });

  it("does not throw on circular structures", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(safeStorage.setJSON("oc_circular", circular)).toBe(false);
  });
});

describe("uid", () => {
  it("produces unique ids", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uid()));
    expect(ids.size).toBe(1000);
  });

  it("still works without crypto.randomUUID (plain-HTTP hosting)", () => {
    const original = globalThis.crypto.randomUUID;
    // @ts-expect-error — simulating a non-secure context
    globalThis.crypto.randomUUID = undefined;
    try {
      const id = uid();
      expect(id).toMatch(/^[0-9a-f-]{36}$|^id-/);
    } finally {
      globalThis.crypto.randomUUID = original;
    }
  });
});

describe("event bus", () => {
  it("delivers to every subscriber on a channel", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeChannel("test", a);
    subscribeChannel("test", b);
    publish("test", { hello: true });
    expect(a).toHaveBeenCalledWith({ hello: true });
    expect(b).toHaveBeenCalledWith({ hello: true });
  });

  it("keeps delivering after a subscriber throws", () => {
    const boom = vi.fn(() => {
      throw new Error("subscriber exploded");
    });
    const healthy = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    subscribeChannel("test", boom);
    subscribeChannel("test", healthy);

    expect(() => publish("test", 1)).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it("tolerates a subscriber unsubscribing mid-dispatch", () => {
    const later = vi.fn();
    const unsubLater = () => unsub2();
    const unsub1 = subscribeChannel("test", unsubLater);
    const unsub2 = subscribeChannel("test", later);

    expect(() => publish("test", 1)).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
    unsub1();
  });

  it("stops delivering after unsubscribe", () => {
    const handler = vi.fn();
    const unsub = subscribeChannel("test", handler);
    unsub();
    publish("test", 1);
    expect(handler).not.toHaveBeenCalled();
  });
});

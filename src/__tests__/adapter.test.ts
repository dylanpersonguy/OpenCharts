import { beforeEach, describe, expect, it } from "vitest";
import { createDemoAdapter } from "@/adapter/demo";
import { runAdapterConformance } from "@/adapter/conformance";
import { __clearAdapter, getAdapter, hasAdapter, setAdapter } from "@/adapter/registry";
import * as engine from "@/services/demo/engine";

// The reference implementation must satisfy the contract it defines.
runAdapterConformance("demo", () => createDemoAdapter(), {
  symbol: "BTCUSD",
  timeframe: "1m",
  tickTimeoutMs: 3_000,
  allowTrading: true,
  testQuantity: 0.01,
});

describe("adapter registry", () => {
  beforeEach(() => {
    __clearAdapter();
    engine.__resetForTests();
  });

  it("explains itself when nothing is installed", () => {
    expect(hasAdapter()).toBe(false);
    expect(() => getAdapter()).toThrow(/No adapter installed/);
  });

  it("returns the installed adapter", () => {
    const adapter = createDemoAdapter();
    setAdapter(adapter);
    expect(getAdapter()).toBe(adapter);
    expect(hasAdapter()).toBe(true);
  });

  it("restores the previous adapter when the installer is called back", () => {
    const first = createDemoAdapter();
    const second = createDemoAdapter();
    setAdapter(first);
    const restore = setAdapter(second);
    expect(getAdapter()).toBe(second);
    restore();
    expect(getAdapter()).toBe(first);
  });
});

describe("market-data-only adapters", () => {
  beforeEach(() => {
    __clearAdapter();
  });

  it("are valid, and trading calls fail with a clear reason", async () => {
    const demo = createDemoAdapter();
    setAdapter({ name: "read-only", marketData: demo.marketData });

    const { api } = await import("@/services/api");
    const symbols = await api.getSymbols();
    expect(symbols.length).toBeGreaterThan(0);

    await expect(api.getMyAccounts()).rejects.toThrow(/trading is not available/i);
  });
});

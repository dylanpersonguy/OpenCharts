import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearAdapter, setAdapter } from "../../adapter/registry.ts";
import {
  TradingViewEconomicCalendar,
  TradingViewMiniChart,
  TradingViewTechnicalAnalysis,
  TradingViewTickerTape,
  isTradingViewAllowed,
} from "../../components/TradingViewWidgets.tsx";
import { BLOCKED_ADDRESS_MESSAGE, createHyperliquidAdapter, guardBlockedAddress } from "../adapter.ts";
import { resetScreening, screenAddress, setAddressScreener } from "../compliance/screen.ts";
import { setBuilderOverride } from "../config.ts";
import {
  MAX_FEE_MESSAGE_CHARS,
  applyFeeConfig,
  compiledDefaultFee,
  fetchFeeConfigOnce,
  sanitizeFeeMessage,
  useFeeConfigStore,
} from "../feeConfig.ts";
import { createInfoClient } from "../info.ts";
import { hlSession } from "../session.ts";
import { FakeWebSocketCtor } from "./fakeSocket.ts";

describe("TradingView widgets are inert in Hyperliquid mode", () => {
  let restore: (() => void) | undefined;
  beforeEach(() => {
    const a = createHyperliquidAdapter({
      marketDataOnly: true,
      marketData: {
        info: createInfoClient({ fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch }),
        webSocketImpl: FakeWebSocketCtor,
      },
    });
    restore = setAdapter(a);
  });
  afterEach(() => {
    restore?.();
    __clearAdapter();
  });

  it("never creates a remote <script> element", () => {
    const create = vi.spyOn(document, "createElement");
    expect(isTradingViewAllowed()).toBe(false);
    const { container } = render(
      <div>
        <TradingViewTickerTape theme="dark" />
        <TradingViewTechnicalAnalysis symbol="BTC" theme="dark" />
        <TradingViewEconomicCalendar theme="dark" />
        <TradingViewMiniChart symbol="BTC" theme="dark" />
      </div>,
    );
    expect(create.mock.calls.filter(([tag]) => String(tag).toLowerCase() === "script")).toHaveLength(0);
    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(document.querySelectorAll('script[src*="tradingview"]')).toHaveLength(0);
    create.mockRestore();
  });
});

describe("TradingView widgets outside Hyperliquid mode", () => {
  it("are allowed when no Hyperliquid adapter is registered", () => {
    __clearAdapter();
    expect(isTradingViewAllowed()).toBe(true);
  });
});

describe("remote fee config can only lower the fee", () => {
  const ENV = { VITE_HL_BUILDER_FEE: "40" };
  beforeEach(() => {
    setBuilderOverride({});
    useFeeConfigStore.setState({ message: null, enabled: null, feeTenthsBp: null, lastOkAt: null, lastError: null });
  });
  afterEach(() => setBuilderOverride({}));

  it("compiledDefaultFee reads the env (default 100)", () => {
    expect(compiledDefaultFee(ENV)).toBe(40);
    expect(compiledDefaultFee({})).toBe(100);
  });
  it("clamps a higher remote fee to the compiled default", () => {
    applyFeeConfig({ enabled: true, feeTenthsBp: 90 }, 1, ENV);
    expect(useFeeConfigStore.getState().feeTenthsBp).toBe(40);
  });
  it("allows lowering and disabling", () => {
    applyFeeConfig({ enabled: true, feeTenthsBp: 10 }, 1, ENV);
    expect(useFeeConfigStore.getState().feeTenthsBp).toBe(10);
    applyFeeConfig({ enabled: false }, 2, ENV);
    expect(useFeeConfigStore.getState().enabled).toBe(false);
  });
  it("applies the clamp through fetchFeeConfigOnce", async () => {
    await fetchFeeConfigOnce("http://x", {
      env: ENV,
      fetchImpl: async () => new Response(JSON.stringify({ enabled: true, feeTenthsBp: 100 })),
    });
    expect(useFeeConfigStore.getState().feeTenthsBp).toBe(40);
  });
  it("sanitizes and limits the banner message to plain text", async () => {
    const long = "x".repeat(1000);
    expect(sanitizeFeeMessage(long)?.length).toBe(MAX_FEE_MESSAGE_CHARS);
    expect(sanitizeFeeMessage("a‮\u0000b\n\n  c​d")).toBe("a b c d");
    expect(sanitizeFeeMessage("   ")).toBeNull();
    // markup is kept as inert text (React escapes it); it is never an HTML sink
    expect(sanitizeFeeMessage("<img src=x onerror=1>")).toBe("<img src=x onerror=1>");
    // an oversized message must not invalidate the document (kill switch stays effective)
    const ok = await fetchFeeConfigOnce("http://x", {
      env: ENV,
      fetchImpl: async () => new Response(JSON.stringify({ enabled: false, message: long })),
    });
    expect(ok).toBe(true);
    expect(useFeeConfigStore.getState().enabled).toBe(false);
    expect(useFeeConfigStore.getState().message?.length).toBe(MAX_FEE_MESSAGE_CHARS);
  });
});

describe("blocked-address guard", () => {
  const A = "0x00000000000000000000000000000000000000aa";
  afterEach(() => {
    setAddressScreener(undefined);
    resetScreening();
    hlSession.setState({ address: null, status: "disconnected" });
  });

  it("rejects placeOrder and modifyOrder for a screened-out wallet, without calling the gateway", async () => {
    setAddressScreener({ screen: () => Promise.resolve({ allowed: false }) });
    await screenAddress(A);
    const placeOrder = vi.fn(async () => ({}) as never);
    const modifyOrder = vi.fn(async () => ({}) as never);
    const t = { placeOrder, modifyOrder } as unknown as Parameters<typeof guardBlockedAddress>[0];
    guardBlockedAddress(t, () => A);
    await expect(t.placeOrder({} as never)).rejects.toThrow(BLOCKED_ADDRESS_MESSAGE);
    await expect(t.modifyOrder("1", {} as never)).rejects.toThrow(BLOCKED_ADDRESS_MESSAGE);
    expect(placeOrder).not.toHaveBeenCalled();
    expect(modifyOrder).not.toHaveBeenCalled();
  });

  it("passes through for allowed or unscreened wallets", async () => {
    const placeOrder = vi.fn(async () => ({ id: "1" }) as never);
    const t = { placeOrder, modifyOrder: vi.fn() } as unknown as Parameters<typeof guardBlockedAddress>[0];
    guardBlockedAddress(t, () => A);
    await expect(t.placeOrder({} as never)).resolves.toEqual({ id: "1" });
    expect(placeOrder).toHaveBeenCalledOnce();
  });
});

describe("marketDataOnly adapter", () => {
  it("works without a wallet and exposes no trading gateway", () => {
    const a = createHyperliquidAdapter({
      marketDataOnly: true,
      marketData: {
        info: createInfoClient({ fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch }),
        webSocketImpl: FakeWebSocketCtor,
      },
    });
    expect(a.name).toBe("hyperliquid");
    expect("trading" in a).toBe(false);
    expect(a.marketData).toBeDefined();
    expect(() => a.marketData.disconnect?.()).not.toThrow();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearAdapter, setAdapter } from "../../adapter/registry.ts";
import type { OpenChartsAdapter } from "../../adapter/types.ts";
import type { HlL2Book } from "../info.ts";
import { hlSession } from "../session.ts";
import type { HlMarket } from "../types.ts";
import { HlDepthPanel } from "../ui/HlDepthPanel.tsx";
import { HlOrderPanel } from "../ui/HlOrderPanel.tsx";
import { HlWatchlist } from "../ui/HlWatchlist.tsx";
import { windowRange } from "../ui/watchlistModel.ts";
import { useHlUi } from "../ui/uiStore.ts";

vi.mock("../config.ts", async (orig) => {
  const o = await orig<typeof import("../config.ts")>();
  const E = { VITE_HL_BUILDER_ADDRESS: "0x3333333333333333333333333333333333333333", VITE_HL_BUILDER_FEE: "100" };
  return { ...o, getBuilderParam: () => o.getBuilderParam(E) };
});

const USER = "0x1111111111111111111111111111111111111111" as const;

const mk = (over: Partial<HlMarket>): HlMarket => ({
  symbol: "BTC",
  coin: "BTC",
  dex: "",
  dexIndex: 0,
  indexInMeta: 0,
  assetId: 0,
  szDecimals: 5,
  maxLeverage: 40,
  onlyIsolated: false,
  category: "Crypto",
  displayName: "BTC",
  hlFeeMultiplier: 1,
  ...over,
});

const MARKETS = [
  mk({}),
  mk({ symbol: "xyz:TSLA", coin: "xyz:TSLA", dex: "xyz", szDecimals: 2, maxLeverage: 10, category: "Stocks", displayName: "TSLA", hlFeeMultiplier: 0.2 }),
  mk({ symbol: "para:ODD", coin: "para:ODD", dex: "para", szDecimals: 2, maxLeverage: 10, category: "Stocks", displayName: "ODD (para)", hlFeeMultiplier: 2 }),
];

function install(info?: unknown) {
  setAdapter({
    name: "hyperliquid",
    marketData: {
      info,
      registry: {
        load: () => Promise.resolve(),
        markets: () => MARKETS,
        bySymbol: (s: string) => MARKETS.find((m) => m.symbol === s),
      },
    },
    trading: { setLeverage: vi.fn().mockResolvedValue(undefined), getLeverage: vi.fn().mockResolvedValue({ leverage: 5, isCross: true, maxLeverage: 40 }) },
  } as unknown as OpenChartsAdapter);
}

beforeEach(() => {
  window.localStorage.clear();
  install();
  hlSession.getState().patch({ address: USER, status: "ready" });
  useHlUi.setState({ setupOpen: false, setupReason: null, depositOpen: false });
});
afterEach(() => __clearAdapter());

function panel(symbol: string, tick = { bid: 0.0064, ask: 0.0064, timestamp: 1 }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HlOrderPanel symbol={symbol} tick={tick} accountId={USER} onConfirmOrder={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("order ticket fee disclosure uses the market's real Hyperliquid fee multiplier", () => {
  it("HIP-3 growth-mode market: 0.0090% taker (0.045% x 0.2)", async () => {
    panel("xyz:TSLA", { bid: 100, ask: 100, timestamp: 1 });
    await userEvent.type(screen.getByLabelText(/^size/i), "1");
    expect(screen.getByTestId("fee-disclosure")).toHaveTextContent(/Hyperliquid fee ~0\.009%/);
  });
  it("HIP-3 market outside growth mode: 0.090% taker (2x)", async () => {
    panel("para:ODD", { bid: 100, ask: 100, timestamp: 1 });
    await userEvent.type(screen.getByLabelText(/^size/i), "1");
    expect(screen.getByTestId("fee-disclosure")).toHaveTextContent(/Hyperliquid fee ~0\.09%/);
  });
  it("core market stays at 0.045%", async () => {
    panel("BTC", { bid: 100, ask: 100, timestamp: 1 });
    await userEvent.type(screen.getByLabelText(/^size/i), "1");
    expect(screen.getByTestId("fee-disclosure")).toHaveTextContent(/Hyperliquid fee ~0\.045%/);
  });
  it("the HIP-3 footnote states the actual multiplier instead of a vague warning", () => {
    panel("para:ODD");
    expect(screen.getByTestId("fee-disclosure")).toHaveTextContent(/2x the standard Hyperliquid rate/i);
  });
});

describe("price display", () => {
  it("does not round sub-cent prices away on the buy/sell buttons", () => {
    panel("BTC");
    expect(screen.getByRole("button", { name: /^buy 0\.0064$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sell 0\.0064$/i })).toBeInTheDocument();
  });
  it("shows '--' rather than NaN for a broken tick", () => {
    panel("BTC", { bid: Number.NaN, ask: Number.POSITIVE_INFINITY, timestamp: 1 });
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });
});

describe("HlWatchlist price cell", () => {
  const sym = (name: string, extra = {}) => ({ name, displayName: name, category: "Crypto", isActive: true, ...extra });
  it("shows a mid-only tick (bid = ask) as one price, not two identical lines", () => {
    render(
      <HlWatchlist
        symbols={[sym("BTC")] as never}
        ticks={{ BTC: { bid: 73810.5, ask: 73810.5, timestamp: 1 } } as never}
        selectedSymbol="BTC"
        onSelect={() => undefined}
      />,
    );
    expect(screen.getAllByText("73,810.5")).toHaveLength(1);
  });
  it("shows both sides when there is a real spread, with full precision", () => {
    render(
      <HlWatchlist
        symbols={[sym("PEPE")] as never}
        ticks={{ PEPE: { bid: 0.005274, ask: 0.005276, timestamp: 1 } } as never}
        selectedSymbol="PEPE"
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByText("0.005274")).toBeInTheDocument();
    expect(screen.getByText("0.005276")).toBeInTheDocument();
  });
});

describe("windowRange is NaN-proof", () => {
  it("treats non-finite scroll/viewport as 0", () => {
    const r = windowRange({ scrollTop: Number.NaN, viewportHeight: Number.NaN, rowHeight: 46, count: 100 });
    expect(Number.isFinite(r.start)).toBe(true);
    expect(Number.isFinite(r.end)).toBe(true);
    expect(r.start).toBe(0);
  });
});

describe("HlDepthPanel", () => {
  const book = (px: string): HlL2Book => ({
    coin: "BTC",
    time: 1,
    levels: [[{ px, sz: "1", n: 1 }], [{ px: "0.0066", sz: "2", n: 1 }]],
  });

  it("flags a stale book when refreshes fail instead of silently showing old liquidity", async () => {
    vi.useFakeTimers();
    try {
      const l2Book = vi.fn().mockResolvedValueOnce(book("0.0064")).mockRejectedValue(new Error("down"));
      install({ l2Book });
      render(<HlDepthPanel symbol="BTC" />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("0.0064")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(screen.getByTestId("hl-depth-stale")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

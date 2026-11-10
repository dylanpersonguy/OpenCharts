import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearAdapter, setAdapter } from "../../adapter/registry.ts";
import type { OpenChartsAdapter } from "../../adapter/types.ts";
import { HlOrderPanel } from "../ui/HlOrderPanel.tsx";
import { hlSession } from "../session.ts";
import { useHlUi } from "../ui/uiStore.ts";
import type { HlMarket } from "../types.ts";

vi.mock("../config.ts", async (orig) => {
  const o = await orig<typeof import("../config.ts")>();
  const E = { VITE_HL_BUILDER_ADDRESS: "0x3333333333333333333333333333333333333333", VITE_HL_BUILDER_FEE: "100" };
  return {
    ...o,
    getBuilderAddress: () => o.getBuilderAddress(E),
    getBuilderFeeTenthsBp: () => o.getBuilderFeeTenthsBp(E),
    getBuilderParam: () => o.getBuilderParam(E),
    getMaxFeeRateString: () => o.getMaxFeeRateString(E),
    builderFeeRate: () => o.builderFeeRate(E),
  };
});

const USER = "0x1111111111111111111111111111111111111111" as const;
const TICK = { bid: 99_990, ask: 100_010, timestamp: 1 };

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
  ...over,
});

const MARKETS = [
  mk({}),
  mk({ symbol: "xyz:TSLA", coin: "xyz:TSLA", dex: "xyz", szDecimals: 2, maxLeverage: 10, onlyIsolated: true, marginMode: "noCross", category: "Stocks", displayName: "Tesla" }),
];

const setLeverage = vi.fn().mockResolvedValue(undefined);
const getLeverage = vi.fn().mockResolvedValue({ leverage: 5, isCross: true, maxLeverage: 40 });

function installAdapter() {
  const adapter = {
    name: "hyperliquid",
    marketData: {
      registry: {
        load: () => Promise.resolve(),
        markets: () => MARKETS,
        bySymbol: (s: string) => MARKETS.find((m) => m.symbol === s),
      },
    },
    trading: { setLeverage, getLeverage },
  } as unknown as OpenChartsAdapter;
  setAdapter(adapter);
}

function renderPanel(over: Partial<React.ComponentProps<typeof HlOrderPanel>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onConfirmOrder = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <HlOrderPanel symbol="BTC" tick={TICK} accountId={USER} onConfirmOrder={onConfirmOrder} {...over} />
    </QueryClientProvider>,
  );
  return { ...utils, onConfirmOrder };
}

beforeEach(() => {
  setLeverage.mockClear();
  getLeverage.mockClear();
  installAdapter();
  hlSession.getState().patch({ address: USER, status: "ready" });
  useHlUi.setState({ setupOpen: false, setupReason: null, depositOpen: false });
});
afterEach(() => __clearAdapter());

const sizeInput = () => screen.getByLabelText(/^size/i);

describe("HlOrderPanel: primary action by session status", () => {
  it("offers Connect wallet when disconnected", () => {
    hlSession.getState().patch({ address: null, status: "disconnected" });
    renderPanel();
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^buy/i })).not.toBeNull(); // the side toggle, not a submit
  });

  it("offers Enable trading when setup is incomplete and opens the setup dialog on click", async () => {
    hlSession.getState().patch({ status: "needs-agent" });
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /enable trading/i }));
    expect(useHlUi.getState()).toMatchObject({ setupOpen: true, setupReason: "trade" });
  });
});

describe("HlOrderPanel: size input", () => {
  it("shows base units and notional USD while typing", async () => {
    renderPanel();
    await userEvent.type(sizeInput(), "0.001");
    expect(screen.getByTestId("size-help")).toHaveTextContent("0.001 BTC = $100.01 notional");
  });

  it("rejects more decimals than szDecimals", async () => {
    renderPanel();
    await userEvent.type(sizeInput(), "0.123456");
    expect(screen.getByRole("alert")).toHaveTextContent(/at most 5 decimals/i);
  });

  it("enforces the $10 minimum, except for reduce-only", async () => {
    renderPanel();
    await userEvent.type(sizeInput(), "0.00005");
    expect(screen.getByRole("alert")).toHaveTextContent(/minimum order value is \$10/i);
    await userEvent.click(screen.getByLabelText(/reduce only/i));
    expect(screen.queryByText(/minimum order value/i)).toBeNull();
  });

  it("disables the submit button until the size is valid", async () => {
    renderPanel();
    const submit = () => screen.getAllByRole("button").find((b) => /^buy\s*(btc)?$/i.test(b.textContent?.trim() ?? "") && !b.textContent?.includes("100"))!;
    expect(submit()).toBeDisabled();
    await userEvent.type(sizeInput(), "0.01");
    expect(screen.getByRole("button", { name: /^buy 0\.01 btc$/i })).toBeEnabled();
  });
});

describe("HlOrderPanel: fee disclosure", () => {
  it("states the platform fee applies on open and close and updates with size", async () => {
    renderPanel();
    const box = screen.getByTestId("fee-disclosure");
    expect(box).toHaveTextContent(/open a position and again when you close/i);
    await userEvent.type(sizeInput(), "0.01"); // $1,000.10 notional
    expect(box).toHaveTextContent(/Platform fee 0\.10% \(\$1\.00\)/);
    expect(box).toHaveTextContent(/Hyperliquid fee ~0\.045%/);
    expect(box).toHaveTextContent(/Round trip/);
    expect(box).toHaveTextContent(/charged on open and close/);
    await userEvent.clear(sizeInput());
    await userEvent.type(sizeInput(), "0.1"); // $10,001
    expect(box).toHaveTextContent(/Platform fee 0\.10% \(\$10\.00\)/);
  });
});

describe("HlOrderPanel: leverage and margin mode", () => {
  it("loads the exchange's current leverage and applies changes via setLeverage", async () => {
    renderPanel();
    await waitFor(() => expect(getLeverage).toHaveBeenCalledWith("BTC"));
    const box = screen.getByLabelText("Leverage multiplier");
    await waitFor(() => expect(box).toHaveValue("5"));
    expect(screen.queryByRole("button", { name: /^apply$/i })).toBeNull();
    await userEvent.clear(box);
    await userEvent.type(box, "12");
    await userEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(setLeverage).toHaveBeenCalledWith("BTC", 12, true);
  });

  it("caps leverage at the market maximum", async () => {
    renderPanel();
    const range = screen.getByLabelText("Leverage");
    expect(range).toHaveAttribute("max", "40");
    expect(screen.getByText("Max 40x")).toBeInTheDocument();
  });

  it("forces isolated margin, with an explanation, for isolated-only markets", () => {
    renderPanel({ symbol: "xyz:TSLA" });
    const cross = screen.getByRole("button", { name: "Cross" });
    expect(cross).toBeDisabled();
    expect(cross).toHaveAttribute("title", expect.stringMatching(/only allows isolated margin/i));
    expect(screen.getByRole("button", { name: "Isolated" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("isolated-only-note")).toBeInTheDocument();
    expect(screen.getByLabelText("Leverage")).toHaveAttribute("max", "10");
  });
});

describe("HlOrderPanel: order confirmation", () => {
  it("hands the confirm dialog notional, fees, margin mode and a liquidation estimate", async () => {
    getLeverage.mockResolvedValueOnce({ leverage: 10, isCross: false, maxLeverage: 40 });
    const { onConfirmOrder } = renderPanel();
    await waitFor(() => expect(screen.getByLabelText("Leverage multiplier")).toHaveValue("10"));
    await userEvent.type(sizeInput(), "0.01");
    await userEvent.click(screen.getByRole("button", { name: /^buy 0\.01 btc$/i }));

    expect(onConfirmOrder).toHaveBeenCalledTimes(1);
    const order = onConfirmOrder.mock.calls[0]![0] as {
      quantity: number;
      reduceOnly?: boolean;
      isCross: boolean;
      leverage: number;
      details: Array<{ label: string; value: string; hint?: string }>;
    };
    expect(order).toMatchObject({ symbol: "BTC", side: "BUY", type: "MARKET", quantity: 0.01, leverage: 10, isCross: false });
    const row = (label: string) => order.details.find((d) => d.label === label);
    expect(row("Order value")?.value).toBe("$1,000.10");
    expect(row("Margin mode")?.value).toBe("Isolated 10x");
    expect(row("Est. fees (this order)")?.hint).toMatch(/platform \$1\.00/);
    expect(row("Est. fees (open + close)")).toBeDefined();
    expect(row("Est. liquidation")?.value).toMatch(/^9[0-9],/); // a long liquidates below entry
  });

  it("says liquidation depends on the whole account for cross margin", async () => {
    const { onConfirmOrder } = renderPanel();
    await waitFor(() => expect(getLeverage).toHaveBeenCalled());
    await userEvent.type(sizeInput(), "0.01");
    await userEvent.click(screen.getByRole("button", { name: /^buy 0\.01 btc$/i }));
    const order = onConfirmOrder.mock.calls[0]![0] as { details: Array<{ label: string; value: string }> };
    expect(order.details.find((d) => d.label === "Liquidation")?.value).toMatch(/whole account/i);
  });

  it("passes post-only and reduce-only through for limit orders", async () => {
    const { onConfirmOrder } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "LIMIT" }));
    await userEvent.type(screen.getByLabelText(/limit price/i), "100000");
    await userEvent.type(sizeInput(), "0.01");
    await userEvent.click(screen.getByLabelText(/post only/i));
    await userEvent.click(screen.getByLabelText(/reduce only/i));
    await userEvent.click(screen.getByRole("button", { name: /^buy 0\.01 btc$/i }));
    expect(onConfirmOrder.mock.calls[0]![0]).toMatchObject({ type: "LIMIT", price: 100000, postOnly: true, reduceOnly: true });
  });
});

describe("HlOrderPanel: HIP-3 risk", () => {
  it("shows the third-party market notice", () => {
    renderPanel({ symbol: "xyz:TSLA" });
    expect(screen.getByTestId("risk-notice")).toHaveTextContent(/third-party market/i);
  });
  it("shows none for core markets", () => {
    renderPanel();
    expect(screen.queryByTestId("risk-notice")).toBeNull();
  });
});

describe("no prop-firm concepts", () => {
  it("renders none of the challenge vocabulary", async () => {
    const { container } = renderPanel();
    await act(async () => undefined);
    expect(container.textContent).not.toMatch(/challenge|phase|prop firm|evaluation|sign in|log in|template/i);
  });
});

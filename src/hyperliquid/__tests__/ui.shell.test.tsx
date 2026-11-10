import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseAdapter } from "../../adapterChoice.ts";
import { __clearAdapter, setAdapter } from "../../adapter/registry.ts";
import type { OpenChartsAdapter } from "../../adapter/types.ts";
import { PositionsTable } from "../../pages/trading/PositionsTable.tsx";
import { MarketClosedBanner } from "../../pages/trading/MarketClosedBanner.tsx";
import type { Symbol as OcSymbol } from "../../services/schemas.ts";
import { OpenedAtTracker, mapClosedPositions, mapPositions, type DexState, type UserFill } from "../accountState.ts";
import { createHyperliquidAdapter, guardBuilderFeeErrors } from "../adapter.ts";
import { applyFeeConfig } from "../feeConfig.ts";
import { hlSession } from "../session.ts";
import { FeeMessageBanner, HlDialogHost } from "../ui/TopBar.tsx";
import { useHlUi } from "../ui/uiStore.ts";
import { isHyperliquidMode } from "../ui/mode.ts";

const USER = "0x1111111111111111111111111111111111111111" as const;

beforeEach(() => {
  useHlUi.setState({ setupOpen: false, setupReason: null, depositOpen: false });
  hlSession.getState().patch({ address: USER, status: "ready" });
});
afterEach(() => __clearAdapter());

describe("chooseAdapter", () => {
  it("defaults to the demo", () => {
    expect(chooseAdapter({})).toBe("demo");
    expect(chooseAdapter({ VITE_HL_BUILDER_ADDRESS: "  " })).toBe("demo");
  });
  it("makes Hyperliquid the default once a builder address is configured", () => {
    expect(chooseAdapter({ VITE_HL_BUILDER_ADDRESS: "0x3333333333333333333333333333333333333333" })).toBe("hyperliquid");
  });
  it("lets VITE_ADAPTER override either way", () => {
    expect(chooseAdapter({ VITE_ADAPTER: "hyperliquid" })).toBe("hyperliquid");
    expect(chooseAdapter({ VITE_ADAPTER: "demo", VITE_HL_BUILDER_ADDRESS: "0x3333333333333333333333333333333333333333" })).toBe("demo");
    expect(chooseAdapter({ VITE_ADAPTER: "Binance" })).toBe("binance");
    expect(chooseAdapter({ VITE_ADAPTER: "nonsense" })).toBe("demo");
  });
});

describe("mode detection", () => {
  it("is true only for the hyperliquid adapter", () => {
    expect(isHyperliquidMode()).toBe(false);
    setAdapter({ name: "demo", marketData: {} } as unknown as OpenChartsAdapter);
    expect(isHyperliquidMode()).toBe(false);
    setAdapter(createHyperliquidAdapter());
    expect(isHyperliquidMode()).toBe(true);
  });
});

describe("fee kill-switch banner", () => {
  it("shows the remote message and hides when cleared", () => {
    render(<FeeMessageBanner />);
    expect(screen.queryByTestId("fee-banner")).toBeNull();
    act(() => applyFeeConfig({ enabled: true, message: "Fees halved this week" }));
    expect(screen.getByTestId("fee-banner")).toHaveTextContent("Fees halved this week");
    act(() => applyFeeConfig({ enabled: true }));
    expect(screen.queryByTestId("fee-banner")).toBeNull();
  });
});

describe("builder-fee rejection", () => {
  const order = { accountId: USER, symbol: "BTC", side: "BUY", type: "MARKET", quantity: 1 } as const;

  it("moves the session to needs-builder-approval and opens the explanatory dialog", async () => {
    const trading = { placeOrder: vi.fn().mockRejectedValue(new Error("Builder fee has not been approved.")) };
    guardBuilderFeeErrors(trading as never);
    await expect(trading.placeOrder(order as never)).rejects.toThrow(/builder fee has not been approved/i);
    expect(hlSession.getState().status).toBe("needs-builder-approval");
    expect(useHlUi.getState()).toMatchObject({ setupOpen: true, setupReason: "fee-changed" });
  });

  it("ignores unrelated failures and passes successes through", async () => {
    const ok = { id: "1" };
    const trading = {
      placeOrder: vi.fn().mockRejectedValueOnce(new Error("Insufficient margin")).mockResolvedValueOnce(ok),
    };
    guardBuilderFeeErrors(trading as never);
    await expect(trading.placeOrder(order as never)).rejects.toThrow(/insufficient margin/i);
    expect(useHlUi.getState().setupOpen).toBe(false);
    expect(hlSession.getState().status).toBe("ready");
    await expect(trading.placeOrder(order as never)).resolves.toBe(ok);
  });

  it("the dialog host explains the change and leads to the setup flow", async () => {
    render(<HlDialogHost />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => useHlUi.getState().openSetup("fee-changed"));
    const dialog = screen.getByRole("dialog", { name: /fee settings changed/i });
    expect(dialog).toHaveTextContent(/approve the updated fee/i);
    await userEvent.click(screen.getByRole("button", { name: /review and approve/i }));
    expect(screen.getByRole("dialog", { name: /set up trading/i })).toBeInTheDocument();
  });

  it("does not open any dialog on its own", () => {
    hlSession.getState().patch({ status: "needs-agent" });
    render(<HlDialogHost />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("positions table: exchange detail", () => {
  const base = {
    id: "BTC",
    symbolName: "BTC",
    side: "LONG",
    quantity: 0.5,
    entryPrice: 100_000,
    currentPrice: 101_000,
    unrealizedPnl: 500,
    stopLoss: null,
    takeProfit: null,
    openedAt: new Date(0).toISOString(),
  };

  it("shows liquidation price, funding and margin mode when supplied", () => {
    render(
      <PositionsTable
        positions={[{ ...base, liquidationPx: 91_250, fundingSinceOpen: -1.25, marginMode: "isolated", leverage: 10 }]}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByTestId("liq-price")).toHaveTextContent("91,250");
    expect(screen.getByTestId("funding")).toHaveTextContent("1.25");
    expect(screen.getByTestId("margin-mode")).toHaveTextContent(/isolated 10x/i);
  });

  it("omits those columns for adapters that do not supply them", () => {
    render(<PositionsTable positions={[base]} onClose={() => undefined} />);
    expect(screen.queryByTestId("liq-price")).toBeNull();
    expect(screen.queryByText("Funding")).toBeNull();
  });

  it("closing and partial closing go through the callbacks", async () => {
    const onClose = vi.fn();
    const onPartial = vi.fn();
    render(<PositionsTable positions={[base]} onClose={onClose} onPartialClose={onPartial} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledWith("BTC");
    await userEvent.click(screen.getByRole("button", { name: /partial/i }));
    await userEvent.type(screen.getByPlaceholderText(/max 0\.5/i), "0.1{Enter}");
    expect(onPartial).toHaveBeenCalledWith("BTC", 0.1);
  });
});

describe("account mapping additions", () => {
  it("carries liquidationPx, funding, margin mode and leverage from the clearinghouse", () => {
    const state = {
      marginSummary: { accountValue: "1000", totalMarginUsed: "100" },
      withdrawable: "900",
      assetPositions: [
        {
          type: "oneWay",
          position: {
            coin: "BTC",
            szi: "0.5",
            entryPx: "100000",
            unrealizedPnl: "10",
            marginUsed: "5000",
            liquidationPx: "91250.5",
            leverage: { type: "isolated", value: 10, rawUsd: "5000" },
            cumFunding: { allTime: "3", sinceOpen: "1.5", sinceChange: "0" },
          },
        },
        {
          type: "oneWay",
          position: {
            coin: "ETH",
            szi: "-2",
            entryPx: "3000",
            unrealizedPnl: "0",
            marginUsed: "600",
            liquidationPx: null,
            leverage: { type: "cross", value: 5 },
            cumFunding: { allTime: "0", sinceOpen: "0", sinceChange: "0" },
          },
        },
      ],
    } as unknown as DexState["state"];
    const out = mapPositions(USER, [{ dex: "", state }], new Map(), [], new OpenedAtTracker());
    expect(out[0]).toMatchObject({ liquidationPx: 91250.5, fundingSinceOpen: 1.5, marginMode: "isolated", leverage: 10 });
    expect(out[1]).toMatchObject({ liquidationPx: null, marginMode: "cross", leverage: 5 });
  });

  it("sums the platform (builder) fee on closing fills separately from the exchange fee", () => {
    const f = (tid: number, builderFee: string): UserFill =>
      ({
        coin: "BTC", px: "65000", sz: "0.1", side: "A", time: 1000 + tid, startPosition: "0.2", dir: "Close Long",
        closedPnl: "50", hash: "0x0", oid: 7, tid, crossed: true, fee: "1", feeToken: "USDC", builderFee,
      }) as unknown as UserFill;
    const [closed] = mapClosedPositions(USER, [f(1, "0.65"), f(2, "0.35")]);
    expect(closed?.commission).toBeCloseTo(2);
    expect(closed?.platformFee).toBeCloseTo(1);
  });
});

describe("MarketClosedBanner in Hyperliquid mode", () => {
  const client = new QueryClient();
  const sym = (category: string) => ({ name: "xyz:TSLA", category }) as unknown as OcSymbol;

  it("never uses the schedule-based 'Market closed' claim", () => {
    setAdapter(createHyperliquidAdapter());
    vi.useFakeTimers({ now: new Date("2026-11-14T12:00:00Z"), toFake: ["Date"] });
    try {
      render(
        <QueryClientProvider client={client}>
          <MarketClosedBanner symbolInfo={sym("Stocks")} />
        </QueryClientProvider>,
      );
      const note = screen.getByTestId("market-hours-notice");
      expect(note).toHaveTextContent(/oracle/i);
      expect(screen.queryByText(/^Market closed/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays silent for crypto", () => {
    setAdapter(createHyperliquidAdapter());
    render(<MarketClosedBanner symbolInfo={sym("Crypto")} />);
    expect(screen.queryByTestId("market-hours-notice")).toBeNull();
  });
});

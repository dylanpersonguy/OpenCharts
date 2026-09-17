import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderPanel } from "@/pages/trading/OrderPanel";
import { PositionsTable } from "@/pages/trading/PositionsTable";
import { toast, type ToastPayload } from "@/services/toast";
import * as engine from "@/services/demo/engine";
import { __resetBus } from "@/services/demo/bus";
import type { Position } from "@/services/schemas";

/** Collect toasts so assertions can read what the user was told. */
function captureToasts(): { list: ToastPayload[]; stop: () => void } {
  const list: ToastPayload[] = [];
  const stop = toast.subscribe((t) => list.push(t));
  return { list, stop };
}

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const TICK = { bid: 49_995, ask: 50_005, timestamp: Date.now() };

function renderOrderPanel(props: Partial<React.ComponentProps<typeof OrderPanel>> = {}) {
  return renderWithQuery(
    <OrderPanel
      symbol="BTCUSD"
      symbolInfo={{ name: "BTCUSD", contractSize: 1 }}
      tick={TICK}
      accountId="demo-account"
      accountBalance={100_000}
      {...props}
    />,
  );
}

let toasts: ReturnType<typeof captureToasts>;

beforeEach(() => {
  engine.__resetForTests();
  __resetBus();
  engine.mark("BTCUSD", 50_000);
  toasts = captureToasts();
});

afterEach(() => {
  toasts.stop();
  vi.restoreAllMocks();
});

describe("OrderPanel", () => {
  it("renders the current bid and ask on the side buttons", () => {
    renderOrderPanel();
    // Prices are rendered through Intl, i.e. "50,005.00000".
    expect(screen.getByRole("button", { name: /BUY\s+50,005/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SELL\s+49,995/ })).toBeInTheDocument();
  });

  it("refuses a limit order with no price and says why", async () => {
    const user = userEvent.setup();
    const onConfirmOrder = vi.fn();
    renderOrderPanel({ onConfirmOrder });

    await user.click(screen.getByRole("button", { name: "LIMIT" }));
    await user.click(screen.getByRole("button", { name: /Buy .* BTCUSD/i }));

    await waitFor(() => {
      expect(toasts.list.some((t) => /Missing Price/i.test(t.title))).toBe(true);
    });
    expect(onConfirmOrder).not.toHaveBeenCalled();
  });

  it("refuses a stop order with no stop price", async () => {
    const user = userEvent.setup();
    const onConfirmOrder = vi.fn();
    renderOrderPanel({ onConfirmOrder });

    await user.click(screen.getByRole("button", { name: "STOP" }));
    await user.click(screen.getByRole("button", { name: /Buy .* BTCUSD/i }));

    await waitFor(() => {
      expect(toasts.list.some((t) => /Stop Price/i.test(t.title))).toBe(true);
    });
    expect(onConfirmOrder).not.toHaveBeenCalled();
  });

  it("rejects a non-positive quantity", async () => {
    const user = userEvent.setup();
    const onConfirmOrder = vi.fn();
    renderOrderPanel({ onConfirmOrder });

    const qty = screen.getByDisplayValue("0.1");
    await user.clear(qty);
    await user.type(qty, "0");
    await user.click(screen.getByRole("button", { name: /Buy .* BTCUSD/i }));

    await waitFor(() => {
      expect(toasts.list.some((t) => /Invalid Quantity/i.test(t.title))).toBe(true);
    });
    expect(onConfirmOrder).not.toHaveBeenCalled();
  });

  it("routes a valid market order to the confirmation dialog", async () => {
    const user = userEvent.setup();
    const onConfirmOrder = vi.fn();
    renderOrderPanel({ onConfirmOrder });

    await user.click(screen.getByRole("button", { name: /Buy .* BTCUSD/i }));

    await waitFor(() => expect(onConfirmOrder).toHaveBeenCalledTimes(1));
    const order = onConfirmOrder.mock.calls[0]![0];
    expect(order).toMatchObject({ symbol: "BTCUSD", side: "BUY", type: "MARKET", quantity: 0.1 });
    expect(typeof order._submit).toBe("function");
  });

  it("disables the submit button when no account is selected", () => {
    renderOrderPanel({ accountId: null });
    expect(screen.getByRole("button", { name: /Buy .* BTCUSD/i })).toBeDisabled();
  });

  it("blocks trading while the feed is down", () => {
    renderOrderPanel({ isFeedConnected: false });
    // The panel swaps the ticket for a disconnected banner rather than
    // offering a button that would fail.
    expect(screen.queryByRole("button", { name: /Buy .* BTCUSD/i })).toBeNull();
  });

  it("applies a volume preset to the quantity field", async () => {
    const user = userEvent.setup();
    renderOrderPanel();
    await user.click(screen.getByRole("button", { name: "0.5" }));
    expect(screen.getByDisplayValue("0.5")).toBeInTheDocument();
  });
});

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "pos-1",
    accountId: "demo-account",
    symbolName: "BTCUSD",
    side: "LONG",
    quantity: 2,
    entryPrice: 50_000,
    currentPrice: 50_500,
    unrealizedPnl: 1000,
    margin: 1000,
    contractSize: 1,
    openedAt: new Date().toISOString(),
    takeProfit: null,
    stopLoss: null,
    ...overrides,
  } as Position;
}

describe("PositionsTable", () => {
  it("lists an open position with its side and size", () => {
    render(<PositionsTable positions={[makePosition()]} onClose={vi.fn()} />);
    expect(screen.getByText("BTCUSD")).toBeInTheDocument();
    expect(screen.getByText("LONG")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows the empty state with no positions", () => {
    render(<PositionsTable positions={[]} onClose={vi.fn()} />);
    expect(screen.getByText(/No open positions/i)).toBeInTheDocument();
  });

  it("closes a position through the callback", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PositionsTable positions={[makePosition()]} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledWith("pos-1");
  });

  it("explains a partial close larger than the position instead of doing nothing", async () => {
    const user = userEvent.setup();
    const onPartialClose = vi.fn();
    render(
      <PositionsTable
        positions={[makePosition()]}
        onClose={vi.fn()}
        onPartialClose={onPartialClose}
      />,
    );

    await user.click(screen.getByTitle(/partial close/i));
    await user.type(screen.getByPlaceholderText("Max 2"), "5");
    await user.click(screen.getByRole("button", { name: "Go" }));

    await waitFor(() => {
      expect(toasts.list.some((t) => /Quantity Too Large/i.test(t.title))).toBe(true);
    });
    expect(onPartialClose).not.toHaveBeenCalled();
  });

  it("accepts a valid partial close", async () => {
    const user = userEvent.setup();
    const onPartialClose = vi.fn();
    render(
      <PositionsTable
        positions={[makePosition()]}
        onClose={vi.fn()}
        onPartialClose={onPartialClose}
      />,
    );

    await user.click(screen.getByTitle(/partial close/i));
    await user.type(screen.getByPlaceholderText("Max 2"), "1");
    await user.click(screen.getByRole("button", { name: "Go" }));

    expect(onPartialClose).toHaveBeenCalledWith("pos-1", 1);
  });
});

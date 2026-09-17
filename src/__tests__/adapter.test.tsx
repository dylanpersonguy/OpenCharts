import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("terminal composition", () => {
  it("refuses to render a panel outside TerminalProvider, with a usable message", async () => {
    const { render } = await import("@testing-library/react");
    const { OrderTicket } = await import("@/terminal/panels");
    setAdapter(createDemoAdapter());

    // React logs the error it re-throws; keep the test output readable.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<OrderTicket />)).toThrow(/TerminalProvider/);
    spy.mockRestore();
  });

  it("shares one symbol across independently mounted panels", async () => {
    const { render, screen, waitFor } = await import("@testing-library/react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { TerminalProvider } = await import("@/terminal/context");
    const { OrderTicket } = await import("@/terminal/panels");
    const { useTradingStore } = await import("@/services/store");

    setAdapter(createDemoAdapter());
    useTradingStore.setState({ selectedSymbol: "ETHUSD", activeAccountId: "demo" });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TerminalProvider>
          <OrderTicket />
        </TerminalProvider>
      </QueryClientProvider>,
    );

    // The ticket reads the charted symbol from the provider, not from props.
    await waitFor(() => expect(screen.getByText(/ETHUSD/)).toBeInTheDocument());
  });
});

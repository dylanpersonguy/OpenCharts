import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hlSession } from "../session.ts";
import { DepositPanel } from "../onboarding/DepositPanel.tsx";
import { Modal } from "../onboarding/Modal.tsx";
import { SetupDialog } from "../onboarding/SetupDialog.tsx";
import { useAccountSummary } from "../onboarding/useAccountSummary.ts";
import { DEFAULT_AGENT_TTL_MS } from "../agentKey.ts";
import * as funds from "../wallet/funds.ts";
import { connectWallet, restoreWallet } from "../wallet/connect.ts";
import type { Eip6963ProviderDetail } from "../wallet/providers.ts";

vi.mock("../wallet/funds.ts", async (orig) => ({
  ...(await orig<typeof import("../wallet/funds.ts")>()),
  getArbitrumUsdcBalance: vi.fn().mockResolvedValue(100_000_000n),
  getAccountSummary: vi.fn().mockResolvedValue({ equity: 10, freeMargin: 8, marginUsed: 2, spotUsdc: 0, abstraction: "default" }),
  depositUsdc: vi.fn().mockResolvedValue("0xabcdef0123456789"),
  withdrawUsdc: vi.fn().mockResolvedValue(undefined),
  moveUsdc: vi.fn().mockResolvedValue(undefined),
}));

const USER = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;

beforeEach(() => {
  vi.clearAllMocks();
  hlSession.getState().patch({ address: null, agent: null, status: "disconnected", error: null, network: "mainnet" });
});

describe("DepositPanel confirmation", () => {
  it("never sends a deposit until the user confirms the exact amount, destination and chain", async () => {
    hlSession.getState().patch({ address: USER, status: "ready" });
    render(<DepositPanel />);
    await userEvent.type(screen.getByLabelText(/deposit amount/i), "10");
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    expect(funds.depositUsdc).not.toHaveBeenCalled();
    const box = screen.getByRole("group", { name: /confirm action/i });
    expect(box).toHaveTextContent("10 USDC");
    expect(box).toHaveTextContent(funds.BRIDGE_ADDRESS.mainnet);
    expect(box).toHaveTextContent("Arbitrum One");
    await userEvent.click(screen.getByRole("button", { name: /confirm deposit/i }));
    await waitFor(() => expect(funds.depositUsdc).toHaveBeenCalledTimes(1));
  });
  it("shows the destination wallet for a withdrawal and can be cancelled", async () => {
    hlSession.getState().patch({ address: USER, status: "ready" });
    render(<DepositPanel />);
    await userEvent.type(screen.getByLabelText(/withdraw amount/i), "5");
    await waitFor(() => expect(screen.getByRole("button", { name: "Withdraw" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(screen.getByRole("group", { name: /confirm action/i })).toHaveTextContent(USER);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(funds.withdrawUsdc).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: /confirm action/i })).toBeNull();
  });
  it("drops a pending confirmation when the account changes", async () => {
    hlSession.getState().patch({ address: USER, status: "ready" });
    render(<DepositPanel />);
    await userEvent.type(screen.getByLabelText(/deposit amount/i), "10");
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    act(() => hlSession.getState().patch({ address: OTHER }));
    expect(screen.queryByRole("group", { name: /confirm action/i })).toBeNull();
  });
  it("rejects more than 6 decimals in the deposit box", async () => {
    hlSession.getState().patch({ address: USER, status: "ready" });
    render(<DepositPanel />);
    await userEvent.type(screen.getByLabelText(/deposit amount/i), "5.0000001");
    expect(screen.getByRole("button", { name: "Deposit" })).toBeDisabled();
  });
  it("validates the transfer amount before enabling Move", async () => {
    hlSession.getState().patch({ address: USER, status: "ready" });
    render(<DepositPanel />);
    await userEvent.type(screen.getByLabelText(/transfer amount/i), "abc");
    expect(screen.getByRole("button", { name: "Move" })).toBeDisabled();
  });
});

describe("Modal focus", () => {
  it("does not steal focus when the parent re-renders with a new onClose", async () => {
    function Host() {
      const [n, setN] = useState(0);
      return (
        <Modal open title="T" onClose={() => setN(n)}>
          <input aria-label="a" />
          <input aria-label="b" />
          <button onClick={() => setN(n + 1)}>bump</button>
        </Modal>
      );
    }
    render(<Host />);
    await userEvent.click(screen.getByLabelText("b"));
    await userEvent.click(screen.getByRole("button", { name: "bump" }));
    screen.getByLabelText("b").focus();
    await userEvent.click(screen.getByRole("button", { name: "bump" }));
    // After re-renders the focus must still be where the user left it (the bump button), not reset to the first field.
    expect(screen.getByLabelText("a")).not.toHaveFocus();
  });
});

describe("useAccountSummary", () => {
  it("does not show the previous account's balance after a switch", async () => {
    const getSummary = vi.mocked(funds.getAccountSummary);
    getSummary.mockResolvedValueOnce({ equity: 111, freeMargin: 111, marginUsed: 0, spotUsdc: 0, abstraction: "default" });
    getSummary.mockImplementationOnce(() => new Promise(() => undefined));
    hlSession.getState().patch({ address: USER });
    function Probe() {
      const { summary } = useAccountSummary();
      return <div data-testid="eq">{summary ? summary.equity : "none"}</div>;
    }
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("eq")).toHaveTextContent("111"));
    act(() => hlSession.getState().patch({ address: OTHER }));
    expect(screen.getByTestId("eq")).toHaveTextContent("none");
  });
});

describe("SetupDialog copy", () => {
  it("states the real key lifetime from the constant, and does not promise auto-renewal", () => {
    render(<SetupDialog open onClose={() => undefined} />);
    const days = Math.round(DEFAULT_AGENT_TTL_MS / 86_400_000);
    expect(screen.getByText(new RegExp(`expires after ${days} days`))).toBeInTheDocument();
    expect(screen.queryByText(/renewed automatically/i)).toBeNull();
  });
});

describe("connect / restore", () => {
  const mk = (name: string): Eip6963ProviderDetail => ({
    info: { uuid: name, name, icon: "", rdns: name },
    provider: { request: vi.fn().mockResolvedValue("0xa4b1"), on: vi.fn(), removeListener: vi.fn() },
  });

  it("concurrent connectWallet calls issue one eth_requestAccounts", async () => {
    const d = mk("A");
    let release!: () => void;
    (d.provider.request as ReturnType<typeof vi.fn>).mockImplementation(({ method }: { method: string }) =>
      method === "eth_requestAccounts" ? new Promise((r) => (release = () => r([USER]))) : Promise.resolve("0xa4b1"),
    );
    const a = connectWallet(d);
    const b = connectWallet(d);
    await waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    await Promise.allSettled([a, b]);
    const calls = (d.provider.request as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[0] as { method: string }).method === "eth_requestAccounts",
    );
    expect(calls).toHaveLength(1);
  });
  it("restoreWallet does not fall back to a different wallet than the remembered one", async () => {
    localStorage.setItem("openbroker:hl:wallet", "Rabby");
    const other = mk("MetaMask");
    (other.provider.request as ReturnType<typeof vi.fn>).mockResolvedValue([OTHER]);
    const handler = (): void => {
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: other }));
    };
    window.addEventListener("eip6963:requestProvider", handler);
    await expect(restoreWallet()).resolves.toBeNull();
    window.removeEventListener("eip6963:requestProvider", handler);
    expect(hlSession.getState().address).toBeNull();
    localStorage.clear();
  });
});

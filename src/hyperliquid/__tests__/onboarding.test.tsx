import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hlSession } from "../session.ts";
import { feeDisclosure } from "../onboarding/feeCopy.ts";
import { SetupDialog } from "../onboarding/SetupDialog.tsx";
import { DepositPanel } from "../onboarding/DepositPanel.tsx";
import { ConnectButton } from "../onboarding/ConnectButton.tsx";

vi.mock("../wallet/funds.ts", async (orig) => ({
  ...(await orig<typeof import("../wallet/funds.ts")>()),
  getArbitrumUsdcBalance: vi.fn().mockResolvedValue(100_000_000n),
  getAccountSummary: vi.fn().mockResolvedValue({ equity: 10, freeMargin: 8, marginUsed: 2, spotUsdc: 0, abstraction: "default" }),
}));

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

beforeEach(() => {
  hlSession.getState().patch({ address: null, agent: null, status: "disconnected", error: null });
});

describe("feeDisclosure", () => {
  it("states the percentage and a worked example from config", () => {
    const f = feeDisclosure();
    expect(f.percent).toBe("0.1%");
    expect(f.sentence).toContain("On a $1,000 trade you pay $1.00");
  });
});

describe("SetupDialog", () => {
  it("is an accessible dialog listing the steps and the fee", () => {
    render(<SetupDialog open onClose={() => undefined} />);
    expect(screen.getByRole("dialog", { name: /set up trading/i })).toBeInTheDocument();
    expect(screen.getByTestId("step-1")).toHaveAttribute("data-state", "idle");
    expect(screen.getByText(/cannot withdraw funds/i)).toBeInTheDocument();
    expect(screen.getByText(/\$1\.00 to this platform/)).toBeInTheDocument();
  });
  it("marks steps from session status and closes on Escape", async () => {
    hlSession.getState().patch({ address: USER, status: "needs-builder-approval" });
    const onClose = vi.fn();
    render(<SetupDialog open onClose={onClose} />);
    expect(screen.getByTestId("step-1")).toHaveAttribute("data-state", "done");
    expect(screen.getByTestId("step-2")).toHaveAttribute("data-state", "done");
    expect(screen.getByTestId("step-3")).toHaveAttribute("data-state", "idle");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("DepositPanel", () => {
  it("prompts to connect when disconnected", () => {
    render(<DepositPanel />);
    expect(screen.getByText(/connect your wallet/i)).toBeInTheDocument();
  });
  it("blocks deposits below the 5 USDC minimum", async () => {
    hlSession.getState().patch({ address: USER, status: "ready" });
    render(<DepositPanel />);
    const btn = screen.getByRole("button", { name: "Deposit" });
    expect(btn).toBeDisabled();
    const input = screen.getByLabelText(/deposit amount/i);
    await userEvent.type(input, "2");
    expect(btn).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Minimum deposit is 5 USDC/);
    await userEvent.clear(input);
    await userEvent.type(input, "10");
    expect(btn).toBeEnabled();
  });
});

describe("ConnectButton", () => {
  it("shows a labelled connect button when disconnected", () => {
    render(<ConnectButton />);
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
  });
  it("shows address and a menu with disconnect when connected", async () => {
    hlSession.getState().patch({ address: USER, status: "ready" });
    render(<ConnectButton />);
    await userEvent.click(screen.getByRole("button", { name: /wallet 0x1111/i }));
    expect(screen.getByRole("menuitem", { name: "Disconnect" })).toBeInTheDocument();
  });
});

import { expect, test, BUILDER_ADDRESS, MAX_FEE_RATE } from "./support/fixtures.ts";
import { selectSymbol, waitForTerminal } from "./support/app.ts";

const ARBITRUM_SEPOLIA = 421614;

test.describe("wallet connect and one-time setup", () => {
  test("connect opens the setup dialog; approveAgent + approveBuilderFee are signed with the configured fee", async ({ page, hl }) => {
    await hl.open();
    await waitForTerminal(page);
    await page.getByRole("button", { name: "Connect wallet" }).first().click();

    const dialog = page.getByRole("dialog", { name: "Set up trading" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Connected as 0xf39f");
    // Disclosure text in the dialog matches the configured fee (0.05% => $0.50 on $1,000).
    await expect(dialog).toContainText(`maximum fee of ${MAX_FEE_RATE} per trade side`);
    await expect(dialog).toContainText("$0.50");
    await expect(dialog).toContainText("cannot withdraw funds");

    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByTestId("step-2")).toHaveAttribute("data-state", "done");
    await expect(dialog.getByTestId("step-3")).toHaveAttribute("data-state", "done");

    // The wallet was moved to Arbitrum Sepolia (the wallet started on chain 1 and refuses a mismatched domain).
    expect(hl.wallet.requests.map((r) => r.method)).toContain("wallet_switchEthereumChain");
    expect(parseInt(hl.wallet.chain, 16)).toBe(ARBITRUM_SEPOLIA);

    const agentSigs = hl.wallet.signed("HyperliquidTransaction:ApproveAgent");
    const feeSigs = hl.wallet.signed("HyperliquidTransaction:ApproveBuilderFee");
    expect(agentSigs).toHaveLength(1);
    expect(feeSigs).toHaveLength(1);
    expect(agentSigs[0]?.typedData?.domain.chainId).toBe(ARBITRUM_SEPOLIA);
    expect(feeSigs[0]?.typedData?.domain.chainId).toBe(ARBITRUM_SEPOLIA);
    expect(feeSigs[0]?.typedData?.message).toMatchObject({ maxFeeRate: MAX_FEE_RATE, builder: BUILDER_ADDRESS, hyperliquidChain: "Testnet" });
    expect(String(agentSigs[0]?.typedData?.message.agentName)).toMatch(/^OpenBroker valid_until \d{13}$/);

    // The exchange verified the REAL signatures: they recover to the wallet.
    const [agentAction] = hl.fake.actionsOfType("approveAgent");
    const [feeAction] = hl.fake.actionsOfType("approveBuilderFee");
    expect(agentAction?.signatureValid).toBe(true);
    expect(feeAction?.signatureValid).toBe(true);
    expect(feeAction?.action).toMatchObject({ maxFeeRate: MAX_FEE_RATE, builder: BUILDER_ADDRESS });

    await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(dialog).toHaveCount(0);
    // The ticket is now live: the "Enable trading" call to action is gone.
    await selectSymbol(page, "xyz:EUR");
    await expect(page.getByRole("button", { name: "Enable trading" })).toHaveCount(0);
  });

  test("the agent key is NOT the wallet: only the approved agent address signs orders", async ({ page, hl }) => {
    await hl.open();
    await waitForTerminal(page);
    await page.getByRole("button", { name: "Connect wallet" }).first().click();
    await page.getByRole("dialog", { name: "Set up trading" }).getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("step-3")).toHaveAttribute("data-state", "done");
    const [agentAction] = hl.fake.actionsOfType("approveAgent");
    expect(String(agentAction?.action.agentAddress).toLowerCase()).not.toBe(hl.wallet.address);
    // Wallet requests contain no order signing: only typed-data for the two approvals.
    expect(hl.wallet.signed("HyperliquidTransaction:ApproveAgent")).toHaveLength(1);
    expect(hl.wallet.requests.filter((r) => r.method === "eth_signTypedData_v4")).toHaveLength(2);
  });

  test("rejecting the wallet signature is handled and can be retried", async ({ page, hl }) => {
    await hl.open();
    await waitForTerminal(page);
    await page.getByRole("button", { name: "Connect wallet" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Set up trading" });
    hl.wallet.rejectNextSignature = true;
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("alert")).toContainText(/rejected the request/i);
    expect(hl.fake.actionsOfType("approveAgent")).toHaveLength(0);
    await dialog.getByRole("button", { name: "Retry" }).click();
    await expect(dialog.getByTestId("step-3")).toHaveAttribute("data-state", "done");
    expect(hl.fake.actionsOfType("approveAgent")).toHaveLength(1);
  });

  test("a returning user with an approved agent and fee skips setup after reload", async ({ page, hl }) => {
    await hl.open();
    await waitForTerminal(page);
    await page.getByRole("button", { name: "Connect wallet" }).first().click();
    await page.getByRole("dialog", { name: "Set up trading" }).getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("step-3")).toHaveAttribute("data-state", "done");
    await page.getByRole("dialog", { name: "Set up trading" }).getByRole("button", { name: "Close", exact: true }).last().click();

    await page.reload();
    await waitForTerminal(page);
    await expect(page.getByRole("button", { name: /^Wallet 0x/ })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Set up trading" })).toHaveCount(0);
    await expect(page.getByText("Setup needed")).toHaveCount(0);
    expect(hl.fake.actionsOfType("approveAgent")).toHaveLength(1); // no second approval
  });
});

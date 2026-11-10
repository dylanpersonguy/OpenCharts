import { expect, test } from "./support/fixtures.ts";
import { connectAndSetup, selectSymbol, setSize, submitOrder, waitForTerminal } from "./support/app.ts";

test.describe("remote fee config (kill switch) and fee re-approval", () => {
  test("kill switch (enabled:false): the banner shows and orders carry NO builder", async ({ page, hl }) => {
    hl.feeConfig = { enabled: false, message: "Platform fee paused for maintenance" };
    await hl.open();
    await waitForTerminal(page);
    await expect(page.getByTestId("fee-banner")).toHaveText("Platform fee paused for maintenance");

    await selectSymbol(page, "xyz:EUR");
    await connectAndSetup(page, hl);
    // With the fee off there is nothing to approve.
    expect(hl.fake.actionsOfType("approveBuilderFee")).toHaveLength(0);

    await setSize(page, "10");
    await submitOrder(page, "Buy");
    await expect.poll(() => hl.fake.orderActions().length).toBe(1);
    for (const o of hl.fake.orderActions()) expect(o.builder).toBeUndefined();
    // The ticket's own disclosure says there is no platform fee.
    await expect(page.getByTestId("fee-disclosure")).toContainText(/No platform fee/i);
  });

  test("a lower remote fee is what gets approved and sent (feeTenthsBp override)", async ({ page, hl }) => {
    hl.feeConfig = { enabled: true, feeTenthsBp: 30, message: "Fees cut to 0.03%" };
    await hl.open();
    await waitForTerminal(page);
    await expect(page.getByTestId("fee-banner")).toContainText("0.03%");
    await selectSymbol(page, "xyz:EUR");
    await connectAndSetup(page, hl);
    expect(hl.fake.actionsOfType("approveBuilderFee")[0]?.action.maxFeeRate).toBe("0.03%");
    await setSize(page, "10");
    await submitOrder(page, "Buy");
    await expect.poll(() => hl.fake.orderActions().length).toBe(1);
    expect(hl.fake.orderActions()[0]?.builder?.f).toBe(30);
  });

  test("an unreachable fee-config keeps the configured fee (fail-open on fetch errors)", async ({ page, hl }) => {
    hl.feeConfig = null; // HTTP 503
    await hl.open();
    await waitForTerminal(page);
    await selectSymbol(page, "xyz:EUR");
    await connectAndSetup(page, hl);
    await setSize(page, "10");
    await submitOrder(page, "Buy");
    await expect.poll(() => hl.fake.orderActions().length).toBe(1);
    expect(hl.fake.orderActions()[0]?.builder?.f).toBe(50);
  });

  test("builder-approval rejection reopens setup so the user can re-approve, then trading resumes", async ({ page, hl }) => {
    await hl.open();
    await waitForTerminal(page);
    await selectSymbol(page, "xyz:EUR");
    await connectAndSetup(page, hl);

    // The operator raised the fee: Hyperliquid no longer honours the old approval.
    hl.fake.revokeBuilderApproval();
    await setSize(page, "10");
    await submitOrder(page, "Buy");

    const dialog = page.getByRole("dialog", { name: "Fee settings changed" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("No order was placed");
    expect(hl.fake.position("xyz:EUR")).toBeUndefined();

    await dialog.getByRole("button", { name: "Review and approve" }).click();
    const setup = page.getByRole("dialog", { name: "Set up trading" });
    await expect(setup).toBeVisible();
    await setup.getByRole("button", { name: /^(Continue|Retry)$/ }).click();
    await expect(setup.getByTestId("step-3")).toHaveAttribute("data-state", "done");
    expect(hl.fake.actionsOfType("approveBuilderFee")).toHaveLength(2);
    await setup.getByRole("button", { name: "Close", exact: true }).last().click();

    await submitOrder(page, "Buy");
    await expect.poll(() => hl.fake.position("xyz:EUR")?.szi).toBe(10);
  });
});

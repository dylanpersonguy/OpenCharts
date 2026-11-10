import { expect, test } from "./support/fixtures.ts";
import { waitForTerminal } from "./support/app.ts";

test.describe("compliance gate (geo + terms)", () => {
  test("a blocked region sees the block page and nothing connects to Hyperliquid", async ({ page, hl }) => {
    hl.geo = { allowed: false, country: "XX" };
    await hl.open();
    await expect(page.getByRole("alert").filter({ hasText: "Not available in your region" })).toBeVisible();
    await expect(page.getByTestId("hl-topbar")).toHaveCount(0);
    // The terminal (and so every market-data connection) was never mounted.
    await page.waitForTimeout(800);
    expect(hl.fake.info).toHaveLength(0);
    expect(hl.fake.wsSubscriptions).toHaveLength(0);
  });

  test("an unreachable geo endpoint fails closed", async ({ page, hl }) => {
    hl.geo = null;
    await hl.open();
    await expect(page.getByRole("alert").filter({ hasText: "Not available in your region" })).toBeVisible();
    expect(hl.fake.info).toHaveLength(0);
  });

  test("the terms dialog appears first, cannot be dismissed, and unlocks only after every box is ticked", async ({ page, hl }) => {
    hl.termsAccepted = false;
    await hl.open();
    const dialog = page.getByRole("dialog", { name: "Before you trade" });
    await expect(dialog).toBeVisible();

    // Not dismissible.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();

    const boxes = dialog.getByRole("checkbox");
    const total = await boxes.count();
    expect(total).toBeGreaterThan(0);
    const accept = dialog.getByRole("button").last();
    await expect(accept).toBeDisabled();
    for (let i = 0; i < total; i++) {
      await boxes.nth(i).check();
      if (i < total - 1) await expect(accept).toBeDisabled();
    }
    await expect(accept).toBeEnabled();
    await accept.click();
    await expect(dialog).toHaveCount(0);
    await waitForTerminal(page);

    // Remembered: a reload does not ask again.
    await page.reload();
    await waitForTerminal(page);
    await expect(page.getByRole("dialog", { name: "Before you trade" })).toHaveCount(0);
  });

  test("an allowed region passes straight through to the terminal", async ({ page, hl }) => {
    await hl.open();
    await waitForTerminal(page);
    await expect(page.getByText("Not available in your region")).toHaveCount(0);
  });
});

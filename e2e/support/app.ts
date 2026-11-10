/**
 * Page helpers. Everything is found by role, label or visible text (the only
 * data-testids used are ones the app deliberately exposes: fee-disclosure,
 * fee-banner, step-N), so cosmetic UI changes do not break the suite.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import type { Harness } from "./fixtures.ts";

/** The symbol dropdown renders a mobile and a desktop copy; only one is visible. */
export const visibleButton = (page: Page, name: string | RegExp): Locator =>
  page.getByRole("button", { name }).filter({ visible: true });

/** Wait until the terminal has loaded markets (the symbol picker lists them). */
export async function waitForTerminal(page: Page): Promise<void> {
  await expect(page.getByTestId("hl-topbar")).toBeVisible();
  await expect(page.getByRole("button", { name: /Connect wallet|Wallet 0x/ }).first()).toBeVisible();
}

export async function openSymbolPicker(page: Page): Promise<void> {
  // The toolbar's symbol button is labelled with the current symbol (BTCUSD is the pre-load placeholder).
  await page.getByRole("button", { name: /^(BTCUSD|BTC|ETH|xyz:[A-Z0-9]+)$/ }).filter({ visible: true }).first().click();
  await expect(page.getByPlaceholder("Search symbols...").filter({ visible: true })).toBeVisible();
}

export async function selectSymbol(page: Page, symbol: string): Promise<void> {
  await openSymbolPicker(page);
  await visibleButton(page, new RegExp(`^${symbol.replace(/[:.]/g, "\\$&")}\\b`)).click();
  await expect(page.getByPlaceholder("Search symbols...").filter({ visible: true })).toHaveCount(0);
}

/** Connect the fake wallet and walk the setup dialog to the end (agent + builder fee approved). */
export async function connectAndSetup(page: Page, hl: Harness): Promise<void> {
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Set up trading" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^(Continue|Retry)$/ }).click();
  await expect(dialog.getByTestId("step-2")).toHaveAttribute("data-state", "done");
  await expect(dialog.getByTestId("step-3")).toHaveAttribute("data-state", "done");
  await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(dialog).toHaveCount(0);
  expect(hl.wallet.signed("HyperliquidTransaction:ApproveAgent")).toHaveLength(1);
}

export async function setSize(page: Page, value: string): Promise<void> {
  await page.getByLabel(/^Size/).fill(value);
}

/** Press the ticket's primary button and confirm in the order dialog if the terminal shows one. */
export async function submitOrder(page: Page, side: "Buy" | "Sell"): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${side}\\b`) }).filter({ visible: true }).last().click();
  const confirm = page.getByRole("button", { name: /^Confirm (BUY|SELL)/ });
  try {
    await confirm.waitFor({ state: "visible", timeout: 2500 });
    await confirm.click();
  } catch {
    /* one-click mode or no confirmation step */
  }
}

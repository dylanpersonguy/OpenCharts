import { expect, test, BUILDER_ADDRESS, BUILDER_FEE, type Harness } from "./support/fixtures.ts";
import { connectAndSetup, selectSymbol, setSize, submitOrder, waitForTerminal } from "./support/app.ts";
import type { OrderActionBody } from "./support/fakeHyperliquid.ts";
import type { Page } from "@playwright/test";

/** xyz:EUR is asset index 0 on dex #1 => 100000 + 1*10000 + 0. */
const EUR_ASSET_ID = 110_000;

async function readyOnEur(page: Page, hl: Harness): Promise<void> {
  await hl.open();
  await waitForTerminal(page);
  await selectSymbol(page, "xyz:EUR");
  await connectAndSetup(page, hl);
  await expect(page.getByRole("button", { name: /^(Buy|Sell)\b/ }).filter({ visible: true }).last()).toBeVisible();
}

function expectBuilderOnEveryOrder(hl: Harness): void {
  const orders = hl.fake.orderActions();
  expect(orders.length).toBeGreaterThan(0);
  for (const o of orders) {
    expect(o.builder, `order action ${JSON.stringify(o.orders.map((w) => w.a))} must carry a builder`).toBeDefined();
    expect(o.builder?.b).toBe(BUILDER_ADDRESS);
    expect(o.builder?.f).toBe(BUILDER_FEE);
    expect(o.builder?.f).toBeLessThanOrEqual(100);
  }
}

test.describe("trading a HIP-3 Forex market (xyz:EUR)", () => {
  test("market order: isolated leverage is set first, then the order carries the builder", async ({ page, hl }) => {
    await readyOnEur(page, hl);
    await setSize(page, "10"); // 10 EUR at 1.15 = $11.5 (>= $10 minimum)
    await submitOrder(page, "Buy");

    await expect.poll(() => hl.fake.orderActions().length).toBe(1);
    await expect(page.getByText("Order sent")).toBeVisible();

    const order = hl.fake.orderActions()[0] as OrderActionBody;
    expect(order.grouping).toBe("na");
    expect(order.orders).toHaveLength(1);
    expect(order.orders[0]).toMatchObject({ a: EUR_ASSET_ID, b: true, r: false, t: { limit: { tif: "Ioc" } } });
    expect(order.orders[0]?.s).toBe("10");
    expectBuilderOnEveryOrder(hl);

    // updateLeverage (isolated) happened BEFORE the order, for the same asset.
    const types = hl.fake.exchange.map((e) => e.action.type);
    const lev = types.indexOf("updateLeverage");
    expect(lev).toBeGreaterThanOrEqual(0);
    expect(lev).toBeLessThan(types.indexOf("order"));
    expect(hl.fake.actionsOfType("updateLeverage")[0]?.action).toMatchObject({ asset: EUR_ASSET_ID, isCross: false });

    // The agent signed (not the wallet), and the fill carries the builder fee on the exchange side.
    expect(hl.fake.exchange.filter((e) => e.action.type === "order").every((e) => e.hasSignature)).toBe(true);
    const fill = hl.fake.allFills().at(-1);
    expect(Number(fill?.builderFee)).toBeCloseTo((Number(fill?.px) * Number(fill?.sz) * BUILDER_FEE) / 100_000, 6);

    // The position appears in the UI.
    await expect(page.getByRole("tab", { name: /Positions/ }).or(page.getByText("Positions", { exact: true })).first()).toBeVisible();
    await expect(page.getByText("No open positions")).toHaveCount(0);
  });

  test("take profit and stop loss are grouped (normalTpsl) and carry the builder", async ({ page, hl }) => {
    await readyOnEur(page, hl);
    await setSize(page, "10");
    await page.getByLabel("Take profit").fill("1.2");
    await page.getByLabel("Stop loss").fill("1.1");
    await submitOrder(page, "Buy");

    await expect.poll(() => hl.fake.orderActions().length).toBe(1);
    const order = hl.fake.orderActions()[0] as OrderActionBody;
    expect(order.grouping).toBe("normalTpsl");
    expect(order.orders).toHaveLength(3);
    const [entry, tp, sl] = order.orders;
    expect(entry?.t.limit?.tif).toBe("Ioc");
    expect(tp).toMatchObject({ b: false, r: true, t: { trigger: { tpsl: "tp", triggerPx: "1.2" } } });
    expect(sl).toMatchObject({ b: false, r: true, t: { trigger: { tpsl: "sl", triggerPx: "1.1" } } });
    expectBuilderOnEveryOrder(hl);
    // Both protective orders rest on the book.
    expect(hl.fake.restingOrders().filter((o) => o.trigger)).toHaveLength(2);
  });

  test("closing a position sends a reduce-only order that also carries the builder", async ({ page, hl }) => {
    await readyOnEur(page, hl);
    await setSize(page, "10");
    await submitOrder(page, "Buy");
    await expect.poll(() => hl.fake.position("xyz:EUR")?.szi).toBe(10);

    await page.getByRole("button", { name: /^Close$/ }).filter({ visible: true }).first().click();
    // A confirmation may be shown before closing.
    const confirm = page.getByRole("button", { name: /^(Confirm|Close position|Yes)/ }).filter({ visible: true });
    if (await confirm.first().isVisible().catch(() => false)) await confirm.first().click();

    await expect.poll(() => hl.fake.position("xyz:EUR")).toBeUndefined();
    const orders = hl.fake.orderActions();
    expect(orders).toHaveLength(2);
    expect(orders[1]?.orders[0]).toMatchObject({ a: EUR_ASSET_ID, b: false, r: true });
    expectBuilderOnEveryOrder(hl);
    await expect(page.getByText("No open positions")).toBeVisible();
  });

  test("below-minimum orders are stopped in the ticket and never reach the exchange", async ({ page, hl }) => {
    await readyOnEur(page, hl);
    await setSize(page, "5"); // 5 EUR = $5.75 < $10
    await expect(page.getByTestId("size-help")).toContainText(/minimum/i);
    await expect(page.getByRole("button", { name: /^Buy\b/ }).filter({ visible: true }).last()).toBeDisabled();
    expect(hl.fake.orderActions()).toHaveLength(0);
  });
});

import { expect, test, MAX_FEE_RATE } from "./support/fixtures.ts";
import { openSymbolPicker, selectSymbol, waitForTerminal } from "./support/app.ts";

test.describe("terminal (mocked Hyperliquid testnet)", () => {
  test("loads and lists markets by category, including Forex", async ({ page, hl }) => {
    await hl.open();
    await waitForTerminal(page);
    await expect(page.getByTestId("hl-topbar").getByText(/^testnet$/i)).toBeVisible();
    await openSymbolPicker(page);

    // Each dropdown row reads "<symbol>[<display name>]<category>".
    const row = (symbol: string, category: string) =>
      page.getByRole("button", { name: new RegExp(`^${symbol}\\s*(?:[A-Za-z0-9/ .:-]+?\\s*)?${category}$`) }).filter({ visible: true });
    await expect(row("BTC", "Crypto")).toBeVisible();
    await expect(row("xyz:EUR", "Forex")).toBeVisible();
    await expect(row("xyz:GOLD", "Commodities")).toBeVisible();
    await expect(row("xyz:TSLA", "Stocks")).toBeVisible();

    // The registry really was built from perpDexs + meta for both dexes.
    const types = hl.fake.info.map((i) => `${String(i.type)}${typeof i.dex === "string" ? `:${i.dex}` : ""}`);
    expect(types).toEqual(expect.arrayContaining(["perpDexs", "meta", "meta:xyz"]));
  });

  test("the symbol picker shows the friendly Forex name (EUR/USD)", async ({ page, hl }) => {
    await hl.open();
    await waitForTerminal(page);
    await openSymbolPicker(page);
    await expect(page.getByText("EUR/USD").filter({ visible: true }).first()).toBeVisible();
  });

  test("charts xyz:EUR: candles are requested and painted, live ticks arrive", async ({ page, hl }) => {
    await hl.open();
    await waitForTerminal(page);
    await selectSymbol(page, "xyz:EUR");

    await expect
      .poll(() => hl.fake.info.some((i) => i.type === "candleSnapshot" && (i.req as { coin?: string } | undefined)?.coin === "xyz:EUR"))
      .toBe(true);
    await expect.poll(() => hl.fake.wsSubscriptions.some((s) => s.type === "candle" && s.coin === "xyz:EUR")).toBe(true);
    await expect.poll(() => hl.fake.wsSubscriptions.some((s) => s.type === "bbo" && s.coin === "xyz:EUR")).toBe(true);

    // Live quote from the bbo stream (bid 1.14989 / ask 1.15011 in the fake).
    await expect(page.getByText("1.15012").first()).toBeVisible();

    // The lightweight-charts canvas actually contains candle-coloured pixels.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const isCandle = (r: number, g: number, b: number, a: number) =>
            a > 200 && ((g > 150 && r < 60 && b > 80 && b < 160) || (r > 200 && g < 100 && b < 120));
          for (const c of Array.from(document.querySelectorAll("canvas"))) {
            const ctx = c.getContext("2d");
            if (!ctx || c.width === 0 || c.height === 0) continue;
            const { data } = ctx.getImageData(0, 0, c.width, c.height);
            for (let i = 0; i < data.length; i += 4 * 7) {
              if (isCandle(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0)) return true;
            }
          }
          return false;
        }),
      )
      .toBe(true);
  });

  test("fee disclosure shows the configured platform fee and its example", async ({ page, hl }) => {
    await hl.open();
    await waitForTerminal(page);
    await selectSymbol(page, "xyz:EUR");
    const disclosure = page.getByTestId("fee-disclosure");
    await expect(disclosure).toContainText(`Platform fee ${MAX_FEE_RATE}`);
    await expect(disclosure).toContainText("charged on every fill");
    await expect(disclosure).toContainText("open a position and again when you close it");
    // HIP-3 markets get the extra warning.
    await expect(disclosure).toContainText("Third-party (HIP-3)");
  });
});

test.describe("first load", () => {
  test("opens on a real Hyperliquid market, not the demo placeholder symbol", async ({ page, hl }) => {
    await hl.open();
    await waitForTerminal(page);
    await expect(page.getByRole("button", { name: /^BTCUSD$/ }).filter({ visible: true })).toHaveCount(0);
    await expect(page.getByTestId("size-help")).not.toContainText("Loading market");
  });
});

import { test as base, expect, type Page } from "@playwright/test";
import { TERMS_STORAGE_KEY, TERMS_VERSION } from "../../src/hyperliquid/compliance/config.ts";
import { FakeHyperliquid } from "./fakeHyperliquid.ts";
import { TestWallet } from "./wallet.ts";

export interface FeeConfigBody {
  enabled: boolean;
  feeTenthsBp?: number;
  message?: string;
}
export interface GeoBody {
  allowed: boolean;
  country?: string;
}

export interface Harness {
  fake: FakeHyperliquid;
  wallet: TestWallet;
  /** Answer for /__e2e/fee-config. Set BEFORE `open()`. `null` = HTTP 503. */
  feeConfig: FeeConfigBody | null;
  /** Answer for /__e2e/geo. Set BEFORE `open()`. `null` = HTTP 503. */
  geo: GeoBody | null;
  /** Whether the terms acknowledgement is pre-accepted in localStorage. Set BEFORE `open()`. */
  termsAccepted: boolean;
  /** URLs of requests that went to a host this suite forbids (mainnet, third parties). Must stay empty. */
  forbidden: string[];
  /** Navigate to the app. */
  open(): Promise<void>;
}

/** The builder address / fee the dev server is started with (playwright.config.ts). */
export const BUILDER_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
export const BUILDER_FEE = 50;
export const MAX_FEE_RATE = "0.05%";

async function guardNetwork(page: Page, forbidden: string[]): Promise<void> {
  // Lowest priority (registered first): anything that is not the local app or a data: URL is blocked and recorded.
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^(data|blob|about):/.test(url) || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) return route.fallback();
    forbidden.push(url);
    return route.abort();
  });
  await page.routeWebSocket(/^wss:\/\/api\.hyperliquid\.xyz\//, (ws) => {
    forbidden.push(ws.url());
    void ws.close();
  });
}

export const test = base.extend<{ hl: Harness }>({
  hl: async ({ page }, run) => {
    const wallet = new TestWallet();
    const fake = new FakeHyperliquid({ walletAddress: wallet.account.address });
    const h: Harness = {
      fake,
      wallet,
      feeConfig: { enabled: true },
      geo: { allowed: true, country: "US" },
      termsAccepted: true,
      forbidden: [],
      open: async () => {
        if (h.termsAccepted) {
          await page.addInitScript(
            ({ key, version }) => {
              try {
                localStorage.setItem(key, JSON.stringify({ version, acceptedAt: Date.now() }));
              } catch {
                /* storage unavailable */
              }
            },
            { key: TERMS_STORAGE_KEY, version: TERMS_VERSION },
          );
        }
        await page.goto("/");
      },
    };
    // Order matters: the catch-all guard first, specific routes after (later routes win).
    await guardNetwork(page, h.forbidden);
    await fake.install(page);
    await wallet.install(page);
    await page.route("**/__e2e/fee-config", (route) =>
      h.feeConfig === null
        ? route.fulfill({ status: 503, body: "unavailable" })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(h.feeConfig) }),
    );
    await page.route("**/__e2e/geo", (route) =>
      h.geo === null
        ? route.fulfill({ status: 503, body: "unavailable" })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(h.geo) }),
    );
    await run(h);
    fake.dispose();
    expect(h.forbidden, "no request may leave the sandbox (mainnet or third party)").toEqual([]);
  },
});

export { expect };

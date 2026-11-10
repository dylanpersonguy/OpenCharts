import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end tests for the Hyperliquid broker, run against a
 * deterministic fake Hyperliquid (see e2e/support/fakeHyperliquid.ts). No test
 * touches a real network: `npm run e2e:hl`.
 */
const PORT = 5199;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_ADAPTER: "hyperliquid",
      VITE_HL_NETWORK: "testnet",
      VITE_HL_BUILDER_ADDRESS: "0x1234567890abcdef1234567890abcdef12345678",
      VITE_HL_BUILDER_FEE: "50",
      // Same-origin paths so the page needs no CORS; the tests answer them.
      VITE_FEE_CONFIG_URL: "/__e2e/fee-config",
      VITE_GEO_CHECK_URL: "/__e2e/geo",
      VITE_GEO_FAIL_MODE: "closed",
      VITE_BLOCKED_COUNTRIES: "",
      VITE_SCREEN_URL: "",
    },
  },
});

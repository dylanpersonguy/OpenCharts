import { describe, it } from "vitest";
import { runAdapterConformance } from "@/adapter/conformance";
import { createBinancePaperAdapter } from "../../examples/binance-adapter/binance-adapter";

/**
 * Runs the conformance suite against the real Binance API.
 *
 * Opt-in (`OC_LIVE_TESTS=1 npm run test`) so CI stays hermetic and nobody's
 * pull request fails because an exchange was slow, rate-limited the runner, or
 * is unavailable in its region.
 *
 * Trading checks stay off: the example pairs the live feed with the local
 * paper engine, and the engine is already covered elsewhere.
 */
if (import.meta.env?.OC_LIVE_TESTS === "1" || import.meta.env?.VITE_LIVE_TESTS === "1") {
  runAdapterConformance("binance (live)", () => createBinancePaperAdapter({ symbols: ["BTCUSD"] }), {
    symbol: "BTCUSD",
    timeframe: "1m",
    tickTimeoutMs: 15_000,
    allowTrading: false,
  });
} else {
  describe("adapter conformance: binance (live)", () => {
    it.skip("set OC_LIVE_TESTS=1 to run against the real API", () => {});
  });
}

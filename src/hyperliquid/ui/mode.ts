import { getAdapter, hasAdapter } from "../../adapter/registry.ts";
import type { HyperliquidTrading } from "../trading.ts";
import type { InfoClient } from "../info.ts";
import type { MarketRegistry } from "../types.ts";

/**
 * Whether the terminal is currently running against the Hyperliquid adapter.
 *
 * Shared panels (order ticket, watchlist, tables, banners) use this to pick the
 * Hyperliquid variant. It deliberately imports only the adapter registry (and a
 * TYPE from trading.ts), so referencing it from shared code never drags the
 * Hyperliquid runtime into the default demo bundle.
 */
export const HYPERLIQUID_ADAPTER_NAME = "hyperliquid";

export function isHyperliquidMode(): boolean {
  return hasAdapter() && getAdapter().name === HYPERLIQUID_ADAPTER_NAME;
}

/** The Hyperliquid trading gateway (with leverage controls), or null in other modes. */
export function getHlTrading(): HyperliquidTrading | null {
  if (!isHyperliquidMode()) return null;
  const t = getAdapter().trading;
  return t && "setLeverage" in t && "getLeverage" in t ? (t as HyperliquidTrading) : null;
}

/** The loaded market registry, or null outside Hyperliquid mode. */
export function getHlRegistry(): MarketRegistry | null {
  if (!isHyperliquidMode()) return null;
  const md = getAdapter().marketData as { registry?: MarketRegistry };
  return md.registry ?? null;
}

/** The REST info client used for market data, or null outside Hyperliquid mode. */
export function getHlInfo(): InfoClient | null {
  if (!isHyperliquidMode()) return null;
  const md = getAdapter().marketData as { info?: InfoClient };
  return md.info ?? null;
}

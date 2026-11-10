import type { Address } from "./config.ts";

/**
 * One tradable Hyperliquid perp market, normalised for the terminal.
 * `symbol` is the exact string used as OpenCharts `Symbol.name` everywhere
 * (candles, ticks, orders, positions): it is the Hyperliquid coin name,
 * "BTC" for the core dex, "xyz:EUR" for HIP-3 dexes. It is at most 20 chars.
 */
export interface HlMarket {
  symbol: string;
  /** Same as `symbol`; the name HL APIs expect in `coin` fields. */
  coin: string;
  /** "" for the core dex, otherwise the HIP-3 dex name (e.g. "xyz"). */
  dex: string;
  /** Index of the dex in `perpDexs` (0 = core). */
  dexIndex: number;
  /** Index of the asset inside that dex's `meta.universe`. */
  indexInMeta: number;
  /** Asset id used in order actions: core = indexInMeta; HIP-3 = 100000 + dexIndex*10000 + indexInMeta. */
  assetId: number;
  szDecimals: number;
  maxLeverage: number;
  /** True when only isolated margin is allowed (onlyIsolated / strictIsolated / noCross). */
  onlyIsolated: boolean;
  /** "strictIsolated" means margin cannot be removed. */
  marginMode?: string;
  category: HlCategory;
  /** Human label, e.g. "EUR/USD", "Gold", "Tesla". */
  displayName: string;
  /** Collateral token symbol for this dex, if reported (usually "USDC"). */
  collateral?: string;
  /**
   * Multiplier on Hyperliquid's own fee for this market: 1 for core perps; for
   * HIP-3 markets 2x the deployer fee scale (see fees.ts `hip3FeeMultiplier`),
   * x0.1 under growth mode.
   */
  hlFeeMultiplier?: number;
  /** Margin tiers (from meta.marginTables): max leverage drops as position notional grows. */
  marginTiers?: { lowerBound: number; maxLeverage: number }[];
}

export type HlCategory = "Crypto" | "Stocks" | "Forex" | "Commodities" | "Indices" | "Other";

/** Read-only view over loaded markets. Owned by symbols.ts; consumed by trading. */
export interface MarketRegistry {
  load(): Promise<void>;
  markets(): HlMarket[];
  bySymbol(symbol: string): HlMarket | undefined;
}

/** Minimal account snapshot, shared by trading + UI. Values in USD. */
export interface HlAccountSnapshot {
  address: Address;
  accountValue: number;
  withdrawable: number;
  marginUsed: number;
}

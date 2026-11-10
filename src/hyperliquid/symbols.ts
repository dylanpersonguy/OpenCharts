import type { Symbol as OcSymbol } from "../services/schemas.ts";
import { hip3FeeMultiplier } from "./fees.ts";
import type { HlAssetMeta, HlMarginTable, InfoClient } from "./info.ts";
import type { HlCategory, HlMarket, MarketRegistry } from "./types.ts";

/**
 * Market registry + Hyperliquid -> OpenCharts symbol mapping + the pure
 * price/size formatters the trading code relies on.
 *
 * ASSET ID EVIDENCE (verified 2026-11):
 *  - `perpDexs` returns an array whose element 0 is `null` (the core dex) and
 *    whose elements 1..n are builder (HIP-3) dexes: live order was
 *    [null, xyz, flx, vntl, hyna, km, abcd, cash, para, mkts, io].
 *  - The official SDK (@nktkas/hyperliquid `utils/_symbolConverter.js`,
 *    `_processBuilderDexs`) maps each dex to `index` = its position in the
 *    `perpDexs` array and computes `assetId = 100000 + dexIndex * 10000 +
 *    indexInUniverse`, where `indexInUniverse` is the position inside
 *    `meta({dex}).universe`. Core dex assets use the bare universe index.
 *    e.g. xyz is dexIndex 1, xyz:EUR is universe[25] -> 110025.
 *  - Delisted assets stay in the universe (they keep their index), so indices
 *    are taken from the unfiltered array; we only skip them afterwards.
 */

export const HL_MAX_PRICE_SIG_FIGS = 5;
export const HL_MAX_PERP_DECIMALS = 6;

// ── Pure formatters ───────────────────────────────────────

function stripZeros(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}

/** Decimals allowed for a perp price of magnitude `price` (>0). */
export function allowedPriceDecimals(price: number, szDecimals: number): number {
  const maxDecimals = Math.max(0, HL_MAX_PERP_DECIMALS - szDecimals);
  if (!Number.isFinite(price) || price <= 0) return maxDecimals;
  const magnitude = Math.floor(Math.log10(price)); // 76101 -> 4, 1.11 -> 0, 0.012 -> -2
  const bySigFigs = HL_MAX_PRICE_SIG_FIGS - 1 - magnitude;
  return Math.min(maxDecimals, Math.max(0, bySigFigs));
}

/**
 * Format a price the way Hyperliquid accepts it: integers are always valid;
 * otherwise at most 5 significant figures and at most (6 - szDecimals)
 * decimals, with trailing zeros stripped.
 */
export function formatHlPrice(price: number, szDecimals: number): string {
  if (!Number.isFinite(price) || price <= 0) return "0";
  if (Number.isInteger(price)) return price.toFixed(0);
  const decimals = allowedPriceDecimals(price, szDecimals);
  return stripZeros(price.toFixed(decimals));
}

/**
 * Format an order size: round DOWN to `szDecimals` decimals (never size up),
 * strip trailing zeros. Non-positive / non-finite input yields "0".
 */
export function formatHlSize(size: number, szDecimals: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0";
  const d = Math.max(0, Math.floor(szDecimals));
  const factor = 10 ** d;
  // toPrecision(12) absorbs binary noise: 0.29 * 100 = 28.999999999999996.
  const scaled = Math.floor(Number((size * factor).toPrecision(12)));
  return stripZeros((scaled / factor).toFixed(d));
}

/** Smallest valid price increment at the given price level. */
export function priceTickSize(price: number | undefined, szDecimals: number): number {
  const decimals =
    price !== undefined && price > 0
      ? allowedPriceDecimals(price, szDecimals)
      : Math.max(0, HL_MAX_PERP_DECIMALS - szDecimals);
  return 10 ** -decimals;
}

/** Round `price` to the nearest multiple of `tick` (float-noise free). */
export function roundPriceToTick(price: number, tick: number): number {
  if (!Number.isFinite(price) || !(tick > 0)) return price;
  const decimals = Math.max(0, Math.ceil(-Math.log10(tick) - 1e-9));
  return Number((Math.round(price / tick) * tick).toFixed(decimals));
}

// ── Category + naming ─────────────────────────────────────

const FX_CODES = new Set([
  "EUR", "GBP", "JPY", "KRW", "CHF", "AUD", "NZD", "CAD", "CNH", "CNY", "MXN", "BRL",
  "INR", "SEK", "TRY", "ZAR", "SGD", "HKD", "DXY",
]);
// NOK is deliberately absent: xyz:NOK is Nokia, a stock (the API labels it so; this
// set is only the no-label fallback).
const COMMODITY_CODES = new Set([
  "GOLD", "SILVER", "PLATINUM", "PALLADIUM", "COPPER", "ALUMINIUM", "CL", "WTI", "BRENTOIL",
  "OIL", "USOIL", "NATGAS", "GAS", "HO", "CORN", "WHEAT", "SOY",
]);
const INDEX_CODES = new Set([
  "XYZ100", "SP500", "US500", "USA500", "USTECH", "JP225", "KR200", "NIFTY", "SMALL2000",
  "SEMI", "VIX", "VOL", "USENERGY", "GLDMINE", "BVIV", "EVIV",
]);

/** Map an API `perpCategories` label (case-insensitive) to our category. */
export function categoryFromLabel(label: string): HlCategory | undefined {
  switch (label.toLowerCase()) {
    case "crypto":
      return "Crypto";
    case "stock":
    case "stocks":
      return "Stocks";
    case "fx":
      return "Forex";
    case "commodity":
    case "commodities":
      return "Commodities";
    case "index":
    case "indices":
      return "Indices";
    case "preipo":
    case "rates":
      return "Other";
    default:
      return undefined;
  }
}

/** Strip the "dex:" prefix from a coin. */
export function baseName(coin: string): string {
  const i = coin.indexOf(":");
  return i >= 0 ? coin.slice(i + 1) : coin;
}

/**
 * Classify a market. Prefers the API's `perpCategories` label; falls back to
 * a static map for HIP-3 codes, and "Crypto" for the core dex.
 */
export function classifyMarket(
  coin: string,
  dex: string,
  apiLabel?: string,
): HlCategory {
  const fromApi = apiLabel ? categoryFromLabel(apiLabel) : undefined;
  if (fromApi) return fromApi;
  if (dex === "") return "Crypto";
  const base = baseName(coin).toUpperCase();
  if (FX_CODES.has(base)) return "Forex";
  if (COMMODITY_CODES.has(base)) return "Commodities";
  if (INDEX_CODES.has(base)) return "Indices";
  return "Stocks";
}

/** HL quotes these as USD/XXX (price is the foreign currency per dollar). */
const FX_USD_BASE = new Set(["JPY", "KRW", "CHF", "CAD", "CNH", "CNY", "MXN", "BRL", "INR", "SEK", "NOK", "TRY", "ZAR", "SGD", "HKD"]);

const FRIENDLY: Record<string, string> = {
  GOLD: "Gold",
  SILVER: "Silver",
  PLATINUM: "Platinum",
  PALLADIUM: "Palladium",
  COPPER: "Copper",
  ALUMINIUM: "Aluminium",
  CL: "WTI Crude Oil",
  BRENTOIL: "Brent Crude Oil",
  NATGAS: "Natural Gas",
  HO: "Heating Oil",
  CORN: "Corn",
  WHEAT: "Wheat",
  DXY: "US Dollar Index",
  XYZ100: "XYZ 100",
  SP500: "S&P 500",
  JP225: "Nikkei 225",
  KR200: "KOSPI 200",
  VIX: "VIX",
};

export function displayNameFor(coin: string, dex: string, category: HlCategory): string {
  const base = baseName(coin);
  const upper = base.toUpperCase();
  let name = base;
  if (category === "Forex" && upper !== "DXY") {
    name = FX_USD_BASE.has(upper) ? `USD/${upper}` : `${upper}/USD`;
  } else {
    name = FRIENDLY[upper] ?? base;
  }
  // The same ticker (GOLD, TSLA...) exists on several builder dexes.
  return dex !== "" && dex !== "xyz" ? `${name} (${dex})` : name;
}

// ── Registry ──────────────────────────────────────────────

export function hip3AssetId(dexIndex: number, indexInMeta: number): number {
  return dexIndex === 0 ? indexInMeta : 100000 + dexIndex * 10000 + indexInMeta;
}

export function buildMarket(
  asset: HlAssetMeta,
  dex: string,
  dexIndex: number,
  indexInMeta: number,
  apiLabel: string | undefined,
  collateral?: string,
  marginTables?: readonly [number, HlMarginTable][],
): HlMarket {
  const category = classifyMarket(asset.name, dex, apiLabel);
  const onlyIsolated =
    asset.onlyIsolated === true ||
    asset.marginMode === "strictIsolated" ||
    asset.marginMode === "noCross";
  const market: HlMarket = {
    symbol: asset.name,
    coin: asset.name,
    dex,
    dexIndex,
    indexInMeta,
    assetId: hip3AssetId(dexIndex, indexInMeta),
    szDecimals: asset.szDecimals,
    maxLeverage: asset.maxLeverage,
    onlyIsolated,
    category,
    displayName: displayNameFor(asset.name, dex, category),
  };
  market.hlFeeMultiplier =
    dex === ""
      ? 1
      : hip3FeeMultiplier({
          deployerFeeScale: asset.deployerFeeScale !== undefined ? Number(asset.deployerFeeScale) : undefined,
          growthMode: asset.growthMode === "enabled",
        });
  const table = asset.marginTableId !== undefined ? marginTables?.find(([id]) => id === asset.marginTableId)?.[1] : undefined;
  if (table && table.marginTiers.length > 0) {
    market.marginTiers = table.marginTiers
      .map((t) => ({ lowerBound: Number(t.lowerBound), maxLeverage: t.maxLeverage }))
      .filter((t) => Number.isFinite(t.lowerBound) && t.maxLeverage >= 1)
      .sort((a, b) => a.lowerBound - b.lowerBound);
  }
  if (asset.marginMode) market.marginMode = asset.marginMode;
  if (collateral) market.collateral = collateral;
  return market;
}

/** A full registry is re-read this often so new listings and delistings show up. */
const REGISTRY_REFRESH_MS = 10 * 60_000;
/** A registry missing a builder dex (it failed to load) is retried this soon. */
const REGISTRY_PARTIAL_RETRY_MS = 30_000;

export function createMarketRegistry(info: InfoClient, now: () => number = Date.now): MarketRegistry {
  let markets: HlMarket[] = [];
  let bySymbol = new Map<string, HlMarket>();
  let loading: Promise<void> | null = null;
  let settled = false;
  let loadedAt = 0;
  /** True when a builder dex failed to load, so the list is incomplete. */
  let partial = false;

  async function doLoad(): Promise<void> {
    const [dexes, categories] = await Promise.all([
      info.perpDexs(),
      info.perpCategories().catch(() => [] as [string, string][]),
    ]);
    const labels = new Map(categories);

    let missed = false;
    const results = await Promise.all(
      dexes.map(async (dex, dexIndex) => {
        const name = dex?.name ?? "";
        if (dexIndex > 0 && name === "") return [];
        try {
          const meta = await info.meta(name || undefined);
          const collateral = meta.collateralToken === undefined || meta.collateralToken === 0 ? "USDC" : undefined;
          const out: HlMarket[] = [];
          meta.universe.forEach((asset, indexInMeta) => {
            if (asset.isDelisted) return;
            out.push(buildMarket(asset, name, dexIndex, indexInMeta, labels.get(asset.name), collateral, meta.marginTables));
          });
          return out;
        } catch (err) {
          // The core dex is mandatory; a flaky builder dex must not hide everything else.
          if (dexIndex === 0) throw err;
          missed = true;
          return [];
        }
      }),
    );

    markets = results.flat();
    bySymbol = new Map(markets.map((m) => [m.symbol, m]));
    partial = missed;
  }

  return {
    load(): Promise<void> {
      const fresh =
        loading !== null && (!settled || now() - loadedAt < (partial ? REGISTRY_PARTIAL_RETRY_MS : REGISTRY_REFRESH_MS));
      if (fresh && loading) return loading;
      settled = false;
      const p: Promise<void> = doLoad()
        .then(() => {
          loadedAt = now();
          settled = true;
        })
        .catch((err: unknown) => {
          if (markets.length > 0) {
            // A refresh failed: keep serving the last good list and try again soon.
            partial = true;
            loadedAt = now();
            settled = true;
            return;
          }
          if (loading === p) loading = null; // first load: allow retry
          throw err;
        });
      loading = p;
      return p;
    },
    markets: () => markets,
    bySymbol: (symbol) => bySymbol.get(symbol),
  };
}

// ── OpenCharts mapping ────────────────────────────────────

export function marketToSymbol(m: HlMarket, midPx?: number): OcSymbol {
  const tickSize = priceTickSize(midPx, m.szDecimals);
  const leverage = Math.max(1, m.maxLeverage);
  return {
    id: m.symbol,
    name: m.symbol,
    displayName: m.displayName,
    category: m.category,
    contractSize: 1,
    tickSize,
    tickValue: tickSize,
    marginPercent: 100 / leverage,
    maxLeverage: leverage,
    commission: 0,
    swapLong: 0,
    swapShort: 0,
    tradingHoursStart: null,
    tradingHoursEnd: null,
    isActive: true,
  };
}

export function toOpenChartsSymbols(
  markets: readonly HlMarket[],
  mids: Readonly<Record<string, number>> = {},
): OcSymbol[] {
  return markets.map((m) => marketToSymbol(m, mids[m.symbol]));
}

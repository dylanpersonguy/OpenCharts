import { estimateOrderFees, roundTripCost, type FeeEstimate, type RoundTripCost } from "../fees.ts";
import type { HlMarket } from "../types.ts";

/** Hyperliquid rejects orders below this notional (reduce-only orders are exempt). */
export const MIN_ORDER_USD = 10;

/** "xyz:EUR" -> "EUR", "BTC" -> "BTC": the unit an order size is denominated in. */
export function baseUnit(market: Pick<HlMarket, "coin">): string {
  return market.coin.split(":").pop() ?? market.coin;
}

/** Plain decimal spellings only: "5", "5.", ".5", "0.25". No exponent, hex, separators or signs. */
const PLAIN_DECIMAL = /^(?:\d+\.?\d*|\.\d+)$/;

function decimalsOf(raw: string): number {
  const dot = raw.indexOf(".");
  return dot === -1 ? 0 : raw.length - dot - 1;
}

/** Round DOWN to the market's size precision (never rounds an order up past what the user typed). */
export function floorSize(value: number, szDecimals: number): number {
  const f = 10 ** szDecimals;
  return Math.floor(value * f + 1e-9) / f;
}

export interface SizeCheck {
  /** Parsed size when it is a usable number, else null. */
  size: number | null;
  /** size * price, when both are known. */
  notional: number | null;
  /** Inline validation message; null when valid or merely empty. */
  error: string | null;
}

export function checkSize(
  raw: string,
  market: Pick<HlMarket, "szDecimals" | "displayName" | "coin">,
  refPrice: number | null,
  reduceOnly: boolean,
): SizeCheck {
  const text = raw.trim();
  if (text === "") return { size: null, notional: null, error: null };
  const size = Number(text);
  if (!PLAIN_DECIMAL.test(text) && Number.isFinite(size) && size > 0) {
    return { size: null, notional: null, error: "Enter the size as a plain number, e.g. 0.25." };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { size: null, notional: null, error: "Enter a size greater than zero." };
  }
  const unit = baseUnit(market);
  const notional = refPrice && refPrice > 0 ? size * refPrice : null;
  if (decimalsOf(text) > market.szDecimals) {
    const step = (10 ** -market.szDecimals).toFixed(market.szDecimals);
    return {
      size,
      notional,
      error:
        market.szDecimals === 0
          ? `${unit} trades in whole units.`
          : `${unit} allows at most ${market.szDecimals} decimals (smallest step ${step}).`,
    };
  }
  // The epsilon absorbs binary float noise (3 x 3.3333333333333335 style products).
  if (notional !== null && !reduceOnly && notional < MIN_ORDER_USD - 1e-9) {
    return {
      size,
      notional,
      error: `Minimum order value is $${MIN_ORDER_USD} (this order is about $${notional.toFixed(2)}).`,
    };
  }
  return { size, notional, error: null };
}

export interface MarginTier {
  lowerBound: number;
  maxLeverage: number;
}

/** meta.marginTables tiers (string bounds) -> sorted numeric tiers. */
export function marginTiersFrom(raw: readonly { lowerBound: string | number; maxLeverage: number }[]): MarginTier[] {
  return raw
    .map((t) => ({ lowerBound: Number(t.lowerBound), maxLeverage: t.maxLeverage }))
    .filter((t) => Number.isFinite(t.lowerBound) && t.maxLeverage >= 1)
    .sort((a, b) => a.lowerBound - b.lowerBound);
}

/**
 * Maintenance margin parameters for a position of `notional` USD.
 *
 * Hyperliquid's maintenance margin rate is half the initial margin rate at the
 * tier's max leverage: 1 / (2 * maxLeverage). Margin tiers (meta.marginTables)
 * lower max leverage as notional grows; to keep maintenance margin continuous
 * across tiers the exchange subtracts a deduction, which accumulates as
 * `lowerBound_k * (mmr_k - mmr_{k-1})`.
 */
function maintenanceAt(
  notional: number,
  maxLeverage: number,
  tiers: readonly MarginTier[] | undefined,
): { mmr: number; deduction: number; tierMaxLeverage: number } {
  if (!tiers || tiers.length === 0) return { mmr: 1 / (2 * maxLeverage), deduction: 0, tierMaxLeverage: maxLeverage };
  let deduction = 0;
  let prevMmr = 1 / (2 * (tiers[0]?.maxLeverage ?? maxLeverage));
  let chosen = tiers[0] ?? { lowerBound: 0, maxLeverage };
  for (const t of tiers) {
    if (t.lowerBound > notional) break;
    const mmr = 1 / (2 * t.maxLeverage);
    if (t !== tiers[0]) deduction += t.lowerBound * (mmr - prevMmr);
    prevMmr = mmr;
    chosen = t;
  }
  return { mmr: 1 / (2 * chosen.maxLeverage), deduction, tierMaxLeverage: chosen.maxLeverage };
}

/**
 * Estimated liquidation price for a NEW isolated position, from the formula on
 * Hyperliquid's liquidations page:
 *
 *   liq = price - side * margin_available / size / (1 - l * side)
 *   l = 1 / maintenance leverage, side = +1 long / -1 short
 *   margin_available (isolated) = isolated_margin - maintenance_margin_required
 *
 * with isolated_margin = notional / leverage. It ignores fees and funding, so it
 * is an estimate. Cross-margin liquidation depends on every position and the
 * whole account balance, so it is not computable per order: returns null. With
 * `tiers` and `notional` the tier that applies at that notional is used, and a
 * leverage above that tier's cap returns null (the exchange would reject it).
 */
export function estimateLiquidation(input: {
  side: "BUY" | "SELL";
  entry: number;
  leverage: number;
  maxLeverage: number;
  isCross: boolean;
  notional?: number;
  tiers?: readonly MarginTier[];
}): number | null {
  const { side, entry, leverage, maxLeverage, isCross } = input;
  if (isCross) return null;
  if (!(entry > 0) || !(leverage >= 1) || !(maxLeverage >= 1)) return null;
  const notional = input.notional !== undefined && input.notional > 0 ? input.notional : entry; // per-unit when unknown
  const { mmr, deduction, tierMaxLeverage } = maintenanceAt(notional, maxLeverage, input.tiers);
  if (leverage > tierMaxLeverage + 1e-9) return null;
  const sign = side === "BUY" ? 1 : -1;
  const size = notional / entry;
  const margin = notional / leverage;
  const available = margin - (notional * mmr - deduction);
  if (!(available > 0)) return null;
  const px = entry - (sign * available) / size / (1 - mmr * sign);
  return Number.isFinite(px) && px > 0 ? px : null;
}

export interface TicketEstimate {
  notional: number;
  /** Margin needed to open at the chosen leverage, USD. */
  marginRequired: number;
  fees: FeeEstimate;
  roundTrip: RoundTripCost;
  liquidationPx: number | null;
}

export function estimateTicket(input: {
  side: "BUY" | "SELL";
  size: number;
  price: number;
  leverage: number;
  maxLeverage: number;
  isCross: boolean;
  /** Whether the opening order rests as a maker (post-only). */
  isMaker: boolean;
  builderFeeTenthsBp: number;
  /** Market's Hyperliquid fee multiplier (HIP-3: 2x, growth mode 0.2x). Default 1. */
  hlFeeMultiplier?: number;
  marginTiers?: readonly MarginTier[];
}): TicketEstimate {
  const notional = input.size * input.price;
  const common = {
    builderFeeTenthsBp: input.builderFeeTenthsBp,
    ...(input.hlFeeMultiplier !== undefined ? { hlFeeMultiplier: input.hlFeeMultiplier } : {}),
  };
  return {
    notional,
    marginRequired: input.leverage > 0 ? notional / input.leverage : notional,
    fees: estimateOrderFees({
      notional,
      side: input.side === "BUY" ? "buy" : "sell",
      isMaker: input.isMaker,
      ...common,
    }),
    // The exit is assumed to be a taker order: the pessimistic, most common case.
    roundTrip: roundTripCost({ openNotional: notional, openIsMaker: input.isMaker, closeIsMaker: false, ...common }),
    liquidationPx: estimateLiquidation({
      side: input.side,
      entry: input.price,
      leverage: input.leverage,
      maxLeverage: input.maxLeverage,
      isCross: input.isCross,
      notional,
      ...(input.marginTiers ? { tiers: input.marginTiers } : {}),
    }),
  };
}

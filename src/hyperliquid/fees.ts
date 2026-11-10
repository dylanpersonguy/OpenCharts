/**
 * Pure fee maths + disclosure strings for the order ticket.
 *
 * Units: the builder fee is expressed in TENTHS of a basis point (100 = 0.1% =
 * 10 bps), exactly as sent in `builder: { b, f }`. Hyperliquid charges it on
 * EVERY fill, on BOTH sides of a round trip (open and close), maker or taker.
 *
 * HL's own fee is the user's tier rate. The defaults below are the base
 * (tier 0) perps rates; pass `hlFeeRates` from the `userFees` info call
 * (`userCrossRate` = taker, `userAddRate` = maker) to show the user's real rate.
 */
import { clampBuilderFee } from "./config.ts";

export type OrderSide = "buy" | "sell";

/** Base (tier 0) Hyperliquid perps fee rates as fractions of notional. */
export const HL_BASE_FEE_RATES = { taker: 0.00045, maker: 0.00015 } as const;

/**
 * Multiplier on Hyperliquid's own fee for a HIP-3 (builder-deployed) market.
 *
 * From the fees page's developer formula (verified 2026-11):
 *   scaleIfHip3 = deployerFeeScale < 1 ? deployerFeeScale + 1 : deployerFeeScale * 2
 * so the standard scale of 1 means 2x the core rate; growth mode then reduces
 * protocol fees by 90% (x0.1). Core perps are 1x (do not call this for them).
 */
export function hip3FeeMultiplier(input: { deployerFeeScale?: number; growthMode?: boolean }): number {
  const raw = input.deployerFeeScale;
  const scale = raw !== undefined && Number.isFinite(raw) && raw >= 0 ? raw : 1;
  const scaled = scale < 1 ? scale + 1 : scale * 2;
  return input.growthMode ? scaled * 0.1 : scaled;
}

export interface HlFeeRates {
  /** Fraction of notional, e.g. 0.00045 = 0.045%. */
  taker: number;
  /** Fraction of notional. May be negative (maker rebate). */
  maker: number;
}

export interface EstimateOrderFeesInput {
  /** Order notional in USD (size * price). */
  notional: number;
  /** Informational: HL fees are symmetric by side, kept for API stability. */
  side: OrderSide;
  /** Resting (maker) vs. crossing (taker). The builder fee applies to both. */
  isMaker: boolean;
  /** Builder fee in tenths of a bp; clamped to [0, 100]. 0 = no platform fee. */
  builderFeeTenthsBp: number;
  /** User's HL rates; defaults to the base tier. */
  hlFeeRates?: HlFeeRates;
  /**
   * Multiplier on HL's fee for the market (see `hip3FeeMultiplier`): HIP-3
   * markets are 2x the core rate at the standard deployer scale, 0.2x in growth
   * mode. Applies to positive fees only; a maker rebate is never scaled. Default 1.
   */
  hlFeeMultiplier?: number;
}

export interface FeeEstimate {
  /** USD charged by us (the builder). */
  builderFee: number;
  /** USD charged by Hyperliquid (negative = rebate). */
  hlFee: number;
  /** builderFee + hlFee. */
  total: number;
  /** Total cost in basis points of notional. 0 when notional is 0. */
  effectiveBps: number;
  builderBps: number;
  hlBps: number;
  /** Fractions of notional actually applied. */
  builderRate: number;
  hlRate: number;
}

function assertNonNegativeFinite(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0) throw new RangeError(`${name} must be a finite number >= 0, got ${v}`);
}

/** Builder fee rate (fraction of notional) for a tenths-of-bp value, after clamping. */
export function builderRateFromTenthsBp(tenthsBp: number): number {
  return clampBuilderFee(tenthsBp) / 100_000;
}

export function estimateOrderFees(input: EstimateOrderFeesInput): FeeEstimate {
  const { notional, isMaker, builderFeeTenthsBp } = input;
  assertNonNegativeFinite("notional", notional);
  const mult = input.hlFeeMultiplier ?? 1;
  assertNonNegativeFinite("hlFeeMultiplier", mult);
  const rates = input.hlFeeRates ?? HL_BASE_FEE_RATES;

  const builderRate = builderRateFromTenthsBp(builderFeeTenthsBp);
  const baseRate = isMaker ? rates.maker : rates.taker;
  const hlRate = baseRate < 0 ? baseRate : baseRate * mult;
  const builderFee = notional * builderRate;
  const hlFee = notional * hlRate;
  const total = builderFee + hlFee;
  const bps = (fee: number) => (notional > 0 ? (fee / notional) * 10_000 : 0);
  return {
    builderFee,
    hlFee,
    total,
    effectiveBps: bps(total),
    builderBps: bps(builderFee),
    hlBps: bps(hlFee),
    builderRate,
    hlRate,
  };
}

export interface RoundTripInput {
  /** Notional at entry. */
  openNotional: number;
  /** Notional at exit; defaults to the entry notional (flat price). */
  closeNotional?: number;
  openIsMaker: boolean;
  closeIsMaker: boolean;
  builderFeeTenthsBp: number;
  hlFeeRates?: HlFeeRates;
  hlFeeMultiplier?: number;
}

export interface RoundTripCost {
  open: FeeEstimate;
  close: FeeEstimate;
  builderFee: number;
  hlFee: number;
  total: number;
  /** Total cost as bps of the OPEN notional (the capital the user commits). */
  effectiveBps: number;
  /** Price move (in bps of entry) needed just to cover fees. */
  breakevenMoveBps: number;
}

/** Cost of opening and later closing a position. The builder fee is charged twice. */
export function roundTripCost(input: RoundTripInput): RoundTripCost {
  const common = {
    builderFeeTenthsBp: input.builderFeeTenthsBp,
    hlFeeRates: input.hlFeeRates,
    hlFeeMultiplier: input.hlFeeMultiplier,
  };
  const open = estimateOrderFees({ notional: input.openNotional, side: "buy", isMaker: input.openIsMaker, ...common });
  const close = estimateOrderFees({
    notional: input.closeNotional ?? input.openNotional,
    side: "sell",
    isMaker: input.closeIsMaker,
    ...common,
  });
  const total = open.total + close.total;
  const effectiveBps = input.openNotional > 0 ? (total / input.openNotional) * 10_000 : 0;
  return {
    open,
    close,
    builderFee: open.builderFee + close.builderFee,
    hlFee: open.hlFee + close.hlFee,
    total,
    effectiveBps,
    breakevenMoveBps: effectiveBps,
  };
}

/** "0.10", "0.045", "0.03": at least 2 and at most 4 decimals, trailing zeros trimmed past 2. */
export function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  let s = pct.toFixed(4).replace(/0+$/, "");
  const dot = s.indexOf(".");
  if (dot === -1) s += ".00";
  else if (s.length - dot - 1 < 2) s = s.padEnd(dot + 3, "0");
  return s;
}

/** "$1.00", "-$0.15", "<$0.01" for sub-cent positives. */
export function formatUsd(amount: number): string {
  if (amount === 0) return "$0.00";
  const abs = Math.abs(amount);
  if (abs < 0.005) return amount > 0 ? "<$0.01" : "-<$0.01";
  return `${amount < 0 ? "-" : ""}$${abs.toFixed(2)}`;
}

/**
 * One-line disclosure for the order ticket, e.g.
 * "Platform fee 0.10% ($1.00) + Hyperliquid fee ~0.045% ($0.45)".
 * The HL part is prefixed "~" because tiers, rebates and HIP-3 scales vary.
 */
export function formatFeeDisclosure(est: FeeEstimate): string {
  const hl = `Hyperliquid fee ~${formatPercent(est.hlRate)}% (${formatUsd(est.hlFee)})`;
  if (est.builderRate === 0) return `No platform fee + ${hl}`;
  return `Platform fee ${formatPercent(est.builderRate)}% (${formatUsd(est.builderFee)}) + ${hl}`;
}

/** Disclosure for a full round trip (platform fee is charged on open and close). */
export function formatRoundTripDisclosure(rt: RoundTripCost): string {
  const pct = formatPercent(rt.effectiveBps / 10_000);
  return (
    `Round trip ~${pct}% (${formatUsd(rt.total)}): ` +
    `platform ${formatUsd(rt.builderFee)} (charged on open and close) + Hyperliquid ${formatUsd(rt.hlFee)}`
  );
}

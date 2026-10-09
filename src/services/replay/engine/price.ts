import type { EngineConfig, PositionSide } from "./types.ts";

/** Price and quantity arithmetic shared by the engine modules. */

const QTY_STEP = 0.01;
export const MAX_QUANTITY = 1000;

function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** Rounds to the nearest multiple of `step`, trimming float noise. */
export function roundToStep(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(decimalsOf(step)));
}

export function roundPrice(value: number, cfg: EngineConfig): number {
  return roundToStep(value, cfg.tickSize);
}

/** Rounds money to cents-of-cents so repeated sums stay stable. */
export function roundMoney(value: number): number {
  return Number(value.toFixed(8));
}

export function askOf(bid: number, cfg: EngineConfig): number {
  return roundPrice(bid + cfg.spread, cfg);
}

/** Price a position of `side` exits/marks at for a given bid. */
export function exitPriceAt(side: PositionSide, bid: number, cfg: EngineConfig): number {
  return side === "LONG" ? bid : askOf(bid, cfg);
}

/** True if `qty` is in (0, MAX_QUANTITY] and on the 0.01 lot step. */
export function isValidQuantity(qty: number): boolean {
  if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QUANTITY) return false;
  return Math.abs(qty / QTY_STEP - Math.round(qty / QTY_STEP)) < 1e-6;
}

export function roundQuantity(qty: number): number {
  return roundToStep(qty, QTY_STEP);
}

export function isoFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

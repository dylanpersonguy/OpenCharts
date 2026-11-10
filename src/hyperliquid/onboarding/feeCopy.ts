import { builderFeeRate, getBuilderFeeTenthsBp, getBuilderParam } from "../config.ts";

export interface FeeDisclosure {
  enabled: boolean;
  /** e.g. "0.1%" */
  percent: string;
  /** Fee on a $1,000 trade side, in USD. */
  exampleFee: number;
  sentence: string;
}

/** Transparent fee statement derived from config (never hard-coded). */
export function feeDisclosure(notional = 1000): FeeDisclosure {
  if (!getBuilderParam()) {
    return { enabled: false, percent: "0%", exampleFee: 0, sentence: "This platform charges no fee of its own. Hyperliquid's own fees apply." };
  }
  const percent = `${getBuilderFeeTenthsBp() / 1000}%`;
  const exampleFee = notional * builderFeeRate();
  const usd = notional.toLocaleString("en-US");
  return {
    enabled: true,
    percent,
    exampleFee,
    sentence: `This platform charges ${percent} of the trade value on each side (open and close). On a $${usd} trade you pay $${exampleFee.toFixed(2)} to this platform plus Hyperliquid's fees.`,
  };
}

export const shortAddress = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

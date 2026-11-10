import { getBuilderFeeTenthsBp, getBuilderParam } from "../config.ts";

/**
 * TEMPLATE COPY. This text has NOT been reviewed by counsel. Do not launch with
 * it unchanged: see docs/COMPLIANCE_CHECKLIST.md. Flip this flag only after a
 * qualified lawyer has approved the final wording, and bump TERMS_VERSION in
 * config.ts whenever the wording changes.
 */
export const TERMS_REVIEWED_BY_COUNSEL = false;

export interface TermsItem {
  id: string;
  text: string;
}

/** "0.1%" style fee string, read from the live config so it cannot drift from what is charged. */
export function platformFeeText(): string | null {
  return getBuilderParam() ? `${getBuilderFeeTenthsBp() / 1000}%` : null;
}

export function feeStatement(): string {
  const pct = platformFeeText();
  return pct
    ? `This platform charges ${pct} of the trade value per side (when you open and when you close), on top of Hyperliquid's own fees.`
    : "This platform charges no fee of its own. Hyperliquid's own fees still apply.";
}

/** Every item must be ticked before the visitor can continue. */
export function termsItems(): TermsItem[] {
  return [
    {
      id: "leverage",
      text: "I understand that leveraged derivatives are risky. I can lose all of the money I put in, my positions can be liquidated quickly, and I can lose more than I expected.",
    },
    {
      id: "non-custodial",
      text: "I understand this site is non-custodial. It never holds my funds. My trades are placed on Hyperliquid, and my money stays in my Hyperliquid account under my wallet.",
    },
    { id: "fee", text: `I understand the platform fee. ${feeStatement()}` },
    {
      id: "hip3",
      text: "I understand that some markets (HIP-3 markets, such as stocks, currencies and commodities) are created and run by third parties. Their prices, leverage limits and settlement are controlled by those third parties, and trading can be halted.",
    },
    {
      id: "restricted",
      text: "I confirm that I am not located in, or a resident or citizen of, a place where using this service is prohibited, and that I am not a sanctioned or otherwise restricted person.",
    },
    {
      id: "no-advice",
      text: "I understand that nothing here is investment, legal or tax advice, and that I am solely responsible for my own trading decisions.",
    },
  ];
}

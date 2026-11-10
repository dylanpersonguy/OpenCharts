import { useId, type FC } from "react";
import type { HlMarket } from "../types.ts";
import { marketRiskNotice } from "./riskNotice.ts";

/**
 * Small "Third-party" pill for HIP-3 markets (renders nothing for core-dex
 * markets). The explanation is a tooltip that opens on hover AND keyboard
 * focus, and is linked with aria-describedby so screen readers announce it.
 */
export const MarketRiskBadge: FC<{ market: HlMarket }> = ({ market }) => {
  const id = useId();
  const notice = marketRiskNotice(market);
  if (!notice) return null;
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-describedby={id}
        className="cursor-help rounded border border-amber-500/60 px-1 text-[10px] font-medium uppercase leading-4 tracking-wide text-amber-500 outline-none focus-visible:ring-1 focus-visible:ring-amber-500"
      >
        HIP-3
      </span>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-64 rounded-md border border-border bg-popover p-2 text-xs normal-case tracking-normal text-popover-foreground shadow-lg group-focus-within:block group-hover:block"
      >
        <strong className="mb-1 block">{notice.title}</strong>
        {notice.body}
      </span>
    </span>
  );
};

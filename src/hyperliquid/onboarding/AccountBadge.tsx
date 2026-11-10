import { formatCurrency } from "../../lib/utils.ts";
import { useAccountSummary } from "./useAccountSummary.ts";
import type { HlInfoApi } from "../wallet/clients.ts";

export function AccountBadge({ info, className }: { info?: Pick<HlInfoApi, "clearinghouseState" | "spotClearinghouseState" | "userAbstraction">; className?: string }) {
  const { summary, error } = useAccountSummary(15_000, info);
  if (!summary) return error ? <span className={className} role="status">Balance unavailable</span> : null;
  return (
    <span className={className} role="status" aria-label={`Equity ${formatCurrency(summary.equity)}, free margin ${formatCurrency(summary.freeMargin)}`}>
      <span className="text-muted-foreground">Equity </span>
      <span className="font-mono">{formatCurrency(summary.equity)}</span>
      <span className="ml-2 text-muted-foreground">Free </span>
      <span className="font-mono">{formatCurrency(summary.freeMargin)}</span>
    </span>
  );
}

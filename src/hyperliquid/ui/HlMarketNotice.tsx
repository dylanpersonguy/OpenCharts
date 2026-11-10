import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { marketHoursNotice } from "./marketHours.ts";

/** Informational strip under the toolbar for non-crypto HIP-3 markets. Never blocks trading. */
export function HlMarketNotice({ category }: { category?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const notice = marketHoursNotice(category, now);
  if (!notice) return null;
  return (
    <div
      role="note"
      data-testid="market-hours-notice"
      className="flex items-start gap-2 border-b border-border bg-secondary/60 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>
        <span className="font-medium text-foreground">{notice.title}.</span> {notice.message}
      </span>
    </div>
  );
}

/**
 * Supplementary market-info panels.
 *
 * This module used to carry six more components (price alerts, a sentiment
 * gauge, multi-symbol comparison, trade signals, a risk overlay and a P&L
 * heatmap). None were mounted, and the sentiment gauge and "STRONG BUY" trade
 * signals derived their output from a hash of the symbol name rather than from
 * market data — fabricated analysis waiting for someone to wire it up. They
 * were removed rather than left as a trap; build them against real data if the
 * panels are wanted back.
 */
import { Clock, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── News feed (sample data) ──────────────────────────────────
//
// OpenCharts ships no news integration. These items are obviously-labelled
// placeholders that show the shape of the panel; they are not attributed to
// real outlets, because a demo must never look like a live wire.

const SAMPLE_HEADLINES = [
  { id: 1, title: "Central bank rate decision ahead", impact: "HIGH" as const, time: "2h ago" },
  { id: 2, title: "Employment data exceeds expectations", impact: "MEDIUM" as const, time: "4h ago" },
  { id: 3, title: "Price approaching a widely-watched level", impact: "LOW" as const, time: "6h ago" },
  { id: 4, title: "Risk appetite improves across majors", impact: "MEDIUM" as const, time: "8h ago" },
  { id: 5, title: "Volatility expected ahead of the next print", impact: "HIGH" as const, time: "12h ago" },
];

const IMPACT_COLORS = {
  HIGH: "bg-red-500/10 text-red-500",
  MEDIUM: "bg-yellow-500/10 text-yellow-500",
  LOW: "bg-green-500/10 text-green-500",
};

export function NewsFeed({ symbol }: { symbol: string }) {
  return (
    <Card>
      <CardHeader className="p-3 pb-0">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-accent" /> Market News
          </span>
          <span className="text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            Sample data
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-2 space-y-2">
        <p className="text-[10px] text-muted-foreground">
          Placeholder items for {symbol} — connect a news provider to make this live.
        </p>
        {SAMPLE_HEADLINES.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0"
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium leading-tight line-clamp-2">{item.title}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-muted-foreground">Sample</span>
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" /> {item.time}
                </span>
              </div>
            </div>
            <span
              className={cn(
                "text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0",
                IMPACT_COLORS[item.impact],
              )}
            >
              {item.impact}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

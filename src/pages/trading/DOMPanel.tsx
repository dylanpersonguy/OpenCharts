import { useMemo } from "react";
import { formatNumber, cn } from "../../lib/utils.ts";

export function DOMPanel({
  symbol,
  tick,
}: {
  symbol: string;
  tick?: { bid: number; ask: number };
}) {
  const levels = useMemo(() => {
    if (!tick) return [];
    const mid = (tick.bid + tick.ask) / 2;
    const step = tick.ask - tick.bid || 0.0001;
    const result = [];

    for (let i = 10; i >= 1; i--) {
      result.push({
        price: mid + step * i,
        bidSize: 0,
        askSize: Math.floor(Math.random() * 50 + 5),
        type: "ask" as const,
      });
    }
    result.push({
      price: tick.ask,
      bidSize: 0,
      askSize: Math.floor(Math.random() * 100 + 20),
      type: "ask" as const,
    });
    result.push({
      price: tick.bid,
      bidSize: Math.floor(Math.random() * 100 + 20),
      askSize: 0,
      type: "bid" as const,
    });
    for (let i = 1; i <= 10; i++) {
      result.push({
        price: mid - step * i,
        bidSize: Math.floor(Math.random() * 50 + 5),
        askSize: 0,
        type: "bid" as const,
      });
    }
    return result;
    // tick is captured via tick?.bid and tick?.ask; including tick.bid/tick.ask is sufficient
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick?.bid, tick?.ask]);

  const maxSize = Math.max(...levels.map((l) => Math.max(l.bidSize, l.askSize)), 1);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Depth of Market
        </h3>
        <span className="text-xs font-semibold">{symbol}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-card z-10">
            <tr>
              <th className="text-right w-[30%]">Bid Size</th>
              <th className="text-center w-[40%]">Price</th>
              <th className="text-left w-[30%]">Ask Size</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((l, i) => (
              <tr key={i} className="relative hover:bg-secondary/50">
                <td className="text-right relative">
                  {l.bidSize > 0 && (
                    <>
                      <div
                        className="absolute inset-y-0 right-0 bg-buy/20"
                        style={{ width: `${(l.bidSize / maxSize) * 100}%` }}
                      />
                      <span className="relative text-buy">{l.bidSize}</span>
                    </>
                  )}
                </td>
                <td
                  className={cn(
                    "text-center font-mono",
                    l.type === "ask" ? "text-sell" : "text-buy",
                  )}
                >
                  {formatNumber(l.price, 5)}
                </td>
                <td className="text-left relative">
                  {l.askSize > 0 && (
                    <>
                      <div
                        className="absolute inset-y-0 left-0 bg-sell/20"
                        style={{ width: `${(l.askSize / maxSize) * 100}%` }}
                      />
                      <span className="relative text-sell">{l.askSize}</span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

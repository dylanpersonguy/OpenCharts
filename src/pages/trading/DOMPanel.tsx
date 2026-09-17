import { useMemo } from "react";
import { formatNumber, cn } from "../../lib/utils.ts";

/**
 * Deterministic pseudo-random depth for a price level.
 *
 * The bundled market data carries no order book, so ladder sizes are
 * simulated. Deriving them from the price level (rather than Math.random on
 * every render) keeps a level's size stable while the price hovers, so the
 * ladder no longer reshuffles every tick — and the component stays pure.
 */
function depthAt(symbol: string, price: number, spread: number, base: number, range: number): number {
  // Bucket by tick so tiny float noise does not reshuffle the book.
  const bucket = spread > 0 ? Math.round(price / spread) : Math.round(price);
  let hash = 2166136261 ^ bucket;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = Math.imul(hash ^ symbol.charCodeAt(i), 16777619);
  }
  const unit = ((hash >>> 0) % 1000) / 1000;
  return Math.floor(unit * range + base);
}

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
    const result: Array<{
      price: number;
      bidSize: number;
      askSize: number;
      type: "bid" | "ask";
    }> = [];

    for (let i = 10; i >= 1; i--) {
      const price = mid + step * i;
      result.push({
        price,
        bidSize: 0,
        askSize: depthAt(symbol, price, step, 5, 50),
        type: "ask",
      });
    }
    result.push({
      price: tick.ask,
      bidSize: 0,
      askSize: depthAt(symbol, tick.ask, step, 20, 100),
      type: "ask",
    });
    result.push({
      price: tick.bid,
      bidSize: depthAt(symbol, tick.bid, step, 20, 100),
      askSize: 0,
      type: "bid",
    });
    for (let i = 1; i <= 10; i++) {
      const price = mid - step * i;
      result.push({
        price,
        bidSize: depthAt(symbol, price, step, 5, 50),
        askSize: 0,
        type: "bid",
      });
    }
    return result;
  }, [symbol, tick]);

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

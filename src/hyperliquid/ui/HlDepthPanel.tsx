import { useEffect, useState } from "react";
import { cn } from "../../lib/utils.ts";
import type { HlL2Book } from "../info.ts";
import { formatPrice } from "./format.ts";
import { getHlInfo } from "./mode.ts";

const LEVELS = 10;
const POLL_MS = 2000;

/**
 * Real order-book depth (Hyperliquid `l2Book`), polled every 2s while mounted.
 * The generic DOM panel simulates depth for the demo data; a live broker must
 * never show invented liquidity, so this replaces it.
 */
export function HlDepthPanel({ symbol }: { symbol: string }) {
  const [state, setState] = useState<{ symbol: string; book: HlL2Book } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const info = getHlInfo();
    if (!info) return;
    let live = true;
    const load = () => {
      info
        .l2Book(symbol)
        .then((book) => {
          if (!live) return;
          setState({ symbol, book });
          setError(null);
        })
        .catch((e: unknown) => {
          if (live) setError(e instanceof Error ? e.message : "Could not load the order book");
        });
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [symbol]);

  const book = state?.symbol === symbol ? state.book : null;
  const bids = (book?.levels[0] ?? []).slice(0, LEVELS);
  const asks = (book?.levels[1] ?? []).slice(0, LEVELS).reverse();
  const sizes = [...bids, ...asks].map((l) => Number(l.sz));
  const maxSize = Math.max(...sizes, 1e-12);

  const row = (l: { px: string; sz: string }, side: "bid" | "ask") => (
    <tr key={`${side}-${l.px}`} className="hover:bg-secondary/50">
      <td className="relative text-right">
        {side === "bid" && (
          <>
            <div className="absolute inset-y-0 right-0 bg-buy/20" style={{ width: `${(Number(l.sz) / maxSize) * 100}%` }} />
            <span className="relative text-buy">{l.sz}</span>
          </>
        )}
      </td>
      <td className={cn("text-center font-mono", side === "ask" ? "text-sell" : "text-buy")}>
        {formatPrice(Number(l.px))}
      </td>
      <td className="relative text-left">
        {side === "ask" && (
          <>
            <div className="absolute inset-y-0 left-0 bg-sell/20" style={{ width: `${(Number(l.sz) / maxSize) * 100}%` }} />
            <span className="relative text-sell">{l.sz}</span>
          </>
        )}
      </td>
    </tr>
  );

  return (
    <div className="flex h-full flex-col" data-testid="hl-depth">
      <div className="flex items-center justify-between border-b border-border bg-secondary px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Order book</h3>
        <span className="text-xs font-semibold">{symbol}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {error && !book ? (
          <p role="alert" className="p-3 text-xs text-destructive">
            {error}
          </p>
        ) : !book ? (
          <p className="p-3 text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
          {error && (
            <p role="status" data-testid="hl-depth-stale" className="px-3 py-1 text-[10px] text-amber-500">
              Order book is out of date; retrying…
            </p>
          )}
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                <th className="w-[30%] text-right">Bid size</th>
                <th className="w-[40%] text-center">Price</th>
                <th className="w-[30%] text-left">Ask size</th>
              </tr>
            </thead>
            <tbody>
              {asks.map((l) => row(l, "ask"))}
              {bids.map((l) => row(l, "bid"))}
            </tbody>
          </table>
          </>
        )}
      </div>
    </div>
  );
}

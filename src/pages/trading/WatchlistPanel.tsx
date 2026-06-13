import { useState, useCallback, useMemo } from "react";
import { Star } from "lucide-react";
import { usePlaceOrder } from "../../services/queries.ts";
import { formatNumber, cn } from "../../lib/utils.ts";
import { toast } from "../../services/toast.ts";

export function WatchlistPanel({
  symbols,
  ticks,
  selectedSymbol,
  onSelect,
  oneClick,
  accountId,
  isFeedConnected = true,
}: {
  symbols: Array<{
    id?: string;
    name: string;
    displayName?: string | null;
    assetClass?: string;
    category?: string;
    isActive?: boolean;
  }>;
  ticks: Record<string, { bid: number; ask: number; timestamp: number }>;
  selectedSymbol: string;
  onSelect: (s: string) => void;
  oneClick?: boolean;
  accountId?: string | null;
  isFeedConnected?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const placeOrder = usePlaceOrder();

  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("watchlist_favorites");
      return saved ? new Set(JSON.parse(saved)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  const toggleFavorite = useCallback((name: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      localStorage.setItem("watchlist_favorites", JSON.stringify([...next]));
      return next;
    });
  }, []);

  const categories = useMemo(() => {
    const cats = new Set(symbols.map((s) => s.category || "Other"));
    return Array.from(cats).sort();
  }, [symbols]);

  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return symbols
      .filter((s) => {
        if (filter && !s.name.toLowerCase().includes(filter.toLowerCase())) return false;
        if (selectedCat === "★") return favorites.has(s.name);
        if (selectedCat && selectedCat !== "★" && s.category !== selectedCat) return false;
        return s.isActive !== false;
      })
      .sort((a, b) => {
        const aFav = favorites.has(a.name) ? 0 : 1;
        const bFav = favorites.has(b.name) ? 0 : 1;
        if (aFav !== bFav) return aFav - bFav;
        return a.name.localeCompare(b.name);
      });
  }, [symbols, filter, selectedCat, favorites]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border bg-secondary">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
          Watchlist
        </h3>
        <input
          placeholder="Search..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full text-xs"
        />
      </div>
      <div className="flex gap-1 px-2 py-1 border-b border-border overflow-x-auto text-[10px]">
        <button
          onClick={() => setSelectedCat(null)}
          className={cn(
            "px-2 py-0.5 rounded whitespace-nowrap",
            !selectedCat ? "bg-primary text-primary-foreground" : "hover:bg-secondary",
          )}
        >
          All
        </button>
        <button
          onClick={() => setSelectedCat("★")}
          className={cn(
            "px-2 py-0.5 rounded whitespace-nowrap flex items-center gap-0.5",
            selectedCat === "★"
              ? "bg-primary text-primary-foreground"
              : "hover:bg-secondary text-yellow-400",
          )}
        >
          <Star className="h-2.5 w-2.5" fill="currentColor" />
          {favorites.size > 0 && <span className="text-[9px]">{favorites.size}</span>}
        </button>
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setSelectedCat(c)}
            className={cn(
              "px-2 py-0.5 rounded whitespace-nowrap",
              selectedCat === c ? "bg-primary text-primary-foreground" : "hover:bg-secondary",
            )}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.map((s) => {
          const t = ticks[s.name];
          const isFav = favorites.has(s.name);
          const handleQuickTrade = (side: "BUY" | "SELL") => {
            if (!isFeedConnected) {
              toast.warning("No Data Feed", "Cannot trade while disconnected");
              return;
            }
            if (!accountId) {
              toast.warning("No Account", "Select an account first");
              return;
            }
            placeOrder.mutate(
              {
                accountId,
                symbol: s.name,
                side,
                type: "MARKET",
                quantity: 0.1,
              },
              {
                onSuccess: () => toast.success("Quick Trade", `${side} 0.1 ${s.name}`),
                onError: (err: unknown) =>
                  toast.error("Trade Failed", (err as { message?: string })?.message || "Failed"),
              },
            );
          };
          return (
            <div
              key={s.id || s.name}
              className={cn(
                "w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-secondary border-b border-border/30 group",
                s.name === selectedSymbol && "bg-secondary",
              )}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(s.name);
                }}
                className={cn(
                  "shrink-0 mr-1",
                  isFav ? "text-yellow-400" : "text-muted-foreground/20 hover:text-yellow-400/60",
                )}
              >
                <Star className="h-3 w-3" fill={isFav ? "currentColor" : "none"} />
              </button>
              <button onClick={() => onSelect(s.name)} className="text-left flex-1 min-w-0">
                <div className="font-semibold">{s.name}</div>
                <div className="text-[10px] text-muted-foreground">{s.category}</div>
              </button>
              {t ? (
                <div className="flex items-center gap-1">
                  <div className="text-right font-mono">
                    <div className="text-buy">{formatNumber(t.bid, 5)}</div>
                    <div className="text-sell">{formatNumber(t.ask, 5)}</div>
                  </div>
                  {oneClick && (
                    <div className="hidden group-hover:flex flex-col gap-0.5 ml-1">
                      <button
                        onClick={() => handleQuickTrade("BUY")}
                        className="px-1 py-0.5 text-[8px] rounded bg-buy/20 text-buy hover:bg-buy/30 font-semibold"
                      >
                        B
                      </button>
                      <button
                        onClick={() => handleQuickTrade("SELL")}
                        className="px-1 py-0.5 text-[8px] rounded bg-sell/20 text-sell hover:bg-sell/30 font-semibold"
                      >
                        S
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground">--</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/utils.ts";
import { safeStorage } from "../../lib/safe-storage.ts";
import { MarketRiskBadge } from "../compliance/index.ts";
import { formatPrice } from "./format.ts";
import { getHlRegistry } from "./mode.ts";
import {
  WATCHLIST_CATEGORIES,
  countByFilter,
  filterWatchlist,
  nextTabIndex,
  windowRange,
  type WatchlistFilter,
} from "./watchlistModel.ts";
import type { WatchlistPanelProps } from "../../pages/trading/WatchlistPanel.tsx";

/** Fixed row height: lets a few hundred markets render as a window of ~20 rows. */
const ROW_HEIGHT = 46;
/** Used until the real viewport is measured (and in environments with no layout). */
const FALLBACK_VIEWPORT = 480;
const FAVORITES_KEY = "watchlist_favorites";

const TABS: ReadonlyArray<{ id: WatchlistFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "favorites", label: "Favorites" },
  ...WATCHLIST_CATEGORIES.map((c) => ({ id: c, label: c })),
];

function loadFavorites(): Set<string> {
  const saved = safeStorage.getJSON<unknown>(FAVORITES_KEY, []);
  return new Set(Array.isArray(saved) ? saved.filter((x): x is string => typeof x === "string") : []);
}

export function HlWatchlist({ symbols, ticks, selectedSymbol, onSelect }: WatchlistPanelProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WatchlistFilter>("all");
  // Favourites are a device preference, deliberately not routed through the account storage driver.
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);
  const scroller = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const toggleFavorite = useCallback((name: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      safeStorage.setJSON(FAVORITES_KEY, [...next]);
      return next;
    });
  }, []);

  const counts = useMemo(() => countByFilter(symbols, favorites), [symbols, favorites]);
  const rows = useMemo(() => filterWatchlist(symbols, { query, filter, favorites }), [symbols, query, filter, favorites]);

  // Track the scroller's height so the window matches what is on screen.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (el.clientHeight > 0) setViewport(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new filter or search starts from the top.
  useEffect(() => {
    // The scroll event this fires keeps `scrollTop` state in step.
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [query, filter]);

  const { start, end } = windowRange({ scrollTop, viewportHeight: viewport, rowHeight: ROW_HEIGHT, count: rows.length });
  const registry = getHlRegistry();

  const onTabKey = (e: KeyboardEvent, index: number) => {
    const next = nextTabIndex(e.key, index, TABS.length);
    if (next === null) return;
    e.preventDefault();
    const tab = TABS[next];
    if (tab) setFilter(tab.id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="flex h-full flex-col" data-testid="hl-watchlist">
      <div className="border-b border-border bg-secondary px-3 py-2">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Markets</h3>
        <input
          type="search"
          aria-label="Search markets"
          placeholder="Search markets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full text-xs"
        />
      </div>

      <div role="tablist" aria-label="Market categories" className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1 text-[10px]">
        {TABS.map((t, i) => {
          const selected = filter === t.id;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setFilter(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
              className={cn(
                "flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5",
                selected ? "bg-primary text-primary-foreground" : "hover:bg-secondary",
              )}
            >
              {t.id === "favorites" && <Star className="h-2.5 w-2.5" fill="currentColor" aria-hidden />}
              {t.label}
              <span className="opacity-60">{counts[t.id]}</span>
            </button>
          );
        })}
      </div>

      <div
        ref={scroller}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="flex-1 overflow-y-auto"
        role="tabpanel"
        aria-label="Markets"
      >
        {rows.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground" data-testid="watchlist-empty">
            {filter === "favorites" ? "Star a market to pin it here." : "No markets match."}
          </div>
        ) : (
          <ul className="relative" style={{ height: rows.length * ROW_HEIGHT }} aria-label="Markets">
            {rows.slice(start, end).map((s, i) => {
              const index = start + i;
              const t = ticks[s.name];
              const isFav = favorites.has(s.name);
              const market = registry?.bySymbol(s.name);
              const lev = market?.maxLeverage ?? (s as { maxLeverage?: number }).maxLeverage;
              return (
                <li
                  key={s.name}
                  aria-setsize={rows.length}
                  aria-posinset={index + 1}
                  style={{ position: "absolute", top: index * ROW_HEIGHT, height: ROW_HEIGHT, left: 0, right: 0 }}
                  className={cn(
                    "flex items-center justify-between border-b border-border/30 px-3 text-xs hover:bg-secondary",
                    s.name === selectedSymbol && "bg-secondary",
                  )}
                >
                  <button
                    type="button"
                    aria-label={isFav ? `Remove ${s.name} from favorites` : `Add ${s.name} to favorites`}
                    aria-pressed={isFav}
                    onClick={() => toggleFavorite(s.name)}
                    className={cn("mr-1 shrink-0", isFav ? "text-yellow-400" : "text-muted-foreground/30 hover:text-yellow-400/60")}
                  >
                    <Star className="h-3 w-3" fill={isFav ? "currentColor" : "none"} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelect(s.name)}
                    aria-current={s.name === selectedSymbol ? "true" : undefined}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-1 truncate font-semibold">
                      <span className="truncate">{s.displayName || s.name}</span>
                      {market && <MarketRiskBadge market={market} />}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {s.name !== (s.displayName || s.name) ? `${s.name} · ` : ""}
                      {categoryLabel(s.category)}
                      {lev ? ` · up to ${lev}x` : ""}
                    </div>
                  </button>
                  {t ? (
                    <div className="text-right font-mono">
                      {t.bid === t.ask ? (
                        // Mid-only ticks (allMids) have no spread: one price, not two identical lines.
                        <div>{formatPrice(t.bid)}</div>
                      ) : (
                        <>
                          <div className="text-buy">{formatPrice(t.bid)}</div>
                          <div className="text-sell">{formatPrice(t.ask)}</div>
                        </>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

const categoryLabel = (c: string | undefined): string => c || "Other";

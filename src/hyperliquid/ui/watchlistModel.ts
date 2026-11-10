/**
 * Pure model for the Hyperliquid watchlist: category filtering, search, sort
 * and windowing. Kept free of React so it can be tested exhaustively.
 */

export const WATCHLIST_CATEGORIES = ["Crypto", "Stocks", "Forex", "Commodities", "Indices", "Other"] as const;
export type WatchlistCategory = (typeof WATCHLIST_CATEGORIES)[number];

/** "all" shows everything, "favorites" only starred markets. */
export type WatchlistFilter = "all" | "favorites" | WatchlistCategory;

export interface WatchlistItem {
  name: string;
  displayName?: string | null;
  category?: string;
  isActive?: boolean;
}

/** Any category outside the known six (or missing) is listed under "Other". */
export function categoryOf(item: WatchlistItem): WatchlistCategory {
  return (WATCHLIST_CATEGORIES as readonly string[]).includes(item.category ?? "")
    ? (item.category as WatchlistCategory)
    : "Other";
}

export function filterWatchlist<T extends WatchlistItem>(
  items: readonly T[],
  opts: { query: string; filter: WatchlistFilter; favorites: ReadonlySet<string> },
): T[] {
  const q = opts.query.trim().toLowerCase();
  const out = items.filter((s) => {
    if (s.isActive === false) return false;
    if (opts.filter === "favorites") {
      if (!opts.favorites.has(s.name)) return false;
    } else if (opts.filter !== "all" && categoryOf(s) !== opts.filter) {
      return false;
    }
    if (!q) return true;
    return s.name.toLowerCase().includes(q) || (s.displayName ?? "").toLowerCase().includes(q);
  });
  return out.sort((a, b) => {
    const af = opts.favorites.has(a.name) ? 0 : 1;
    const bf = opts.favorites.has(b.name) ? 0 : 1;
    if (af !== bf) return af - bf;
    return (a.displayName || a.name).localeCompare(b.displayName || b.name);
  });
}

/** Count of items per filter tab (ignoring the search query), for tab badges. */
export function countByFilter(
  items: readonly WatchlistItem[],
  favorites: ReadonlySet<string>,
): Record<WatchlistFilter, number> {
  const counts: Record<WatchlistFilter, number> = {
    all: 0,
    favorites: 0,
    Crypto: 0,
    Stocks: 0,
    Forex: 0,
    Commodities: 0,
    Indices: 0,
    Other: 0,
  };
  for (const s of items) {
    if (s.isActive === false) continue;
    counts.all++;
    counts[categoryOf(s)]++;
    if (favorites.has(s.name)) counts.favorites++;
  }
  return counts;
}

/** Which rows of a fixed-height list to render for the current scroll position. */
export function windowRange(input: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  count: number;
  overscan?: number;
}): { start: number; end: number } {
  const { rowHeight, count } = input;
  const overscan = input.overscan ?? 6;
  if (!(count > 0) || !(rowHeight > 0)) return { start: 0, end: 0 };
  // NaN / Infinity from a half-laid-out element must not poison the slice bounds.
  const scrollTop = Number.isFinite(input.scrollTop) ? input.scrollTop : 0;
  const viewportHeight = Number.isFinite(input.viewportHeight) ? input.viewportHeight : 0;
  const first = Math.min(Math.floor(Math.max(0, scrollTop) / rowHeight), count - 1);
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end: Math.max(start, end) };
}

/** Roving-tabindex arrow-key navigation for a tab list. Returns the new index, or null if the key is not handled. */
export function nextTabIndex(key: string, current: number, total: number): number | null {
  if (total <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % total;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + total) % total;
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return null;
  }
}

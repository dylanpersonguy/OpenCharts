import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __clearAdapter, setAdapter } from "../../adapter/registry.ts";
import type { OpenChartsAdapter } from "../../adapter/types.ts";
import { HlWatchlist } from "../ui/HlWatchlist.tsx";
import {
  categoryOf,
  countByFilter,
  filterWatchlist,
  nextTabIndex,
  windowRange,
  type WatchlistItem,
} from "../ui/watchlistModel.ts";
import type { HlMarket } from "../types.ts";

const items: WatchlistItem[] = [
  { name: "BTC", displayName: "BTC", category: "Crypto" },
  { name: "ETH", displayName: "ETH", category: "Crypto" },
  { name: "xyz:TSLA", displayName: "Tesla", category: "Stocks" },
  { name: "xyz:EUR", displayName: "EUR/USD", category: "Forex" },
  { name: "xyz:GOLD", displayName: "Gold", category: "Commodities" },
  { name: "xyz:SPX", displayName: "S&P 500", category: "Indices" },
  { name: "xyz:WEIRD", displayName: "Weird", category: "Whatever" },
  { name: "OLD", displayName: "Delisted", category: "Crypto", isActive: false },
];

describe("watchlist model", () => {
  const none = new Set<string>();

  it("maps unknown categories to Other", () => {
    expect(categoryOf({ name: "x", category: "Whatever" })).toBe("Other");
    expect(categoryOf({ name: "x" })).toBe("Other");
    expect(categoryOf({ name: "x", category: "Stocks" })).toBe("Stocks");
  });

  it("filters by category and hides inactive markets", () => {
    expect(filterWatchlist(items, { query: "", filter: "Crypto", favorites: none }).map((s) => s.name)).toEqual(["BTC", "ETH"]);
    expect(filterWatchlist(items, { query: "", filter: "Other", favorites: none }).map((s) => s.name)).toEqual(["xyz:WEIRD"]);
    expect(filterWatchlist(items, { query: "", filter: "all", favorites: none })).toHaveLength(7);
  });

  it("searches name and display name, case-insensitively", () => {
    expect(filterWatchlist(items, { query: "tesla", filter: "all", favorites: none }).map((s) => s.name)).toEqual(["xyz:TSLA"]);
    expect(filterWatchlist(items, { query: "TSLA", filter: "all", favorites: none }).map((s) => s.name)).toEqual(["xyz:TSLA"]);
    expect(filterWatchlist(items, { query: "s&p", filter: "Indices", favorites: none })).toHaveLength(1);
    expect(filterWatchlist(items, { query: "s&p", filter: "Crypto", favorites: none })).toHaveLength(0);
  });

  it("pins favourites first and supports a favourites-only tab", () => {
    const fav = new Set(["xyz:GOLD"]);
    expect(filterWatchlist(items, { query: "", filter: "all", favorites: fav })[0]?.name).toBe("xyz:GOLD");
    expect(filterWatchlist(items, { query: "", filter: "favorites", favorites: fav }).map((s) => s.name)).toEqual(["xyz:GOLD"]);
  });

  it("counts per tab", () => {
    const c = countByFilter(items, new Set(["BTC"]));
    expect(c).toMatchObject({ all: 7, favorites: 1, Crypto: 2, Stocks: 1, Forex: 1, Commodities: 1, Indices: 1, Other: 1 });
  });

  it("windows a long list to the visible rows plus overscan", () => {
    expect(windowRange({ scrollTop: 0, viewportHeight: 460, rowHeight: 46, count: 349, overscan: 5 })).toEqual({ start: 0, end: 15 });
    expect(windowRange({ scrollTop: 4600, viewportHeight: 460, rowHeight: 46, count: 349, overscan: 5 })).toEqual({ start: 95, end: 115 });
    expect(windowRange({ scrollTop: 99999, viewportHeight: 460, rowHeight: 46, count: 349 }).end).toBe(349);
    expect(windowRange({ scrollTop: 0, viewportHeight: 460, rowHeight: 46, count: 0 })).toEqual({ start: 0, end: 0 });
  });

  it("navigates tabs with arrow keys, wrapping", () => {
    expect(nextTabIndex("ArrowRight", 7, 8)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 8)).toBe(7);
    expect(nextTabIndex("Home", 3, 8)).toBe(0);
    expect(nextTabIndex("End", 3, 8)).toBe(7);
    expect(nextTabIndex("a", 3, 8)).toBeNull();
  });
});

const many = Array.from({ length: 349 }, (_, i) => ({
  name: i < 5 ? ["BTC", "ETH", "SOL", "xyz:TSLA", "xyz:EUR"][i]! : `COIN${String(i).padStart(3, "0")}`,
  displayName: i === 3 ? "Tesla" : null,
  category: i === 3 ? "Stocks" : i === 4 ? "Forex" : "Crypto",
}));

const tsla: HlMarket = {
  symbol: "xyz:TSLA",
  coin: "xyz:TSLA",
  dex: "xyz",
  dexIndex: 1,
  indexInMeta: 0,
  assetId: 110000,
  szDecimals: 2,
  maxLeverage: 10,
  onlyIsolated: true,
  category: "Stocks",
  displayName: "Tesla",
};

function renderList(onSelect: (s: string) => void = () => undefined) {
  return render(
    <HlWatchlist symbols={many} ticks={{}} selectedSymbol="BTC" onSelect={onSelect} />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  setAdapter({
    name: "hyperliquid",
    marketData: {
      registry: { load: () => Promise.resolve(), markets: () => [tsla], bySymbol: (s: string) => (s === tsla.symbol ? tsla : undefined) },
    },
  } as unknown as OpenChartsAdapter);
});
afterEach(() => __clearAdapter());

describe("HlWatchlist", () => {
  it("does not render all 349 rows", () => {
    renderList();
    const rendered = screen.getAllByRole("listitem").length;
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(60);
    expect(screen.getByRole("list", { name: "Markets" })).toHaveStyle({ height: `${349 * 46}px` });
  });

  it("filters by category tab and shows counts", async () => {
    renderList();
    expect(screen.getByRole("tab", { name: /^All\s*349$/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: /^Stocks/ }));
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Tesla");
  });

  it("searches", async () => {
    renderList();
    await userEvent.type(screen.getByRole("searchbox", { name: /search markets/i }), "tesla");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.type(screen.getByRole("searchbox"), "zzzz");
    expect(screen.getByTestId("watchlist-empty")).toBeInTheDocument();
  });

  it("shows the leverage cap and a HIP-3 badge for third-party markets only", async () => {
    renderList();
    await userEvent.click(screen.getByRole("tab", { name: /^Stocks/ }));
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent("up to 10x");
    expect(within(row).getByText("HIP-3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /^Forex/ }));
    expect(within(screen.getByRole("listitem")).queryByText("HIP-3")).toBeNull();
  });

  it("is keyboard accessible: arrow keys move between tabs, Enter selects a market", async () => {
    const picked: string[] = [];
    renderList((s: string) => void picked.push(s));
    screen.getByRole("tab", { name: /^All/ }).focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("tab", { name: /^Crypto/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /^Crypto/ })).toHaveFocus();
    await userEvent.tab(); // first row's favourite star
    await userEvent.tab(); // first row's market button
    await userEvent.keyboard("{Enter}");
    expect(picked.length).toBe(1);
  });

  it("persists favourites on the device and pins them under Favorites", async () => {
    const { unmount } = renderList();
    await userEvent.click(screen.getAllByRole("button", { name: /add .* to favorites/i })[1]!);
    expect(JSON.parse(window.localStorage.getItem("watchlist_favorites") ?? "[]")).toHaveLength(1);
    unmount();
    renderList();
    await userEvent.click(screen.getByRole("tab", { name: /^Favorites/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

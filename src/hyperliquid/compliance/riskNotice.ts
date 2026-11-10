import { useMemo } from "react";
import type { HlCategory, HlMarket } from "../types.ts";
import { classifyMarket } from "../symbols.ts";

export interface MarketRiskNotice {
  title: string;
  body: string;
}

/** Leverage above this triggers an extra warning. */
export const HIGH_LEVERAGE_THRESHOLD = 20;

type NoticeInput = Pick<HlMarket, "dex" | "category"> &
  Partial<Pick<HlMarket, "maxLeverage" | "onlyIsolated" | "marginMode" | "displayName">>;

const ORACLE_CATEGORIES: ReadonlySet<HlCategory> = new Set(["Stocks", "Forex", "Commodities", "Indices"]);

/**
 * The risk notice for a market, or null for core-dex markets (dex === "").
 * Pure; the text is the single source for the badge, tooltip and order ticket.
 */
export function marketRiskNotice(m: NoticeInput): MarketRiskNotice | null {
  if (m.dex === "") return null;
  const parts: string[] = [
    `This is a third-party deployed market (HIP-3), deployed by "${m.dex}". Its oracle, leverage limits and settlement are controlled by the deployer, and trading can be halted.`,
  ];
  if (m.onlyIsolated || m.marginMode) {
    parts.push(
      m.marginMode === "strictIsolated"
        ? "Isolated margin only: margin cannot be removed once added."
        : "Isolated margin only: this position cannot share margin with your other positions.",
    );
  }
  if (typeof m.maxLeverage === "number" && m.maxLeverage > HIGH_LEVERAGE_THRESHOLD) {
    parts.push(
      `High leverage (up to ${m.maxLeverage}x): a small price move can liquidate your position and you can lose all of your margin.`,
    );
  }
  if (ORACLE_CATEGORIES.has(m.category)) {
    parts.push(
      "The price follows an oracle and may be stale or jump when the underlying market is closed (nights, weekends, holidays).",
    );
  }
  return { title: `Third-party market (${m.dex})`, body: parts.join(" ") };
}

type MarketLookup = (symbol: string) => HlMarket | undefined;
let lookup: MarketLookup | undefined;

/** Let the integrator hand over the market registry: `registerMarketLookup((s) => registry.bySymbol(s))`. */
export function registerMarketLookup(fn: MarketLookup | undefined): void {
  lookup = fn;
}

export function noticeForSymbol(symbol: string): MarketRiskNotice | null {
  const m = lookup?.(symbol);
  if (m) return marketRiskNotice(m);
  const i = symbol.indexOf(":");
  if (i <= 0) return null;
  const dex = symbol.slice(0, i);
  return marketRiskNotice({ dex, category: classifyMarket(symbol, dex) });
}

/**
 * Risk notice for an OpenCharts symbol string ("BTC", "xyz:TSLA").
 * Uses the registered registry when available (gives leverage / isolated info);
 * otherwise derives dex and category from the symbol alone.
 */
export function useMarketRiskNotice(symbol: string): MarketRiskNotice | null {
  return useMemo(() => noticeForSymbol(symbol), [symbol]);
}

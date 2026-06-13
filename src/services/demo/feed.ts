import { publish } from "./bus.ts";
import { getTickPrices } from "./candles.ts";
import { mark } from "./engine.ts";
import { DEMO_SYMBOLS } from "./instruments.ts";

/**
 * Demo market-data feed. Replays the bundled REAL 1m closes for every symbol
 * as a forward-moving tick stream at the current wall-clock time, so the chart
 * and watchlist look live while every price is genuine market data. Drives the
 * paper-trading engine's mark-to-market via engine.mark().
 */

const TICK_MS = 600;

type SymbolCursor = { symbol: string; prices: number[]; index: number; spread: number };

let timer: ReturnType<typeof setInterval> | null = null;
let cursors: SymbolCursor[] = [];

function buildCursors(): SymbolCursor[] {
  return DEMO_SYMBOLS.map((s) => {
    const prices = getTickPrices(s.name);
    const seed = prices[prices.length - 1] ?? 0;
    return { symbol: s.name, prices, index: 0, spread: Math.max(s.tickSize, seed * 0.0001) };
  });
}

function emitTick(cursor: SymbolCursor): void {
  if (cursor.prices.length === 0) return;
  const price = cursor.prices[cursor.index]!;
  cursor.index = (cursor.index + 1) % cursor.prices.length;
  const half = cursor.spread / 2;
  publish("market-data", {
    eventType: "MarketTick",
    symbol: cursor.symbol,
    bid: price - half,
    ask: price + half,
    occurredAt: Date.now(),
  });
  mark(cursor.symbol, price);
}

export function startDemoFeed(): void {
  if (timer) return;
  cursors = buildCursors();
  // Seed an initial price for every symbol so panels render immediately.
  for (const c of cursors) emitTick(c);
  timer = setInterval(() => {
    for (const c of cursors) emitTick(c);
  }, TICK_MS);
}

export function stopDemoFeed(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

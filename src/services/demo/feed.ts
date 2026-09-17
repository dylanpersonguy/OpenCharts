import { DEMO_CHANNELS, publish } from "./bus.ts";
import { getTickPrices, primeTickPrices } from "./candles.ts";
import { mark } from "./engine.ts";
import { DEMO_SYMBOLS } from "./instruments.ts";

/**
 * Demo market-data feed. Replays the bundled REAL 1m closes for every symbol
 * as a tick stream at the current wall-clock time, so the chart and watchlist
 * look live while every price is genuine market data. Drives the paper-trading
 * engine's mark-to-market via engine.mark().
 *
 * Replay starts at the most recent close — the same price the chart's last
 * candle shows — and walks backwards through history, reversing direction at
 * each end (ping-pong). A forward-from-the-oldest-bar replay would open on a
 * price hundreds of bars away from the chart and then jump discontinuously
 * every time the cursor wrapped around.
 */

const TICK_MS = 600;

type SymbolCursor = {
  symbol: string;
  prices: number[];
  index: number;
  /** +1 walks toward newer prices, -1 toward older ones. */
  direction: 1 | -1;
  spread: number;
};

let timer: ReturnType<typeof setInterval> | null = null;
let cursors: SymbolCursor[] = [];

function buildCursors(): SymbolCursor[] {
  return DEMO_SYMBOLS.map((s) => {
    const prices = getTickPrices(s.name);
    const seed = prices[prices.length - 1] ?? 0;
    return {
      symbol: s.name,
      prices,
      index: Math.max(0, prices.length - 1),
      direction: -1,
      spread: Math.max(s.tickSize, seed * 0.0001),
    };
  });
}

function emitTick(cursor: SymbolCursor): void {
  const price = cursor.prices[cursor.index];
  if (price == null || !Number.isFinite(price) || price <= 0) return;

  const half = cursor.spread / 2;
  publish(DEMO_CHANNELS.ticks, {
    eventType: "MarketTick",
    symbol: cursor.symbol,
    bid: price - half,
    ask: price + half,
    occurredAt: Date.now(),
  });
  mark(cursor.symbol, price);
}

/** Step the cursor one tick, bouncing off either end of the series. */
function advance(cursor: SymbolCursor): void {
  if (cursor.prices.length <= 1) return;
  const next = cursor.index + cursor.direction;
  if (next < 0 || next >= cursor.prices.length) {
    cursor.direction = cursor.direction === 1 ? -1 : 1;
    cursor.index += cursor.direction;
  } else {
    cursor.index = next;
  }
}

let starting = false;

export function startDemoFeed(): void {
  if (timer || starting) return;
  starting = true;
  // The 1m series are loaded on demand, so wait for them before ticking.
  void primeTickPrices(DEMO_SYMBOLS.map((s) => s.name))
    .then(() => {
      starting = false;
      if (timer) return; // stopped again while loading
      cursors = buildCursors();
      // Seed an initial price for every symbol so panels render immediately.
      for (const c of cursors) emitTick(c);
      timer = setInterval(() => {
        for (const c of cursors) {
          advance(c);
          emitTick(c);
        }
      }, TICK_MS);
    })
    .catch(() => {
      starting = false;
    });
}

export function stopDemoFeed(): void {
  if (timer) clearInterval(timer);
  timer = null;
  starting = false;
  cursors = [];
}

/** True while the replay interval is running (used by tests and the ws client). */
export function isDemoFeedRunning(): boolean {
  return timer !== null;
}

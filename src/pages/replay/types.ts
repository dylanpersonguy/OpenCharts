import type { ReactNode } from "react";
import type { Account, Candle, Symbol } from "../../services/schemas.ts";
import type { TickEntry } from "../../services/store.tsx";
import type { Timeframe } from "../trading/constants.ts";

/** A trade marker drawn on the chart (entry arrow / exit P&L bubble). */
export interface ReplayTradeMarker {
  id: string;
  type: "entry" | "exit" | "violation";
  timestamp: string;
  symbolName: string | null;
  side: string | null;
  price: number | null;
  pnl: number | null;
}

/**
 * Everything the trading terminal needs to run against a replay session
 * instead of the live feed. Passed to `<TradingPage replay={…} />`.
 */
export interface ReplayBindings {
  sessionId: string;
  accountId: string;
  symbol: string;
  symbols: Symbol[];
  candles: Candle[];
  /** Keyed by symbol, shaped like the live store's ticks. */
  ticks: Record<string, TickEntry>;
  account: Pick<Account, "balance" | "equity" | "margin" | "freeMargin">;
  timeframe: Timeframe;
  timeframes: readonly Timeframe[];
  onTimeframeChange: (tf: Timeframe) => void;
  tradeMarkers: ReplayTradeMarker[];
  /** Changes when the chart window is rebuilt (jump / timeframe switch). */
  viewKey: number;
  onChartClick?: (timeSec: number, price: number) => void;
  /** localStorage key for this session's drawings on its symbol. */
  drawingsKey: string;
  /** Replay transport controls rendered under the toolbar. */
  controls: ReactNode;
  /** Back-to-sessions navigation rendered in the toolbar. */
  nav: ReactNode;
  /** Journal tab content in the bottom panel. */
  journal: ReactNode;
}

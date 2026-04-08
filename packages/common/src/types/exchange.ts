/** Order-book and aggregated-price types for multi-exchange aggregation. */

export interface OrderBookLevel {
  price: number;
  amount: number;
  exchange: string;
}

export interface AggregatedOrderBook {
  symbol: string;
  timestamp: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  /** Best bid across all connected exchanges */
  bestBid: OrderBookLevel | null;
  /** Best ask across all connected exchanges */
  bestAsk: OrderBookLevel | null;
  /** Volume-weighted average mid-price */
  vwap: number | null;
  /** Spread (bestAsk.price − bestBid.price) */
  spread: number | null;
  exchanges: string[];
}

export interface ExchangeStatus {
  id: string;
  name: string;
  connected: boolean;
  symbols: string[];
  lastUpdate: number | null;
  /** Latency in ms for the most recent request */
  latencyMs: number | null;
}

export interface AggregatedTicker {
  symbol: string;
  /** VWAP price across all exchanges */
  price: number;
  /** Per-exchange prices */
  prices: { exchange: string; price: number; volume: number }[];
  /** Total volume across exchanges */
  totalVolume: number;
  timestamp: number;
}

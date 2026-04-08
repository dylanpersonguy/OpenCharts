/** Normalized market event — the internal format for all market data flowing through the system. */
export interface MarketEvent {
  type: 'trade' | 'quote' | 'tick';
  symbol: string;
  timestamp: number; // unix ms
  price: number;
  volume: number;
  /** Bid price (for quote events) */
  bid?: number;
  /** Ask price (for quote events) */
  ask?: number;
  /** Bid size (for quote events) */
  bidSize?: number;
  /** Ask size (for quote events) */
  askSize?: number;
  /** Source provider identifier */
  provider: string;
}

export type AssetClass = 'forex' | 'crypto' | 'stocks' | 'futures' | 'synthetic' | 'custom';

export interface MarketSession {
  open: string;  // HH:mm
  close: string; // HH:mm
  timezone: string;
}

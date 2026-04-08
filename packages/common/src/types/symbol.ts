import type { AssetClass, MarketSession } from './market';

export interface SymbolInfo {
  ticker: string;
  name: string;
  description: string;
  exchange: string;
  assetClass: AssetClass;
  session: MarketSession;
  timezone: string;
  minTick: number;
  pricescale: number;
  /** Supported resolutions for this symbol */
  supportedResolutions: string[];
  /** Whether the symbol has intraday data */
  hasIntraday: boolean;
  /** Logo URL if available */
  logoUrl?: string;
}

export interface SymbolSearchResult {
  ticker: string;
  name: string;
  exchange: string;
  assetClass: AssetClass;
}

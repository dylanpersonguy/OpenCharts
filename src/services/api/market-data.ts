import { request } from "./request";

export interface MarketDataSymbol {
  id: string;
  name: string;
  displayName: string | null;
  category: string;
  contractSize: number;
  tickSize: number;
  tickValue: number;
  marginPercent: number;
  maxLeverage: number;
  commission: number;
  swapLong: number;
  swapShort: number;
  tradingHoursStart: string | null;
  tradingHoursEnd: string | null;
  isActive: boolean;
  // Optional/extra fields backend may include
  symbol?: string;
  digits?: number;
  pipDigits?: number;
  [key: string]: unknown;
}

export interface MarketDataCandle {
  time: number;
  timestamp: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDataCandleMetadata {
  historicalCoverageStart: number | null;
  isPartial: boolean;
  backfillQueued: boolean;
}

export interface MarketDataCandlesPayload {
  candles: MarketDataCandle[];
  metadata: MarketDataCandleMetadata;
}

export interface MarketDataTick {
  symbol: string;
  bid: number;
  ask: number;
  timestamp?: number | string;
}

export interface EconomicEvent {
  id: string;
  time: string;
  currency: string;
  event: string;
  impact: "low" | "medium" | "high";
  forecast?: string;
  previous?: string;
  actual?: string;
  country: string;
  [key: string]: unknown;
}

export const marketdataApi = {
  // ── Market Data ──
  getSymbols: () => request<MarketDataSymbol[]>("/market-data/symbols"),

  getTick: (symbol: string) => request<MarketDataTick>(`/market-data/ticks/${symbol}`),

  getTicks: () => request<Record<string, MarketDataTick>>("/market-data/ticks"),

  getCandles: (
    symbol: string,
    timeframe: string,
    limit?: number,
    range?: { fromMs: number; toMs: number },
  ) => {
    const payload: Record<string, number | string> = { timeframe };
    if (limit != null) payload.limit = limit;
    if (range) {
      payload.from = range.fromMs;
      payload.to = range.toMs;
    }
    return request<MarketDataCandle[] | MarketDataCandlesPayload>(
      `/market-data/candles/${symbol}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ).then((res) => (Array.isArray(res) ? res : res.candles));
  },

  getCandlesWithMeta: (
    symbol: string,
    timeframe: string,
    limit?: number,
    range?: { fromMs: number; toMs: number },
  ): Promise<MarketDataCandlesPayload> => {
    const payload: Record<string, number | string> = { timeframe };
    if (limit != null) payload.limit = limit;
    if (range) {
      payload.from = range.fromMs;
      payload.to = range.toMs;
    }
    return request<MarketDataCandle[] | MarketDataCandlesPayload>(
      `/market-data/candles/${symbol}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ).then((res) =>
      Array.isArray(res)
        ? {
            candles: res,
            metadata: { isPartial: false, backfillQueued: false, historicalCoverageStart: null },
          }
        : res,
    );
  },

  getMarketDataHealth: () => request<Record<string, unknown>>("/market-data/health"),

  getEconomicCalendar: (currencies?: string[], from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (currencies?.length) params.set("currencies", currencies.join(","));
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return request<EconomicEvent[]>(`/market-data/economic-calendar?${params.toString()}`);
  },

  getMarketDataStaleness: () => request<Record<string, unknown>>("/market-data/staleness"),
};

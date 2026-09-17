import type { Candle, Symbol as TradingSymbol } from "../schemas.ts";

export interface BinanceSearchResult {
  symbol: string; // e.g. "DOGEUSD"
  binancePair: string; // e.g. "DOGEUSDT"
  baseAsset: string; // e.g. "DOGE"
  displayName: string; // e.g. "Dogecoin"
  price: number;
  change24h: number;
  volume24h: number;
  tickSize: number;
}

// Popular crypto names map for friendly display
const CRYPTO_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  BNB: "BNB",
  XRP: "XRP",
  ADA: "Cardano",
  DOGE: "Dogecoin",
  AVAX: "Avalanche",
  LINK: "Chainlink",
  DOT: "Polkadot",
  MATIC: "Polygon",
  NEAR: "NEAR Protocol",
  SUI: "Sui",
  APT: "Aptos",
  PEPE: "Pepe",
  SHIB: "Shiba Inu",
  UNI: "Uniswap",
  LTC: "Litecoin",
  ATOM: "Cosmos",
  XLM: "Stellar",
  FIL: "Filecoin",
  INJ: "Injective",
  RENDER: "Render",
  FET: "Artificial Superintelligence Alliance",
  ICP: "Internet Computer",
  ARB: "Arbitrum",
  OP: "Optimism",
  TIA: "Celestia",
  SEI: "Sei",
  KAS: "Kaspa",
  STX: "Stacks",
  FTM: "Fantom",
  AAVE: "Aave",
  ALGO: "Algorand",
  RUNE: "THORChain",
  WIF: "dogwifhat",
  BONK: "Bonk",
  FLOKI: "Floki",
};

let _cachedTickers: BinanceSearchResult[] = Object.entries(CRYPTO_NAMES).map(([base, name]) => ({
  symbol: `${base}USD`,
  binancePair: `${base}USDT`,
  baseAsset: base,
  displayName: name,
  price: 0,
  change24h: 0,
  volume24h: 1000000,
  tickSize: base === "DOGE" ? 0.0001 : base === "SHIB" || base === "PEPE" ? 0.00000001 : 0.01,
}));
let _lastFetchTime = 0;

export function getCachedTickers(): BinanceSearchResult[] {
  return _cachedTickers;
}

// Eagerly prefetch in background so live prices and full list of pairs are ready immediately
void getBinanceTickers();

export async function getBinanceTickers(): Promise<BinanceSearchResult[]> {
  const now = Date.now();
  // Cache for 30 seconds
  if (_cachedTickers.length > 0 && now - _lastFetchTime < 30_000) {
    return _cachedTickers;
  }

  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/24hr");
    if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
    const data = (await res.json()) as Array<{
      symbol: string;
      lastPrice: string;
      priceChangePercent: string;
      quoteVolume: string;
    }>;

    // Filter USDT spot trading pairs
    const usdtPairs = data
      .filter((item) => item.symbol.endsWith("USDT") && !item.symbol.includes("UP") && !item.symbol.includes("DOWN"))
      .map((item) => {
        const baseAsset = item.symbol.replace("USDT", "");
        const price = parseFloat(item.lastPrice) || 0;
        const change24h = parseFloat(item.priceChangePercent) || 0;
        const volume24h = parseFloat(item.quoteVolume) || 0;

        let tickSize = 0.01;
        if (price < 0.001) tickSize = 0.00000001;
        else if (price < 0.1) tickSize = 0.0001;
        else if (price < 10) tickSize = 0.001;

        return {
          symbol: `${baseAsset}USD`,
          binancePair: item.symbol,
          baseAsset,
          displayName: CRYPTO_NAMES[baseAsset] ?? baseAsset,
          price,
          change24h,
          volume24h,
          tickSize,
        };
      })
      .sort((a, b) => b.volume24h - a.volume24h);

    if (usdtPairs.length > 0) {
      _cachedTickers = usdtPairs;
      _lastFetchTime = now;
      return _cachedTickers;
    }
  } catch (err) {
    console.warn("Could not fetch 24hr tickers from Binance, falling back:", err);
  }

  // Fallback default list
  if (_cachedTickers.length === 0) {
    _cachedTickers = Object.entries(CRYPTO_NAMES).map(([base, name]) => ({
      symbol: `${base}USD`,
      binancePair: `${base}USDT`,
      baseAsset: base,
      displayName: name,
      price: 0,
      change24h: 0,
      volume24h: 1000000,
      tickSize: 0.01,
    }));
  }

  return _cachedTickers;
}

export function symbolToBinancePair(symbol: string): string {
  const clean = symbol.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (clean.endsWith("USDT")) return clean;
  if (clean.endsWith("USD")) return `${clean}T`;
  return `${clean}USDT`;
}

export function binancePairToSymbol(binancePair: string): string {
  return binancePair.replace("USDT", "USD");
}

export async function fetchBinanceKlines(
  binancePair: string,
  timeframe: string,
  limit = 1000,
): Promise<Candle[]> {
  const safeLimit = Math.min(Math.max(limit, 10), 1000);
  const url = `https://api.binance.com/api/v3/klines?symbol=${binancePair}&interval=${timeframe}&limit=${safeLimit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance klines error (${binancePair} ${timeframe}): ${res.status}`);
  const rows = (await res.json()) as (number | string)[][];

  return rows.map((row) => ({
    time: Math.floor(Number(row[0]) / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

export function createSymbolDefinition(
  name: string,
  displayName: string,
  tickSize = 0.01,
): TradingSymbol {
  return {
    id: name,
    name,
    displayName,
    category: "CRYPTO",
    contractSize: 1,
    tickSize,
    tickValue: tickSize,
    marginPercent: 1,
    maxLeverage: 100,
    commission: 0,
    swapLong: 0,
    swapShort: 0,
    tradingHoursStart: null,
    tradingHoursEnd: null,
    isActive: true,
  };
}

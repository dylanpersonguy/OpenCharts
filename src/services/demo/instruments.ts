import type { Symbol } from "../schemas.ts";

/**
 * Demo instruments. These mirror the crypto pairs whose real historical OHLC
 * is bundled under ./data (see scripts/fetch-demo-data.mjs). Quoted in USD.
 */
function crypto(name: string, displayName: string, tickSize: number): Symbol {
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

const DEFAULT_SYMBOLS: Symbol[] = [
  crypto("BTCUSD", "Bitcoin", 0.01),
  crypto("ETHUSD", "Ethereum", 0.01),
  crypto("SOLUSD", "Solana", 0.01),
  crypto("BNBUSD", "BNB", 0.01),
  crypto("XRPUSD", "XRP", 0.0001),
  crypto("ADAUSD", "Cardano", 0.0001),
];

const CUSTOM_SYMBOLS_KEY = "oc_custom_symbols";

function loadCustomSymbols(): Symbol[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SYMBOLS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomSymbols(list: Symbol[]): void {
  try {
    const customOnly = list.filter((s) => !DEFAULT_SYMBOLS.some((d) => d.name === s.name));
    localStorage.setItem(CUSTOM_SYMBOLS_KEY, JSON.stringify(customOnly));
  } catch {
    /* ignore */
  }
}

export const DEMO_SYMBOLS: Symbol[] = [...DEFAULT_SYMBOLS, ...loadCustomSymbols()];

export const DEMO_SYMBOL_NAMES = DEMO_SYMBOLS.map((s) => s.name);

export function getDemoSymbol(name: string): Symbol | undefined {
  return DEMO_SYMBOLS.find((s) => s.name === name);
}

export function addDynamicSymbol(symbol: Symbol): Symbol {
  const existing = DEMO_SYMBOLS.find((s) => s.name === symbol.name);
  if (existing) return existing;

  DEMO_SYMBOLS.push(symbol);
  if (!DEMO_SYMBOL_NAMES.includes(symbol.name)) {
    DEMO_SYMBOL_NAMES.push(symbol.name);
  }
  saveCustomSymbols(DEMO_SYMBOLS);
  return symbol;
}

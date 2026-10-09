import type { Symbol } from "../schemas.ts";
import type { EngineConfig, ReplaySymbol } from "./engine/types.ts";

/**
 * Bar-replay instruments. Kept separate from DEMO_SYMBOLS: replay prices are
 * historical bid bars with a synthetic fixed spread on top.
 */

export interface ReplayInstrumentDefaults {
  /** Fixed spread in price units (ask = bid + spread). */
  readonly defaultSpread: number;
  /** Integer scale used when bars are stored as integers (price * scale). */
  readonly priceScale: number;
  readonly source: "binance" | "csv";
  readonly digits: number;
}

function replaySymbol(
  name: ReplaySymbol,
  displayName: string,
  category: string,
  contractSize: number,
  tickSize: number,
): Symbol {
  return {
    id: name,
    name,
    displayName,
    category,
    contractSize,
    tickSize,
    tickValue: tickSize * contractSize,
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

export const REPLAY_SYMBOLS: readonly Symbol[] = [
  replaySymbol("BTCUSD", "Bitcoin", "CRYPTO", 1, 0.01),
  replaySymbol("XAUUSD", "Gold", "METALS", 100, 0.01),
];

export const REPLAY_SYMBOL_NAMES: readonly ReplaySymbol[] = ["BTCUSD", "XAUUSD"];

export const REPLAY_INSTRUMENT_DEFAULTS: Readonly<Record<ReplaySymbol, ReplayInstrumentDefaults>> = {
  BTCUSD: { defaultSpread: 10, priceScale: 100, source: "binance", digits: 2 },
  XAUUSD: { defaultSpread: 0.3, priceScale: 1000, source: "csv", digits: 2 },
};

const DEFAULT_LEVERAGE = 100;
const DEFAULT_STARTING_BALANCE = 100_000;

export function isReplaySymbol(name: string): name is ReplaySymbol {
  return (REPLAY_SYMBOL_NAMES as readonly string[]).includes(name);
}

export function getReplaySymbol(name: string): Symbol | undefined {
  return REPLAY_SYMBOLS.find((s) => s.name === name);
}

export type EngineConfigOverrides = Partial<Omit<EngineConfig, "symbol" | "accountId">> & {
  readonly accountId: string;
};

/** Engine config for `symbol` from the instrument spec and defaults, with overrides applied. */
export function engineConfigFor(symbol: ReplaySymbol, overrides: EngineConfigOverrides): EngineConfig {
  const spec = getReplaySymbol(symbol);
  if (!spec) throw new Error(`Unknown replay symbol: ${symbol}`);
  return {
    symbol,
    contractSize: spec.contractSize,
    tickSize: spec.tickSize,
    spread: REPLAY_INSTRUMENT_DEFAULTS[symbol].defaultSpread,
    commissionPerLotPerSide: 0,
    leverage: DEFAULT_LEVERAGE,
    startingBalance: DEFAULT_STARTING_BALANCE,
    ...overrides,
  };
}

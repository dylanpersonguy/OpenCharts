/**
 * HFT Arbitrage Bot API client
 */
import { request } from "./api/request";

/** Per-symbol gap threshold overrides. Both fields are optional. */
export interface HftBotSymbolSettings {
  /** Overrides the global minPipGap for this symbol only */
  minPipGap?: number;
  /** Rejects gaps larger than this (spike / bad-data filter). Absent = no ceiling. */
  maxGapPips?: number;
}

export interface HftBotConfig {
  id: string;
  accountId: string;
  userId: string;
  firmId: string;
  symbols: string[];
  /** Global minimum pip gap — applies to any symbol not listed in symbolSettings */
  minPipGap: number;
  /** Per-symbol overrides: { "XAUUSD": { minPipGap: 10, maxGapPips: 100 }, ... }
   *  Missing symbols fall back to the global minPipGap. */
  symbolSettings: Record<string, HftBotSymbolSettings> | null;
  /** Consecutive readings the gap must exceed minPipGap before firing.
   *  1 = fire immediately (default). 2–3 = require 1–1.5s sustained gap (filters noise). */
  gapPersistenceReadings: number;
  /** Number of positions to open per gap signal (burst mode). Default 1. */
  tradesPerSignal: number;
  /** Only enter when fast-feed momentum aligns with the signal direction */
  enableMomentumFilter: boolean;
  /** Close position if gap has not converged after timeExitFactor × measured lag */
  enableTimeExit: boolean;
  /** Multiplier on measured lag for the lag-window exit (default 1.0) */
  timeExitFactor: number;
  /** Tighten TP as the gap closes to capture profit before reversal */
  enableTrailingTp: boolean;
  /** Anchor TP to live price at entry (captures ~100% of net gap). False = WP7 ~85% model */
  enableAdaptiveTp: boolean;
  /** Scale lot size by gap confidence: larger gap relative to avg = larger position */
  enableDynamicLotSizing: boolean;
  /** Maximum lot multiplier when dynamic sizing is on (e.g. 1.5 = up to 50% extra) */
  maxLotMultiplier: number;
  /** Minimum lot multiplier when dynamic sizing is on (e.g. 0.5 = floor at half size) */
  minLotMultiplier: number;
  /**
   * Adapt the per-symbol gap threshold to the symbol's own recent activity.
   * Threshold = EMA(avgGapPips) × dynamicThresholdMultiplier, bounded to
   * [staticMin × 0.3, staticMin × 4.0] so it can't go wildly off-config.
   * Falls back to the static minPipGap until at least 10 samples exist.
   */
  enableDynamicThreshold: boolean;
  /** How many times the EMA'd average a gap must exceed before firing. Default 1.2. */
  dynamicThresholdMultiplier: number;
  /** EMA smoothing factor (0–1). Smaller = slower adaptation. Default 0.1 (~10s half-life at 60fps). */
  dynamicThresholdAlpha: number;
  lotSize: number;
  maxPositions: number;
  dailyLossCap: number | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type HftBotConfigInput = Partial<
  Pick<HftBotConfig,
    "symbols" | "minPipGap" | "symbolSettings" | "gapPersistenceReadings"
    | "tradesPerSignal"
    | "enableMomentumFilter" | "enableTimeExit" | "timeExitFactor" | "enableTrailingTp"
    | "enableAdaptiveTp" | "enableDynamicLotSizing" | "maxLotMultiplier" | "minLotMultiplier"
    | "enableDynamicThreshold" | "dynamicThresholdMultiplier" | "dynamicThresholdAlpha"
    | "lotSize" | "maxPositions" | "dailyLossCap"
  >
>;

export async function getBotConfig(accountId: string): Promise<HftBotConfig> {
  return request<HftBotConfig>(`/hft-bot/${accountId}`);
}

export async function saveBotConfig(
  accountId: string,
  config: HftBotConfigInput,
): Promise<HftBotConfig> {
  return request<HftBotConfig>(`/hft-bot/${accountId}`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export async function toggleBot(accountId: string, enabled: boolean): Promise<HftBotConfig> {
  return request<HftBotConfig>(`/hft-bot/${accountId}/toggle`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

export async function fetchLivePrices(
  symbols: string[],
): Promise<Record<string, { bid: number; ask: number }>> {
  if (symbols.length === 0) return {};
  return request<Record<string, { bid: number; ask: number }>>(
    `/market-data/live-prices?symbols=${symbols.join(",")}`,
  );
}

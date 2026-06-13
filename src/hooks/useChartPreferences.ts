import { useEffect, useState } from "react";
import type { MagnetMode } from "../pages/trading/constants.ts";
import { useAuthStore } from "../services/store.tsx";
import {
  readTraderPrefs as readScopedTraderPrefs,
  writeTraderPrefs as writeScopedTraderPrefs,
} from "./useTraderPreferences.ts";

export interface ChartPreferences {
  showBidLine: boolean;
  showAskLine: boolean;
  overlayPositionsOnChart: boolean;
  /** Snap drawing anchors to nearby candle O/H/L/C values. */
  drawingMagnet: boolean;
  /** Magnet mode: off / weak (snap near) / strong (always snap to OHLC). */
  magnetMode: MagnetMode;
  /** Keep the drawing tool armed after each placement. */
  stayInDrawingMode: boolean;
  /** Plugin IDs that are currently active (persisted across page loads). */
  activePlugins: string[];
  // ── Appearance (Chart Settings dialog) ──
  /** Hex override for up candles; empty string = theme default. */
  candleUpColor: string;
  /** Hex override for down candles; empty string = theme default. */
  candleDownColor: string;
  // ── Color overrides (Chart Settings → Colors; empty = theme default) ──
  colorBackground: string;
  colorGrid: string;
  colorScaleText: string;
  colorCrosshair: string;
  colorBidLine: string;
  colorAskLine: string;
  colorPositionLong: string;
  colorPositionShort: string;
  colorOrderLine: string;
  colorTpLine: string;
  colorSlLine: string;
  // ── Chart templates ──
  /** Name of the template the chart currently tracks ("" = none). */
  activeChartTemplate: string;
  /** Auto-save settings changes back to the active template. */
  chartTemplateAutosave: boolean;
  showWicks: boolean;
  showCandleBorders: boolean;
  showVolume: boolean;
  showGrid: boolean;
  showWatermark: boolean;
  showCountdown: boolean;
  showOhlcLegend: boolean;
  // ── Challenge-aware overlays ──
  /** Master switch for rule-derived price lines (daily loss / max DD / target). */
  challengeOverlay: boolean;
  challengeDailyLossLine: boolean;
  challengeMaxDrawdownLine: boolean;
  challengeProfitTargetLine: boolean;
}

type TraderPrefs = Record<string, string>;

const CHART_PREFS_UPDATED_EVENT = "chart-preferences-updated";

const DEFAULT_CHART_PREFS: ChartPreferences = {
  showBidLine: true,
  showAskLine: true,
  overlayPositionsOnChart: true,
  drawingMagnet: false,
  magnetMode: "none",
  stayInDrawingMode: false,
  activePlugins: [],
  candleUpColor: "",
  candleDownColor: "",
  colorBackground: "",
  colorGrid: "",
  colorScaleText: "",
  colorCrosshair: "",
  colorBidLine: "",
  colorAskLine: "",
  colorPositionLong: "",
  colorPositionShort: "",
  colorOrderLine: "",
  colorTpLine: "",
  colorSlLine: "",
  activeChartTemplate: "",
  chartTemplateAutosave: false,
  showWicks: true,
  showCandleBorders: true,
  showVolume: true,
  showGrid: true,
  showWatermark: true,
  showCountdown: true,
  showOhlcLegend: true,
  challengeOverlay: false,
  challengeDailyLossLine: false,
  challengeMaxDrawdownLine: false,
  challengeProfitTargetLine: false,
};

/** Boolean preference keys read straight through `toBool` with their default. */
const BOOL_PREF_KEYS = [
  "showBidLine",
  "showAskLine",
  "overlayPositionsOnChart",
  "drawingMagnet",
  "stayInDrawingMode",
  "showWicks",
  "showCandleBorders",
  "showVolume",
  "showGrid",
  "showWatermark",
  "showCountdown",
  "showOhlcLegend",
  "challengeOverlay",
  "challengeDailyLossLine",
  "challengeMaxDrawdownLine",
  "challengeProfitTargetLine",
  "chartTemplateAutosave",
] as const;

/** String preference keys stored raw (empty string allowed). */
const STRING_PREF_KEYS = [
  "candleUpColor",
  "candleDownColor",
  "colorBackground",
  "colorGrid",
  "colorScaleText",
  "colorCrosshair",
  "colorBidLine",
  "colorAskLine",
  "colorPositionLong",
  "colorPositionShort",
  "colorOrderLine",
  "colorTpLine",
  "colorSlLine",
  "activeChartTemplate",
] as const;

/**
 * Preference keys captured in a chart template snapshot — appearance, colors
 * and overlay choices. Deliberately excludes input behavior (magnet, stay-in-
 * drawing-mode) and the template bookkeeping keys themselves.
 */
export const TEMPLATE_PREF_KEYS = [
  "showBidLine",
  "showAskLine",
  "overlayPositionsOnChart",
  "showWicks",
  "showCandleBorders",
  "showVolume",
  "showGrid",
  "showWatermark",
  "showCountdown",
  "showOhlcLegend",
  "challengeOverlay",
  "challengeDailyLossLine",
  "challengeMaxDrawdownLine",
  "challengeProfitTargetLine",
  "candleUpColor",
  "candleDownColor",
  "colorBackground",
  "colorGrid",
  "colorScaleText",
  "colorCrosshair",
  "colorBidLine",
  "colorAskLine",
  "colorPositionLong",
  "colorPositionShort",
  "colorOrderLine",
  "colorTpLine",
  "colorSlLine",
] as const;

export type TemplatePrefKey = (typeof TEMPLATE_PREF_KEYS)[number];

function toMagnetMode(input: string | undefined): MagnetMode | undefined {
  return input === "weak" || input === "strong" || input === "none" ? input : undefined;
}

function readTraderPrefs(): TraderPrefs {
  const userId = useAuthStore.getState().user?.id;
  return readScopedTraderPrefs(userId);
}

function dispatchChartPrefsUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHART_PREFS_UPDATED_EVENT));
}

function toBool(input: string | undefined, fallback: boolean): boolean {
  if (input == null) return fallback;
  if (input === "true") return true;
  if (input === "false") return false;
  return fallback;
}

function toStringArray(input: string | undefined, fallback: string[]): string[] {
  if (input == null) return fallback;
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? (parsed as string[]) : fallback;
  } catch {
    return fallback;
  }
}

export function getChartPreferencesFromStorage(): ChartPreferences {
  const prefs = readTraderPrefs();
  const result = { ...DEFAULT_CHART_PREFS };
  for (const key of BOOL_PREF_KEYS) {
    result[key] = toBool(prefs[key], DEFAULT_CHART_PREFS[key]);
  }
  for (const key of STRING_PREF_KEYS) {
    result[key] = prefs[key] ?? DEFAULT_CHART_PREFS[key];
  }
  // Migrate the old boolean magnet flag to the tri-state when unset.
  result.magnetMode =
    toMagnetMode(prefs.magnetMode) ?? (toBool(prefs.drawingMagnet, false) ? "weak" : "none");
  result.activePlugins = toStringArray(prefs.activePlugins, DEFAULT_CHART_PREFS.activePlugins);
  return result;
}

export function updateChartPreferences(patch: Partial<ChartPreferences>): TraderPrefs {
  const next: TraderPrefs = { ...readTraderPrefs() };
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) continue;
    // Strings store raw; booleans/arrays serialise to "true"/"false"/JSON —
    // the exact formats toBool/toStringArray parse back.
    next[key] = typeof value === "string" ? value : JSON.stringify(value);
  }

  const userId = useAuthStore.getState().user?.id;
  writeScopedTraderPrefs(next, userId);
  dispatchChartPrefsUpdated();
  return next;
}

export function notifyChartPreferencesUpdated(): void {
  dispatchChartPrefsUpdated();
}

export function useChartPreferences(): ChartPreferences {
  const userId = useAuthStore((s) => s.user?.id);
  const [prefs, setPrefs] = useState<ChartPreferences>(() => getChartPreferencesFromStorage());

  useEffect(() => {
    const refresh = () => setPrefs(getChartPreferencesFromStorage());
    window.addEventListener("storage", refresh);
    window.addEventListener(CHART_PREFS_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(CHART_PREFS_UPDATED_EVENT, refresh);
    };
  }, [userId]);

  return prefs;
}

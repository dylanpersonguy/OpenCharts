import type { IChartApi, ISeriesApi, Logical, SeriesOptionsMap, Time } from "lightweight-charts";
import type { DrawingLine } from "../../../pages/trading/constants";
import type { EntryState, ResolvedEntry, ResolvedFibLevel } from "./types";

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
export const FIB_EXT_LEVELS = [0, 0.618, 1, 1.618, 2.618] as const;
export const FIB_COLORS = [
  "#e91e63",
  "#ff5722",
  "#ff9800",
  "#ffc107",
  "#4caf50",
  "#2196F3",
  "#9c27b0",
];

export type AnySeries = ISeriesApi<keyof SeriesOptionsMap>;

/**
 * Shared per-pass conversion context. Drawings store unix-second anchors that
 * may not fall on this timeframe's bar grid (drawn on another TF) or may sit
 * beyond the loaded data (future anchors) — both need interpolation /
 * extrapolation, which needs the series data and the TF interval.
 */
export interface ResolveCtx {
  chart: IChartApi;
  series: AnySeries;
  intervalSec: number;
  data: readonly { time: Time }[];
}

export function makeResolveCtx(
  chart: IChartApi,
  series: AnySeries,
  intervalSec: number,
): ResolveCtx {
  return { chart, series, intervalSec, data: series.data() };
}

// ── Time ↔ pixel conversion with interpolation/extrapolation ────────────────

/** First index whose bar time is >= time (data is time-sorted ascending). */
function lowerBound(data: readonly { time: Time }[], time: number): number {
  let lo = 0;
  let hi = data.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((data[mid]!.time as number) < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Time → x coordinate. Falls back to logical-index interpolation for times
 * between bars (cross-timeframe anchors) and extrapolation past either end of
 * the data (future anchors / unloaded history).
 */
export function timeToX(ctx: ResolveCtx, time: number): number | null {
  const ts = ctx.chart.timeScale();
  const direct = ts.timeToCoordinate(time as Time);
  if (direct !== null) return direct;
  const logical = timeToLogical(ctx, time);
  if (logical === null) return null;
  return logicalToX(ts, logical);
}

/**
 * lightweight-charts' `logicalToCoordinate` returns 0 for any *non-integer*
 * index (its internal `indexToCoordinate` bails on `!isInteger`). Cross-
 * timeframe and future anchors land between bars at fractional logicals, so we
 * can't pass those through directly — that snapped every off-grid anchor to the
 * chart's left edge. Integer logicals are always valid (and extrapolate
 * linearly even past the data), so resolve the two surrounding integer bar
 * positions and interpolate in pixel space between them.
 */
function logicalToX(ts: ReturnType<IChartApi["timeScale"]>, logical: number): number | null {
  const lo = Math.floor(logical);
  const xLo = ts.logicalToCoordinate(lo as Logical);
  if (xLo === null) return null;
  const frac = logical - lo;
  if (frac === 0) return xLo;
  const xHi = ts.logicalToCoordinate((lo + 1) as Logical);
  if (xHi === null) return null;
  return xLo + frac * (xHi - xLo);
}

function timeToLogical(ctx: ResolveCtx, time: number): number | null {
  const { data, intervalSec } = ctx;
  if (data.length === 0 || intervalSec <= 0) return null;
  const firstTime = data[0]!.time as number;
  const lastTime = data[data.length - 1]!.time as number;
  if (time <= firstTime) return (time - firstTime) / intervalSec;
  if (time >= lastTime) return data.length - 1 + (time - lastTime) / intervalSec;
  const idx = lowerBound(data, time);
  const t1 = data[idx - 1]!.time as number;
  const t2 = data[idx]!.time as number;
  return idx - 1 + (time - t1) / Math.max(t2 - t1, 1);
}

/**
 * X coordinate → time. Falls back to bar-interval extrapolation in the
 * whitespace beyond the loaded data so anchors can be placed in the future.
 */
export function xToTime(ctx: ResolveCtx, x: number): number | null {
  const direct = ctx.chart.timeScale().coordinateToTime(x);
  if (direct !== null) return direct as number;
  const { data, intervalSec } = ctx;
  if (data.length === 0 || intervalSec <= 0) return null;
  const logical = ctx.chart.timeScale().coordinateToLogical(x);
  if (logical === null) return null;
  const lastIdx = data.length - 1;
  const lastTime = data[lastIdx]!.time as number;
  const firstTime = data[0]!.time as number;
  // Snap to whole bar offsets so future anchors stay on the bar grid.
  if (logical > lastIdx) return lastTime + Math.round(logical - lastIdx) * intervalSec;
  if (logical < 0) return firstTime + Math.round(logical) * intervalSec;
  return null;
}

// ── Drawing resolution ───────────────────────────────────────────────────────

/** Convert a drawing's data-space anchors into pane pixel coordinates. */
export function resolveEntry(d: DrawingLine, ctx: ResolveCtx, state: EntryState): ResolvedEntry {
  const entry: ResolvedEntry = {
    d,
    x1: d.time != null ? timeToX(ctx, d.time) : null,
    y1: Number.isFinite(d.price) ? ctx.series.priceToCoordinate(d.price) : null,
    x2: d.time2 != null ? timeToX(ctx, d.time2) : null,
    y2: d.price2 != null ? ctx.series.priceToCoordinate(d.price2) : null,
    state,
  };
  if (d.type === "fibonacci" || d.type === "fibextension") {
    entry.fibLevels = resolveFibLevels(d, ctx.series);
  }
  if (d.type === "trendline") {
    entry.seg = trendlineSegment(entry, ctx.chart.timeScale().width());
    if (state === "selected" || state === "preview") entry.stats = trendlineStats(d, ctx);
  }
  if (d.type === "position") {
    entry.yStop = d.stopPrice != null ? ctx.series.priceToCoordinate(d.stopPrice) : null;
    entry.yTarget = d.targetPrice != null ? ctx.series.priceToCoordinate(d.targetPrice) : null;
  }
  if (d.type === "channel") {
    entry.x3 = d.time3 != null ? timeToX(ctx, d.time3) : null;
    entry.y3 = d.price3 != null ? ctx.series.priceToCoordinate(d.price3) : null;
  }
  return entry;
}

// Δprice / % / bar-count readout shown while drawing or selected (TV-style).
function trendlineStats(d: DrawingLine, ctx: ResolveCtx): string[] {
  if (d.price2 == null || d.time == null || d.time2 == null) return [];
  const dp = d.price2 - d.price;
  const pct = d.price !== 0 ? (dp / d.price) * 100 : 0;
  const bars = ctx.intervalSec > 0 ? Math.round(Math.abs(d.time2 - d.time) / ctx.intervalSec) : 0;
  const formatted = ctx.series.priceFormatter().format(Math.abs(dp));
  return [`${dp >= 0 ? "+" : "−"}${formatted} (${pct.toFixed(2)}%)`, `${bars} bars`];
}

type Segment = NonNullable<ResolvedEntry["seg"]>;

// The drawn/hit segment for a trendline: the anchors (ordered left→right),
// optionally stretched to the pane edges when extendLeft/extendRight are set.
function trendlineSegment(e: ResolvedEntry, paneWidth: number): Segment | undefined {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return undefined;
  const seg: Segment =
    e.x1 <= e.x2
      ? { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 }
      : { x1: e.x2, y1: e.y2, x2: e.x1, y2: e.y1 };
  return extendSegment(seg, e.d, paneWidth);
}

function extendSegment(seg: Segment, d: DrawingLine, paneWidth: number): Segment {
  if ((!d.extendLeft && !d.extendRight) || seg.x2 - seg.x1 < 0.5) return seg;
  const slope = (seg.y2 - seg.y1) / (seg.x2 - seg.x1);
  const out = { ...seg };
  if (d.extendLeft) {
    out.y1 -= slope * out.x1;
    out.x1 = 0;
  }
  if (d.extendRight && paneWidth > out.x2) {
    out.y2 += slope * (paneWidth - out.x2);
    out.x2 = paneWidth;
  }
  return out;
}

// Retracement convention: level 0 sits at the second anchor (p2), level 1 at
// the first (p1), matching TradingView's fib retracement direction.
function fibLevelsFor(d: DrawingLine): readonly number[] {
  if (d.fibLevels && d.fibLevels.length > 0) return d.fibLevels;
  return d.type === "fibextension" ? FIB_EXT_LEVELS : FIB_LEVELS;
}

function resolveFibLevels(d: DrawingLine, series: AnySeries): ResolvedFibLevel[] {
  if (d.price2 == null) return [];
  const formatter = series.priceFormatter();
  return fibLevelsFor(d).map((level, i) => {
    const price = d.price2! + (d.price - d.price2!) * level;
    return {
      level,
      price,
      y: series.priceToCoordinate(price),
      color: FIB_COLORS[i] ?? "#2196F3",
      label: `${level} (${formatter.format(price)})`,
    };
  });
}

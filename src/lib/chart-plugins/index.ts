// ─── Series Primitives (attach to any series) ────────────────────────────────
export { AnchoredText } from "./anchored-text/anchored-text";

export { CrosshairHighlightPrimitive } from "./highlight-bar-crosshair/highlight-bar-crosshair";
export type { HighlightBarCrosshairOptions } from "./highlight-bar-crosshair/highlight-bar-crosshair";

export { ImageWatermark } from "./image-watermark/image-watermark";
export type { ImageWatermarkOptions } from "./image-watermark/image-watermark";

export { OverlayPriceScale } from "./overlay-price-scale/overlay-price-scale";
export type { OverlayPriceScaleOptions } from "./overlay-price-scale/overlay-price-scale";

export { PartialPriceLine } from "./partial-price-line/partial-price-line";

export { SessionBreaks } from "./session-breaks/session-breaks";
export type { SessionBreaksOptions, SessionStartRule } from "./session-breaks/session-breaks";

export { SessionHighlighting } from "./session-highlighting/session-highlighting";
export type {
  SessionHighlighter,
  SessionHighlightingOptions,
} from "./session-highlighting/session-highlighting";

export { TrendLine } from "./trend-line/trend-line";
export type { TrendLineOptions } from "./trend-line/trend-line";

export { VertLine } from "./vertical-line/vertical-line";
export type { VertLineOptions } from "./vertical-line/vertical-line";

export { VolumeProfile } from "./volume-profile/volume-profile";
export type { VolumeProfileData } from "./volume-profile/volume-profile";

// ─── Drawing Tools ───────────────────────────────────────────────────────────
export { DrawingToolsManager } from "./drawing-tools/manager";
export type { DrawingToolsManagerOptions } from "./drawing-tools/manager";

export { RectangleDrawingTool } from "./rectangle-drawing-tool/rectangle-drawing-tool";
export type { RectangleDrawingToolOptions } from "./rectangle-drawing-tool/rectangle-drawing-tool";

export { UserPriceLines } from "./user-price-lines/user-price-lines";
export type { UserPriceLinesOptions } from "./user-price-lines/user-price-lines";

export { UserPriceAlerts } from "./user-price-alerts/user-price-alerts";

// ─── Indicators / Overlays ───────────────────────────────────────────────────
export { BandsIndicator } from "./bands-indicator/bands-indicator";
export type { BandsIndicatorOptions } from "./bands-indicator/bands-indicator";

// ─── Tooltips ────────────────────────────────────────────────────────────────
export { TooltipPrimitive } from "./tooltip/tooltip";
export type { TooltipPrimitiveOptions } from "./tooltip/tooltip";
export { TooltipElement } from "./tooltip/tooltip-element";
export type {
  TooltipOptions,
  TooltipContentData,
  TooltipPosition,
} from "./tooltip/tooltip-element";

export { DeltaTooltipPrimitive } from "./delta-tooltip/delta-tooltip";
export type {
  TooltipPrimitiveOptions as DeltaTooltipOptions,
  ActiveRange,
} from "./delta-tooltip/delta-tooltip";

// ─── Price Alerts ────────────────────────────────────────────────────────────
export { ExpiringPriceAlerts } from "./expiring-price-alerts/expiring-price-alerts";
export type {
  IExpiringPriceAlerts,
  ExpiringPriceAlert,
} from "./expiring-price-alerts/iexpiring-price-alerts";

// ─── Custom Series ────────────────────────────────────────────────────────────
export { BackgroundShadeSeries } from "./background-shade-series/background-shade-series";
export type { BackgroundShadeSeriesOptions } from "./background-shade-series/options";

export { WhiskerBoxSeries } from "./box-whisker-series/box-whisker-series";
export type { WhiskerBoxSeriesOptions } from "./box-whisker-series/options";

export { BrushableAreaSeries } from "./brushable-area-series/brushable-area-series";
export type { BrushableAreaSeriesOptions } from "./brushable-area-series/options";

export { DualRangeHistogramSeries } from "./dual-range-histogram-series/dual-range-histogram-series";
export type { DualRangeHistogramSeriesOptions } from "./dual-range-histogram-series/options";

export { GroupedBarsSeries } from "./grouped-bars-series/grouped-bars-series";
export type { GroupedBarsSeriesOptions } from "./grouped-bars-series/options";

export { HeatMapSeries } from "./heatmap-series/heatmap-series";
export type { HeatMapSeriesOptions } from "./heatmap-series/options";

export { HLCAreaSeries } from "./hlc-area-series/hlc-area-series";
export type { HLCAreaSeriesOptions } from "./hlc-area-series/options";

export { LollipopSeries } from "./lollipop-series/lollipop-series";
export type { LollipopSeriesOptions } from "./lollipop-series/options";

export { PrettyHistogramSeries } from "./pretty-histogram/pretty-histogram-series";
export type { PrettyHistogramSeriesOptions } from "./pretty-histogram/options";

export { RoundedCandleSeries } from "./rounded-candles-series/rounded-candles-series";
export type { RoundedCandleSeriesOptions } from "./rounded-candles-series/rounded-candles-series";

export { StackedAreaSeries } from "./stacked-area-series/stacked-area-series";
export type { StackedAreaSeriesOptions } from "./stacked-area-series/options";

export { StackedBarsSeries } from "./stacked-bars-series/stacked-bars-series";
export type { StackedBarsSeriesOptions } from "./stacked-bars-series/options";

// ─── Plugin Base (for building custom plugins) ────────────────────────────────
export { PluginBase } from "./plugin-base";

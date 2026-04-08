export interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorLine {
  color: string;
  values: (number | null)[];
  label: string;
  scaleId?: string; // 'main' or separate pane
}

export interface ChartTheme {
  bg: string;
  gridLine: string;
  text: string;
  textMuted: string;
  crosshair: string;
  scaleBorder: string;
  labelBg: string;
  upColor: string;
  downColor: string;
  upWick: string;
  downWick: string;
  volumeUp: string;
  volumeDown: string;
  lineColor: string;
  areaTop: string;
  areaBottom: string;
  watermark: string;
}

export const DEFAULT_THEME: ChartTheme = {
  bg: '#131722',
  gridLine: '#1e222d',
  text: '#d1d4dc',
  textMuted: '#787b86',
  crosshair: '#758696',
  scaleBorder: '#2a2e39',
  labelBg: '#2a2e39',
  upColor: '#26a69a',
  downColor: '#ef5350',
  upWick: '#26a69a',
  downWick: '#ef5350',
  volumeUp: 'rgba(38, 166, 154, 0.3)',
  volumeDown: 'rgba(239, 83, 80, 0.3)',
  lineColor: '#2962ff',
  areaTop: 'rgba(41, 98, 255, 0.4)',
  areaBottom: 'rgba(41, 98, 255, 0.0)',
  watermark: 'rgba(120, 123, 134, 0.12)',
};

export type RenderChartType = 'candlestick' | 'line' | 'area';

export interface ViewState {
  /** Index of the first visible bar (can be fractional) */
  scrollX: number;
  /** Pixels per bar */
  barWidth: number;
  /** If set, user has locked Y range; otherwise auto-scale */
  yRange: { min: number; max: number } | null;
}

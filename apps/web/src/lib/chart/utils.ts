import type { ChartBar, ViewState } from './types';

/** Clamp a number between min and max */
export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Compute nice grid step for a given range */
export function niceStep(range: number, targetTicks: number): number {
  if (!isFinite(range) || range <= 0 || targetTicks <= 0) return 1;
  const rough = range / targetTicks;
  if (rough <= 0 || !isFinite(rough)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  if (mag <= 0 || !isFinite(mag)) return 1;
  const residual = rough / mag;
  let nice: number;
  if (residual <= 1.5) nice = 1;
  else if (residual <= 3) nice = 2;
  else if (residual <= 7) nice = 5;
  else nice = 10;
  return nice * mag;
}

/** Format a price value for the scale */
export function formatPrice(value: number): string {
  if (Math.abs(value) >= 100_000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  if (Math.abs(value) >= 0.01) return value.toFixed(4);
  return value.toFixed(6);
}

/** Format a time value for the time scale */
export function formatTime(unixSec: number, prevUnixSec: number | null): string {
  const d = new Date(unixSec * 1000);
  const prevD = prevUnixSec ? new Date(prevUnixSec * 1000) : null;

  // Show year when it changes
  if (!prevD || d.getFullYear() !== prevD.getFullYear()) {
    return d.toLocaleDateString('en-US', { year: 'numeric' });
  }
  // Show month when it changes
  if (d.getMonth() !== prevD.getMonth()) {
    return d.toLocaleDateString('en-US', { month: 'short' });
  }
  // Show day when it changes
  if (d.getDate() !== prevD.getDate()) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  // Otherwise show time
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Get visible bars given the view state */
export function getVisibleRange(
  totalBars: number,
  chartWidth: number,
  view: ViewState,
): { startIdx: number; endIdx: number; count: number } {
  if (totalBars <= 0 || chartWidth <= 0 || view.barWidth <= 0) {
    return { startIdx: 0, endIdx: -1, count: 0 };
  }
  const count = Math.ceil(chartWidth / view.barWidth) + 2;
  const startIdx = Math.max(0, Math.floor(view.scrollX));
  const endIdx = Math.min(totalBars - 1, startIdx + count);
  return { startIdx, endIdx, count };
}

/** Auto-compute Y range from visible bars */
export function computeYRange(
  bars: ChartBar[],
  startIdx: number,
  endIdx: number,
  padding: number = 0.05,
): { min: number; max: number } {
  if (startIdx > endIdx || bars.length === 0) return { min: 0, max: 1 };

  let min = Infinity;
  let max = -Infinity;
  for (let i = startIdx; i <= endIdx; i++) {
    if (!bars[i]) continue;
    min = Math.min(min, bars[i].low);
    max = Math.max(max, bars[i].high);
  }

  if (min === Infinity) return { min: 0, max: 1 };

  const range = max - min || 1;
  return {
    min: min - range * padding,
    max: max + range * padding,
  };
}

/** Convert bar index to pixel X */
export function barToX(barIndex: number, view: ViewState): number {
  return (barIndex - view.scrollX) * view.barWidth + view.barWidth / 2;
}

/** Convert price to pixel Y */
export function priceToY(
  price: number,
  yMin: number,
  yMax: number,
  chartHeight: number,
): number {
  if (yMax === yMin) return chartHeight / 2;
  return chartHeight - ((price - yMin) / (yMax - yMin)) * chartHeight;
}

/** Convert pixel Y to price */
export function yToPrice(
  y: number,
  yMin: number,
  yMax: number,
  chartHeight: number,
): number {
  return yMin + ((chartHeight - y) / chartHeight) * (yMax - yMin);
}

/** Convert pixel X to bar index */
export function xToBar(x: number, view: ViewState): number {
  return view.scrollX + (x - view.barWidth / 2) / view.barWidth;
}

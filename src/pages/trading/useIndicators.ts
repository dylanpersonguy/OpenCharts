import { useEffect, useRef } from "react";
import type { IChartApi, ISeriesApi, CandlestickData, Time } from "lightweight-charts";
import type { IndicatorType } from "../../lib/indicators.ts";
import { toIndicatorCandles } from "./utils.ts";
import { CHART_COLORS } from "./constants.ts";
import { indicatorSeries, type IndicatorSeriesSpec } from "./indicator-series.ts";

type AnySeries = ISeriesApi<"Line"> | ISeriesApi<"Histogram">;

function createSeries(chart: IChartApi, spec: IndicatorSeriesSpec): AnySeries {
  return spec.kind === "line" ? chart.addLineSeries(spec.options) : chart.addHistogramSeries(spec.options);
}

/**
 * Draws the active indicators. Series are created/removed only when the
 * indicator set, theme or chart instance changes; new candles just re-set
 * each series' data (no remove/re-add churn on every replay step).
 */
export function useIndicators(
  chartRef: React.RefObject<IChartApi | null>,
  candleSeriesRef: React.RefObject<ISeriesApi<"Candlestick"> | null>,
  chartData: CandlestickData<Time>[],
  activeIndicators: IndicatorType[],
  isDark: boolean,
  /** Bumped when the chart instance is recreated, so indicators are redrawn on it. */
  chartEpoch = 0,
): void {
  const seriesRef = useRef<Map<string, AnySeries>>(new Map());
  const ownerRef = useRef<{ chart: IChartApi | null; isDark: boolean }>({ chart: null, isDark });
  const colors = isDark ? CHART_COLORS.dark : CHART_COLORS.light;

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candleSeriesRef.current || chartData.length === 0) return;

    // A recreated chart (theme / symbol) owns none of our old series; a theme
    // change needs new series options.
    if (ownerRef.current.chart !== chart || ownerRef.current.isDark !== isDark) {
      if (ownerRef.current.chart === chart) {
        for (const s of seriesRef.current.values()) chart.removeSeries(s);
      }
      seriesRef.current = new Map();
      ownerRef.current = { chart, isDark };
    }

    const candles = toIndicatorCandles(chartData);
    const specs = activeIndicators.flatMap((type) => indicatorSeries(type, candles, colors));
    const wanted = new Set(specs.map((s) => s.key));
    const next = new Map<string, AnySeries>();
    for (const [key, s] of seriesRef.current) {
      if (wanted.has(key)) next.set(key, s);
      else chart.removeSeries(s);
    }
    for (const spec of specs) {
      const s = next.get(spec.key) ?? createSeries(chart, spec);
      next.set(spec.key, s);
      s.setData(spec.data);
    }
    seriesRef.current = next;
    // chartRef/candleSeriesRef are stable refs; colors derive from isDark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndicators, chartData, isDark, chartEpoch]);
}

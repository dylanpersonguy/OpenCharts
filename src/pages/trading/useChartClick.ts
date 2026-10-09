import { useEffect, useRef, type RefObject } from "react";
import type { IChartApi, ISeriesApi, MouseEventParams, Time } from "lightweight-charts";

/**
 * Reports plain chart clicks as (bar time in unix seconds, price). Clicks are
 * ignored while a drawing tool is armed, so drawing placement never doubles as
 * a chart click. Re-binds whenever a new chart instance is created (`chartEpoch`).
 */
export function useChartClick(
  chartRef: RefObject<IChartApi | null>,
  seriesRef: RefObject<ISeriesApi<"Candlestick"> | null>,
  drawingToolRef: RefObject<string>,
  chartEpoch: number,
  onChartClick: ((timeSec: number, price: number) => void) | undefined,
): void {
  const handlerRef = useRef(onChartClick);
  useEffect(() => {
    handlerRef.current = onChartClick;
  });
  const enabled = onChartClick !== undefined;

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !enabled) return;
    const onClick = (param: MouseEventParams<Time>) => {
      if (drawingToolRef.current !== "none") return;
      if (param.time === undefined || !param.point) return;
      const price = seriesRef.current?.coordinateToPrice(param.point.y) ?? Number.NaN;
      handlerRef.current?.(param.time as number, price);
    };
    chart.subscribeClick(onClick);
    return () => chart.unsubscribeClick(onClick);
  }, [chartRef, seriesRef, drawingToolRef, chartEpoch, enabled]);
}

import { useEffect, useRef } from "react";
import { createChart, type Time, type UTCTimestamp } from "lightweight-charts";
import type { EquityPoint } from "../../services/replay/stats.ts";
import { CHART_COLORS } from "../trading/constants.ts";

interface EquityCurveChartProps {
  points: readonly EquityPoint[];
  startTime: number;
  startingBalance: number;
}

/** Closed-trade equity curve (one point per closed position). */
export function EquityCurveChart({ points, startTime, startingBalance }: EquityCurveChartProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // lightweight-charts can't parse the CSS-variable hsl() syntax, so use the chart palette.
    const colors = document.documentElement.classList.contains("light") ? CHART_COLORS.light : CHART_COLORS.dark;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: colors.text },
      grid: { vertLines: { visible: false }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      handleScroll: false,
      handleScale: false,
    });
    const line = chart.addLineSeries({ color: colors.up, lineWidth: 2 });
    // Strictly increasing times: several trades can close on the same bar.
    let last = startTime - 1;
    const data = [{ time: startTime, equity: startingBalance }, ...points].map((p) => {
      last = Math.max(p.time, last + 1);
      return { time: last as UTCTimestamp as Time, value: p.equity };
    });
    line.setData(data);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points, startTime, startingBalance]);

  return <div ref={ref} className="h-56 w-full" aria-label="Equity curve" />;
}

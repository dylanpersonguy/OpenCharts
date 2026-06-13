/**
 * DrawdownChart — Equity curve with drawdown shading overlay.
 * Renders an SVG chart showing:
 * - The equity curve line
 * - A shaded area showing drawdown depth below the running peak
 * - Max-drawdown annotation
 */
import { useMemo } from "react";

interface DataPoint {
  timestamp: string | number;
  equity: number;
}

interface DrawdownChartProps {
  data: DataPoint[];
  startBalance?: number;
  height?: number;
  className?: string;
}

const CHART_PADDING = { top: 20, right: 60, bottom: 30, left: 60 };
const CHART_WIDTH = 800;

export function DrawdownChart({
  data,
  startBalance,
  height = 240,
  className = "",
}: DrawdownChartProps) {
  const width = CHART_WIDTH;
  const padding = CHART_PADDING;

  const computed = useMemo(() => {
    if (data.length < 2) return null;

    const sorted = [...data].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const equities = sorted.map((d) => d.equity);
    const base = startBalance ?? equities[0]!;

    // Compute running peak & drawdown
    let runningPeak = base;
    const peaks: number[] = [];
    const drawdowns: number[] = [];
    let maxDd = 0;
    let maxDdIdx = 0;

    for (let i = 0; i < equities.length; i++) {
      runningPeak = Math.max(runningPeak, equities[i]!);
      peaks.push(runningPeak);
      const dd = ((runningPeak - equities[i]!) / runningPeak) * 100;
      drawdowns.push(dd);
      if (dd > maxDd) {
        maxDd = dd;
        maxDdIdx = i;
      }
    }

    const minEq = Math.min(...equities, base * 0.95);
    const maxEq = Math.max(...peaks, base * 1.05);
    const range = maxEq - minEq || 1;

    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const xStep = innerW / (sorted.length - 1);

    const toX = (i: number) => padding.left + i * xStep;
    const toY = (val: number) => padding.top + innerH - ((val - minEq) / range) * innerH;

    // Equity polyline
    const equityPoints = sorted.map((_, i) => `${toX(i)},${toY(equities[i]!)}`).join(" ");

    // Peak polyline (running high watermark)
    const peakPoints = sorted.map((_, i) => `${toX(i)},${toY(peaks[i]!)}`).join(" ");

    // Drawdown fill polygon (area between peak and equity)
    let ddFillPath = "";
    for (let i = 0; i < sorted.length; i++) {
      ddFillPath += `${i === 0 ? "M" : "L"}${toX(i)},${toY(peaks[i]!)} `;
    }
    for (let i = sorted.length - 1; i >= 0; i--) {
      ddFillPath += `L${toX(i)},${toY(equities[i]!)} `;
    }
    ddFillPath += "Z";

    // Y-axis labels
    const yLabels = [];
    const steps = 4;
    for (let s = 0; s <= steps; s++) {
      const val = minEq + (range * s) / steps;
      yLabels.push({
        y: toY(val),
        label: `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      });
    }

    return {
      sorted,
      equities,
      equityPoints,
      peakPoints,
      ddFillPath,
      maxDd,
      maxDdIdx,
      maxDdX: toX(maxDdIdx),
      maxDdEquityY: toY(equities[maxDdIdx]!),
      maxDdPeakY: toY(peaks[maxDdIdx]!),
      yLabels,
      baseY: toY(base),
    };
  }, [data, startBalance, height, width, padding.top, padding.right, padding.bottom, padding.left]);

  if (!computed) {
    return (
      <p className="text-muted-foreground text-center py-4 text-sm">
        Not enough data for drawdown chart
      </p>
    );
  }

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ maxHeight: `${height}px` }}
      >
        {/* Y-axis grid lines */}
        {computed.yLabels.map((yl, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              y1={yl.y}
              x2={width - padding.right}
              y2={yl.y}
              className="stroke-muted-foreground/20"
              strokeWidth={0.5}
            />
            <text
              x={padding.left - 6}
              y={yl.y + 3}
              className="fill-muted-foreground"
              fontSize={9}
              textAnchor="end"
            >
              {yl.label}
            </text>
          </g>
        ))}

        {/* Drawdown shading (area between peak & equity) */}
        <path d={computed.ddFillPath} className="fill-red-500/20" />

        {/* Running peak line (dashed) */}
        <polyline
          fill="none"
          className="stroke-muted-foreground/40"
          strokeWidth={1}
          strokeDasharray="3,3"
          points={computed.peakPoints}
        />

        {/* Equity curve */}
        <polyline
          fill="none"
          className="stroke-violet-500"
          strokeWidth={2}
          points={computed.equityPoints}
        />

        {/* Starting balance reference */}
        <line
          x1={padding.left}
          y1={computed.baseY}
          x2={width - padding.right}
          y2={computed.baseY}
          className="stroke-cyan-400/40"
          strokeWidth={1}
          strokeDasharray="4,4"
        />

        {/* Max drawdown annotation */}
        {computed.maxDd > 0.1 && (
          <g>
            <line
              x1={computed.maxDdX}
              y1={computed.maxDdPeakY}
              x2={computed.maxDdX}
              y2={computed.maxDdEquityY}
              className="stroke-red-400"
              strokeWidth={1.5}
              strokeDasharray="2,2"
            />
            <text
              x={computed.maxDdX + 6}
              y={(computed.maxDdPeakY + computed.maxDdEquityY) / 2 + 3}
              className="fill-red-400"
              fontSize={10}
              fontWeight="bold"
            >
              -{computed.maxDd.toFixed(1)}%
            </text>
          </g>
        )}

        {/* "Max DD" label */}
        <text
          x={width - padding.right + 4}
          y={height - 6}
          className="fill-muted-foreground"
          fontSize={8}
        >
          Max DD: {computed.maxDd.toFixed(2)}%
        </text>
      </svg>
    </div>
  );
}

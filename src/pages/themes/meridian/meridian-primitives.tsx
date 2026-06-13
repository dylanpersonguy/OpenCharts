import { type ReactNode, useEffect, useRef, useState } from "react";
import type { EquityPoint } from "../../../services/schemas";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtUsd(value: number): string {
  return USD.format(value);
}

export function fmtSigned(value: number): string {
  return `${value >= 0 ? "+" : "−"}${USD.format(Math.abs(value))}`;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Expo-out count-up. Animates toward `value` whenever it changes. */
export function useCountUp(value: number, durationMs = 700): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion() || fromRef.current === value) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - 2 ** (-10 * t);
      setDisplay(from + (value - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, durationMs]);

  return display;
}

/** Section heading: index tick + uppercase title over a strong rule. */
export function RuleHeading({
  index,
  title,
  right,
}: {
  index: string;
  title: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between pb-1.5">
        <div className="flex items-baseline gap-2.5">
          <span className="mr-index">{index}</span>
          <span className="mr-microlabel !text-foreground">{title}</span>
        </div>
        {right}
      </div>
      <hr className="mr-rule-strong" />
    </div>
  );
}

/** A single stat cell: micro label over a large tabular number. */
export function StatCell({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
  sub?: string;
}) {
  const toneClass = tone === "pos" ? "mr-pos" : tone === "neg" ? "mr-neg" : "";
  return (
    <div className="px-4 py-3">
      <div className="mr-microlabel mb-1.5">{label}</div>
      <div className={`mr-display mr-num text-xl ${toneClass}`}>{value}</div>
      {sub && <div className="mr-num mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Thin capacity meter: used vs budget with end tick. */
export function MeterRow({
  label,
  used,
  max,
  invert,
}: {
  label: string;
  used: number;
  max: number;
  invert?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  const danger = pct >= 80;
  const barColor = invert
    ? "hsl(var(--buy))"
    : danger
      ? "hsl(var(--sell))"
      : "hsl(var(--foreground))";
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between mb-1">
        <span className="mr-microlabel">{label}</span>
        <span className="mr-num text-[11px] font-semibold">
          {used.toFixed(2)}% <span className="text-muted-foreground">/ {max.toFixed(0)}%</span>
        </span>
      </div>
      <div className="h-[3px] w-full bg-border">
        <div
          className="h-full transition-all duration-700"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
    </div>
  );
}

function sparklinePoints(history: EquityPoint[], w: number, h: number): string {
  const values = history.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Minimal ink-line equity sparkline with an accent endpoint dot. */
export function EquitySparkline({
  history,
  height = 120,
}: {
  history: EquityPoint[];
  height?: number;
}) {
  if (history.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground text-xs"
        style={{ height }}
      >
        Equity history will appear after your first trades.
      </div>
    );
  }
  const w = 600;
  const points = sparklinePoints(history, w, height);
  const last = points.split(" ").pop() ?? "";
  const [lx, ly] = last.split(",");
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
    >
      <title>Equity curve</title>
      <polygon
        points={`0,${height} ${points} ${w},${height}`}
        fill="hsl(var(--accent) / 0.06)"
        stroke="none"
      />
      <polyline points={points} fill="none" stroke="hsl(var(--foreground))" strokeWidth="1.5" />
      <circle cx={lx} cy={ly} r="3" fill="hsl(var(--accent))" />
    </svg>
  );
}

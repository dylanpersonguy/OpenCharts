import { type ReactNode, useCallback, useRef } from "react";
import type { EquityPoint } from "../../../services/schemas";

/* ── Spotlight bento tile ───────────────────────────────────── */

export function Tile({ className = "", children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  }, []);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: mouse-move only feeds a decorative spotlight gradient
    <div ref={ref} onMouseMove={onMouseMove} className={`vt-tile ${className}`}>
      <div className="vt-tile-inner">{children}</div>
    </div>
  );
}

export function TileHead({ label, right }: { label: string; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between px-5 pt-4 pb-2">
      <span className="vt-label">{label}</span>
      {right}
    </div>
  );
}

/* ── Draw-in equity area chart ──────────────────────────────── */

function buildPaths(history: EquityPoint[], w: number, h: number) {
  const values = history.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => ({
    x: (i / Math.max(1, values.length - 1)) * w,
    y: h - 8 - ((v - min) / span) * (h - 24),
  }));
  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const last = pts[pts.length - 1];
  return { line, area: `${line} L${w},${h} L0,${h} Z`, last, min, max };
}

export function EquityChart({
  history,
  height = 220,
}: {
  history: EquityPoint[];
  height?: number;
}) {
  if (history.length < 2) {
    return (
      <div
        className="flex flex-1 items-center justify-center text-xs text-muted-foreground"
        style={{ height }}
      >
        Your equity curve will appear after your first trades.
      </div>
    );
  }
  const w = 800;
  const { line, area, last, min, max } = buildPaths(history, w, height);
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
    >
      <title>Equity curve</title>
      <defs>
        <linearGradient id="vt-area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(42 64% 65% / 0.22)" />
          <stop offset="100%" stopColor="hsl(42 64% 65% / 0)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#vt-area-fill)" className="vt-area" />
      <path
        d={line}
        fill="none"
        stroke="hsl(var(--accent))"
        strokeWidth="2"
        pathLength={1}
        className="vt-draw"
      />
      {last && <circle cx={last.x} cy={last.y} r="3.5" fill="hsl(var(--accent))" />}
      <text x="8" y="14" fontSize="10" fill="hsl(var(--muted-foreground))">
        {max.toLocaleString("en-US", { maximumFractionDigits: 0 })}
      </text>
      <text x="8" y={height - 4} fontSize="10" fill="hsl(var(--muted-foreground))">
        {min.toLocaleString("en-US", { maximumFractionDigits: 0 })}
      </text>
    </svg>
  );
}

/* ── Radial gauge (drawdown vs budget) ──────────────────────── */

export function RadialGauge({
  label,
  used,
  max,
  size = 110,
}: {
  label: string;
  used: number;
  max: number;
  size?: number;
}) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, used / max) : 0;
  const sweep = 0.75; // 270° arc
  const danger = pct >= 0.8;
  const color = danger ? "hsl(var(--sell))" : "hsl(var(--accent))";
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        style={{ transform: "rotate(135deg)" }}
      >
        <title>{`${label}: ${used.toFixed(2)}% of ${max.toFixed(0)}%`}</title>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${c * sweep} ${c}`}
        />
        <circle
          className="vt-gauge-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${c * sweep * pct} ${c}`}
        />
      </svg>
      <div className="-mt-12 text-center">
        <div className={`text-lg font-bold tabular-nums ${danger ? "vt-neg" : ""}`}>
          {used.toFixed(1)}%
        </div>
        <div className="vt-label">of {max.toFixed(0)}%</div>
      </div>
      <span className="vt-label mt-4">{label}</span>
    </div>
  );
}

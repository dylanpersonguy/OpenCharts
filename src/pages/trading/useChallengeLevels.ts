import type { IPriceLine, ISeriesApi } from "lightweight-charts";
import { LineStyle } from "lightweight-charts";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { AccountMetricsResponse } from "../../services/api/auth.ts";
import { useAccountMetrics } from "../../services/queries.ts";
import type { Position } from "../../services/schemas.ts";

// ── Challenge-aware price levels ─────────────────────────────────────────────
// Projects the account's risk-rule thresholds (daily loss limit, max drawdown
// floor, profit target) onto the active symbol as horizontal price lines.
// The conversion uses the trader's net open exposure in the charted symbol:
//
//   price(targetEquity) = mid + (targetEquity − equityNow) / (netQty × contractSize)
//
// With no open exposure in the symbol there is no price equivalence, so the
// lines are hidden. Lines track the live tick — every equity change moves the
// projected level, exactly like the breach math in the risk engine.

export interface ChallengeLevelFlags {
  /** Master switch — when false nothing renders and metrics aren't fetched. */
  enabled: boolean;
  dailyLoss: boolean;
  maxDrawdown: boolean;
  profitTarget: boolean;
}

interface LevelSpec {
  key: "daily-loss" | "max-drawdown" | "profit-target";
  price: number;
  title: string;
  color: string;
}

type MetricsShape = Pick<
  AccountMetricsResponse,
  | "equity"
  | "dailyPnl"
  | "ddDailyMax"
  | "ddTotalMax"
  | "ddTrailingMax"
  | "trailingDrawdownFloor"
  | "profitTargetPercent"
  | "startingBalance"
>;

interface EquityLevels {
  dailyLoss?: number;
  maxDrawdown?: number;
  profitTarget?: number;
}

/** Signed net exposure (lots) for the charted symbol across open positions. */
function netExposure(positions: Position[], symbol: string): number {
  let net = 0;
  for (const p of positions) {
    if (p.symbolName !== symbol) continue;
    net += p.side === "LONG" ? p.quantity : -p.quantity;
  }
  return net;
}

function dailyLossFloor(m: MetricsShape, sb: number): number | undefined {
  if (m.ddDailyMax == null) return undefined;
  // Today's starting equity recovered from the live snapshot: dailyPnl is the
  // P&L accrued since the daily reset, so start = equity − dailyPnl.
  const dailyStart = (m.equity ?? sb) - (m.dailyPnl ?? 0);
  return dailyStart - sb * (m.ddDailyMax / 100);
}

function maxDrawdownFloor(m: MetricsShape, sb: number): number | undefined {
  const total = m.ddTotalMax != null ? sb * (1 - m.ddTotalMax / 100) : undefined;
  // The trailing floor is monotonic and server-computed; when a trailing rule
  // exists it is the binding constraint, so surface whichever floor is higher.
  const trailing = m.ddTrailingMax != null ? (m.trailingDrawdownFloor ?? undefined) : undefined;
  if (total == null) return trailing;
  if (trailing == null) return total;
  return Math.max(total, trailing);
}

function computeEquityLevels(m: MetricsShape | undefined): EquityLevels {
  const sb = m?.startingBalance;
  if (!m || !sb || sb <= 0) return {};
  const target =
    m.profitTargetPercent != null && m.profitTargetPercent > 0
      ? sb * (1 + m.profitTargetPercent / 100)
      : undefined;
  return {
    dailyLoss: dailyLossFloor(m, sb),
    maxDrawdown: maxDrawdownFloor(m, sb),
    profitTarget: target,
  };
}

interface ProjectionCtx {
  mid: number;
  equityNow: number;
  netQty: number;
  contractSize: number;
}

function projectToPrice(targetEquity: number, ctx: ProjectionCtx): number {
  return ctx.mid + (targetEquity - ctx.equityNow) / (ctx.netQty * ctx.contractSize);
}

function formatUsd(v: number): string {
  return `$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function buildLevel(
  key: LevelSpec["key"],
  label: string,
  color: string,
  targetEquity: number | undefined,
  ctx: ProjectionCtx,
): LevelSpec | null {
  if (targetEquity == null) return null;
  const price = projectToPrice(targetEquity, ctx);
  if (!Number.isFinite(price) || price <= 0) return null;
  return { key, price, color, title: `${label} · ${formatUsd(targetEquity - ctx.equityNow)}` };
}

const LEVEL_COLORS = {
  dailyLoss: "#f59e0b",
  maxDrawdown: "#f6465d",
  profitTarget: "#0ecb81",
} as const;

function buildLevels(
  eq: EquityLevels,
  flags: ChallengeLevelFlags,
  ctx: ProjectionCtx,
): LevelSpec[] {
  const out: LevelSpec[] = [];
  const candidates: Array<LevelSpec | null> = [
    flags.dailyLoss
      ? buildLevel("daily-loss", "Daily Loss Limit", LEVEL_COLORS.dailyLoss, eq.dailyLoss, ctx)
      : null,
    flags.maxDrawdown
      ? buildLevel("max-drawdown", "Max Drawdown", LEVEL_COLORS.maxDrawdown, eq.maxDrawdown, ctx)
      : null,
    flags.profitTarget
      ? buildLevel(
          "profit-target",
          "Profit Target",
          LEVEL_COLORS.profitTarget,
          eq.profitTarget,
          ctx,
        )
      : null,
  ];
  for (const c of candidates) {
    if (c) out.push(c);
  }
  return out;
}

/** Diff-sync the rendered price lines against the wanted set (no churn per tick). */
function syncLines(
  series: ISeriesApi<"Candlestick">,
  map: Map<string, IPriceLine>,
  levels: LevelSpec[],
): void {
  const wanted = new Set<string>(levels.map((l) => l.key));
  for (const [key, line] of map) {
    if (wanted.has(key)) continue;
    try {
      series.removePriceLine(line);
    } catch {
      /* series may already be disposed */
    }
    map.delete(key);
  }
  for (const level of levels) {
    const existing = map.get(level.key);
    if (existing) {
      existing.applyOptions({ price: level.price, title: level.title });
      continue;
    }
    map.set(
      level.key,
      series.createPriceLine({
        price: level.price,
        color: level.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: level.title,
      }),
    );
  }
}

export function useChallengeLevels(opts: {
  accountId: string | null | undefined;
  selectedSymbol: string;
  positions: Position[];
  tick: { bid: number; ask: number } | undefined;
  contractSize: number;
  accountEquity: number;
  candleSeriesRef: RefObject<ISeriesApi<"Candlestick"> | null>;
  flags: ChallengeLevelFlags;
  chartEpoch: number;
}): void {
  const {
    accountId,
    selectedSymbol,
    positions,
    tick,
    contractSize,
    accountEquity,
    candleSeriesRef,
    flags,
    chartEpoch,
  } = opts;

  // Metrics polling is skipped entirely while the overlay is disabled.
  const { data: metrics } = useAccountMetrics(flags.enabled ? (accountId ?? null) : null);

  const levels = useMemo<LevelSpec[]>(() => {
    if (!flags.enabled || !tick) return [];
    const netQty = netExposure(positions, selectedSymbol);
    if (netQty === 0) return [];
    const eq = computeEquityLevels(metrics);
    const ctx: ProjectionCtx = {
      mid: (tick.bid + tick.ask) / 2,
      equityNow: accountEquity > 0 ? accountEquity : (metrics?.equity ?? 0),
      netQty,
      contractSize,
    };
    if (ctx.equityNow <= 0) return [];
    return buildLevels(eq, flags, ctx);
  }, [flags, tick, positions, selectedSymbol, metrics, accountEquity, contractSize]);

  const linesRef = useRef<Map<string, IPriceLine>>(new Map());

  // Chart recreation destroys all price lines with it — reset the bookkeeping.
  useEffect(() => {
    linesRef.current = new Map();
  }, [chartEpoch]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    syncLines(series, linesRef.current, levels);
    // candleSeriesRef is a stable ref; chartEpoch stands in for its lifecycle.
  }, [levels, chartEpoch, candleSeriesRef]);
}

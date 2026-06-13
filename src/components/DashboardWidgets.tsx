// Dashboard Enhancement Components (#11-20)
// Daily P&L, Drawdown Gauge, Risk Score, Activity Feed, Goal Tracker, etc.

import { useMemo, useState } from "react";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import {
  TrendingUp,
  Activity,
  AlertTriangle,
  Award,
  DollarSign,
  Shield,
  BarChart3,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

type EquityHistoryPoint = {
  timestamp?: string;
  createdAt?: string;
  equity?: number;
};

type FillActivity = {
  id: string;
  side: string;
  quantity: number;
  symbolName: string;
  price: number;
  realizedPnl?: number | null;
  timestamp?: string;
  createdAt?: string;
};

type RuleViolationActivity = {
  id: string;
  ruleCode: string;
  currentValue?: number;
  threshold?: number;
  timestamp?: string;
  createdAt?: string;
};

type AccountHealthMetrics = {
  ddDaily?: { current?: number; max?: number };
  ddTotal?: { current?: number; max?: number };
  profitTargetProgress?: number;
};

type AccountSummary = {
  status: string;
};

function getPointTime(point: EquityHistoryPoint): number {
  const value = point.timestamp ?? point.createdAt;
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

// ── #12 Daily P&L Breakdown Chart ──────────────────────────

export function DailyPnlChart({ equityHistory }: { equityHistory: EquityHistoryPoint[] }) {
  if (!equityHistory || equityHistory.length < 2) {
    return <p className="text-muted-foreground text-center py-6 text-xs">Not enough data</p>;
  }

  const sorted = [...equityHistory].sort((a, b) => getPointTime(a) - getPointTime(b));

  // Calculate daily P&L
  const dailyPnl: { date: string; pnl: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const day = new Date(getPointTime(sorted[i]!)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const pnl = (sorted[i]!.equity || 0) - (sorted[i - 1]!.equity || 0);
    const existing = dailyPnl.find((d) => d.date === day);
    if (existing) existing.pnl += pnl;
    else dailyPnl.push({ date: day, pnl });
  }

  const last14 = dailyPnl.slice(-14);
  if (last14.length === 0) return null;

  const maxAbs = Math.max(...last14.map((d) => Math.abs(d.pnl)), 1);
  const barHeight = 80;

  return (
    <div>
      <div className="flex items-end justify-between gap-1" style={{ height: barHeight + 20 }}>
        {last14.map((d, i) => {
          const h = (Math.abs(d.pnl) / maxAbs) * (barHeight / 2);
          const isUp = d.pnl >= 0;
          return (
            <div key={i} className="flex-1 flex flex-col items-center relative group">
              <div className="flex flex-col items-center" style={{ height: barHeight }}>
                <div
                  className="flex-1 flex items-end justify-center"
                  style={{ height: barHeight / 2 }}
                >
                  {isUp && (
                    <div
                      className="w-full max-w-[20px] bg-buy/60 rounded-t transition-all hover:bg-buy/80"
                      style={{ height: h }}
                    />
                  )}
                </div>
                <div className="w-full border-t border-border/40" />
                <div
                  className="flex-1 flex items-start justify-center"
                  style={{ height: barHeight / 2 }}
                >
                  {!isUp && (
                    <div
                      className="w-full max-w-[20px] bg-sell/60 rounded-b transition-all hover:bg-sell/80"
                      style={{ height: h }}
                    />
                  )}
                </div>
              </div>
              <span className="text-[8px] text-muted-foreground mt-1 whitespace-nowrap">
                {d.date.split(" ")[1]}
              </span>
              {/* Tooltip */}
              <div className="absolute bottom-full mb-1 hidden group-hover:block z-10">
                <div className="bg-card border border-border rounded px-2 py-1 text-[10px] whitespace-nowrap shadow-lg">
                  <div className="font-medium">{d.date}</div>
                  <div className={cn("font-mono", isUp ? "text-buy" : "text-sell")}>
                    {isUp ? "+" : ""}
                    {formatCurrency(d.pnl)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── #13 Drawdown Gauge ──────────────────────────────────────

interface DrawdownGaugeProps {
  currentDrawdown: number;
  maxAllowed: number;
  label?: string;
}

export function DrawdownGauge({
  currentDrawdown,
  maxAllowed,
  label = "Drawdown",
}: DrawdownGaugeProps) {
  const percent = maxAllowed > 0 ? (currentDrawdown / maxAllowed) * 100 : 0;
  const color = percent > 80 ? "text-sell" : percent > 50 ? "text-warning" : "text-buy";

  // SVG arc gauge
  const radius = 40;
  const circumference = Math.PI * radius; // Half circle
  const progress = Math.min(percent, 100) / 100;

  return (
    <div className="flex flex-col items-center">
      <svg width="100" height="60" viewBox="0 0 100 60">
        {/* Background arc */}
        <path
          d="M 10 55 A 40 40 0 0 1 90 55"
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth="6"
          strokeLinecap="round"
        />
        {/* Progress arc */}
        <path
          d="M 10 55 A 40 40 0 0 1 90 55"
          fill="none"
          stroke={
            percent > 80
              ? "hsl(var(--sell))"
              : percent > 50
                ? "hsl(var(--warning))"
                : "hsl(var(--buy))"
          }
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={`${circumference * (1 - progress)}`}
        />
      </svg>
      <div className={cn("text-lg font-mono font-bold -mt-2", color)}>
        {currentDrawdown.toFixed(2)}%
      </div>
      <div className="text-[10px] text-muted-foreground">
        {label}: {currentDrawdown.toFixed(2)}% / {maxAllowed}%
      </div>
    </div>
  );
}

// ── #15 Goal Tracker ────────────────────────────────────────

interface GoalTrackerProps {
  currentProfit: number;
  targetProfit: number;
  startDate: string;
  tradingDays: number;
}

export function GoalTracker({
  currentProfit,
  targetProfit,
  startDate: _startDate,
  tradingDays,
}: GoalTrackerProps) {
  const progress =
    targetProfit > 0 ? Math.max(0, Math.min((currentProfit / targetProfit) * 100, 100)) : 0;
  const dailyRate = tradingDays > 0 ? currentProfit / tradingDays : 0;
  const remaining = targetProfit - currentProfit;
  const daysNeeded = dailyRate > 0 ? Math.ceil(remaining / dailyRate) : Infinity;
  const isLoss = currentProfit < 0;

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-muted-foreground">Progress to Target</span>
          <span
            className={cn(
              "font-mono font-semibold",
              progress >= 100 ? "text-buy" : isLoss ? "text-sell" : "text-accent",
            )}
          >
            {progress.toFixed(1)}%
          </span>
        </div>
        <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              progress >= 100 ? "bg-buy" : "bg-accent",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span className={isLoss ? "text-sell" : ""}>{formatCurrency(currentProfit)}</span>
          <span>{formatCurrency(targetProfit)}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-secondary/50 rounded-lg p-2">
          <div className="text-[10px] text-muted-foreground">Daily Avg</div>
          <div className={cn("font-mono font-semibold", dailyRate >= 0 ? "text-buy" : "text-sell")}>
            {dailyRate >= 0 ? "+" : ""}
            {formatCurrency(dailyRate)}
          </div>
        </div>
        <div className="bg-secondary/50 rounded-lg p-2">
          <div className="text-[10px] text-muted-foreground">Projected Days</div>
          <div className="font-mono font-semibold">
            {daysNeeded === Infinity ? "—" : `${daysNeeded} days`}
          </div>
        </div>
        <div className="bg-secondary/50 rounded-lg p-2">
          <div className="text-[10px] text-muted-foreground">Remaining</div>
          <div className="font-mono font-semibold text-accent">
            {formatCurrency(Math.max(0, remaining))}
          </div>
        </div>
        <div className="bg-secondary/50 rounded-lg p-2">
          <div className="text-[10px] text-muted-foreground">Trading Days</div>
          <div className="font-mono font-semibold">{tradingDays}</div>
        </div>
      </div>
    </div>
  );
}

// ── #17 Recent Activity Feed ────────────────────────────────

interface ActivityItem {
  id: string;
  type: "order" | "position" | "rule" | "phase" | "payout" | "system";
  title: string;
  description: string;
  timestamp: number;
  severity: "info" | "success" | "warning" | "error";
}

export function RecentActivityFeed({
  fills,
  violations,
  phaseLogs: _phaseLogs,
}: {
  fills?: FillActivity[];
  violations?: RuleViolationActivity[];
  phaseLogs?: unknown[];
}) {
  const activities: ActivityItem[] = useMemo(() => {
    const items: ActivityItem[] = [];

    // Add fills as activities
    (fills || []).slice(0, 10).forEach((f) => {
      items.push({
        id: `fill-${f.id}`,
        type: "position",
        title: `${f.side} ${f.quantity} ${f.symbolName}`,
        description: `Filled @ ${formatNumber(f.price, 5)}${f.realizedPnl != null ? ` · P&L: ${f.realizedPnl >= 0 ? "+" : ""}${formatCurrency(f.realizedPnl)}` : ""}`,
        timestamp: new Date(f.timestamp ?? f.createdAt ?? Date.now()).getTime(),
        severity: (f.realizedPnl ?? 0) >= 0 ? "success" : "warning",
      });
    });

    // Add rule violations
    (violations || []).forEach((v) => {
      items.push({
        id: `viol-${v.id}`,
        type: "rule",
        title: `Rule Violation: ${v.ruleCode}`,
        description: `Value: ${(v.currentValue ?? 0).toFixed(2)} / Limit: ${(v.threshold ?? 0).toFixed(2)}`,
        timestamp: new Date(v.timestamp ?? v.createdAt ?? Date.now()).getTime(),
        severity: "error",
      });
    });

    return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
  }, [fills, violations]);

  const ICON_MAP: Record<string, typeof Activity> = {
    order: TrendingUp,
    position: BarChart3,
    rule: AlertTriangle,
    phase: Award,
    payout: DollarSign,
    system: Zap,
  };

  const SEVERITY_COLORS: Record<string, string> = {
    info: "text-blue-400 bg-blue-500/10",
    success: "text-green-400 bg-green-500/10",
    warning: "text-yellow-400 bg-yellow-500/10",
    error: "text-red-400 bg-red-500/10",
  };

  if (activities.length === 0) {
    return <p className="text-muted-foreground text-center py-6 text-xs">No recent activity</p>;
  }

  return (
    <div className="space-y-1 max-h-[300px] overflow-y-auto">
      {activities.map((act) => {
        const Icon = ICON_MAP[act.type] || Activity;
        return (
          <div
            key={act.id}
            className="flex items-start gap-2.5 py-2 px-1 hover:bg-secondary/30 rounded transition-colors"
          >
            <div className={cn("p-1 rounded-lg mt-0.5 shrink-0", SEVERITY_COLORS[act.severity])}>
              <Icon className="h-3 w-3" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{act.title}</div>
              <div className="text-[10px] text-muted-foreground truncate">{act.description}</div>
            </div>
            <span className="text-[9px] text-muted-foreground/60 whitespace-nowrap shrink-0">
              {formatRelativeTime(act.timestamp)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── #18 Risk Score Card ─────────────────────────────────────

interface RiskScoreProps {
  drawdownUsage: number; // 0-100%
  consistencyScore: number; // 0-100%
  overtradingScore: number; // 0-100%
  riskPerTrade: number; // avg risk %
}

export function RiskScoreCard({
  drawdownUsage,
  consistencyScore,
  overtradingScore,
  riskPerTrade,
}: RiskScoreProps) {
  // Composite risk score (lower is better risk management)
  const rawScore =
    100 -
    (drawdownUsage * 0.4 +
      (100 - consistencyScore) * 0.3 +
      overtradingScore * 0.2 +
      Math.min(riskPerTrade * 10, 100) * 0.1);
  const score = Math.max(0, Math.min(100, rawScore));
  const color = score >= 70 ? "text-buy" : score >= 40 ? "text-warning" : "text-sell";
  const label = score >= 70 ? "Low Risk" : score >= 40 ? "Moderate" : "High Risk";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className={cn("h-5 w-5", color)} />
          <div>
            <div className={cn("text-xl font-bold font-mono", color)}>{Math.round(score)}</div>
            <div className="text-[10px] text-muted-foreground">{label}</div>
          </div>
        </div>
        <div className="text-right text-[10px] text-muted-foreground">Risk Management Score</div>
      </div>

      <div className="space-y-2">
        <ScoreBar
          label="Drawdown Usage"
          value={drawdownUsage}
          maxLabel={`${drawdownUsage.toFixed(0)}%`}
          invert
        />
        <ScoreBar
          label="Consistency"
          value={consistencyScore}
          maxLabel={`${consistencyScore.toFixed(0)}%`}
        />
        <ScoreBar
          label="Trade Frequency"
          value={100 - overtradingScore}
          maxLabel={`${(100 - overtradingScore).toFixed(0)}%`}
        />
        <ScoreBar
          label="Risk per Trade"
          value={Math.max(0, 100 - riskPerTrade * 20)}
          maxLabel={`${riskPerTrade.toFixed(1)}%`}
        />
      </div>
    </div>
  );
}

function ScoreBar({
  label,
  value,
  maxLabel,
  invert,
}: {
  label: string;
  value: number;
  maxLabel: string;
  invert?: boolean;
}) {
  const effectiveVal = invert ? 100 - value : value;
  const color = effectiveVal >= 70 ? "bg-buy" : effectiveVal >= 40 ? "bg-warning" : "bg-sell";
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{maxLabel}</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  );
}

// ── #19 Account Health Badges ───────────────────────────────

export function AccountHealthBadge({
  account,
  metrics,
}: {
  account: AccountSummary;
  metrics?: AccountHealthMetrics;
}) {
  let label = "Active";
  let variant: "success" | "warning" | "danger" | "secondary" | "info" = "secondary";
  let icon = Activity;

  if (account.status === "FAILED") {
    label = "Failed";
    variant = "danger";
    icon = AlertTriangle;
  } else if (account.status === "PASSED") {
    label = "Passed";
    variant = "success";
    icon = Award;
  } else if (metrics) {
    const ddDaily = metrics.ddDaily?.current || 0;
    const ddTotal = metrics.ddTotal?.current || 0;
    const ddDailyMax = metrics.ddDaily?.max || 5;
    const ddTotalMax = metrics.ddTotal?.max || 10;

    if (ddDaily / ddDailyMax > 0.8 || ddTotal / ddTotalMax > 0.8) {
      label = "Near Breach";
      variant = "danger";
      icon = AlertTriangle;
    } else if (ddDaily / ddDailyMax > 0.5 || ddTotal / ddTotalMax > 0.5) {
      label = "At Risk";
      variant = "warning";
      icon = Shield;
    } else if ((metrics.profitTargetProgress ?? 0) > 50) {
      label = "On Track";
      variant = "success";
      icon = TrendingUp;
    } else {
      label = "Active";
      variant = "info";
      icon = Activity;
    }
  }

  const Icon = icon;
  return (
    <Badge variant={variant} className="text-[9px] gap-1">
      <Icon className="h-2.5 w-2.5" />
      {label}
    </Badge>
  );
}

// ── #20 Payout Calculator ───────────────────────────────────

export function PayoutCalculator({
  balance: _balance,
  profitSplit = 80,
}: {
  balance: number;
  profitSplit?: number;
}) {
  const [customProfit, setCustomProfit] = useState("");
  const profit = parseFloat(customProfit) || 0;
  const payout = profit * (profitSplit / 100);

  return (
    <div className="space-y-3">
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Profit Amount
        </label>
        <input
          type="number"
          value={customProfit}
          onChange={(e) => setCustomProfit(e.target.value)}
          placeholder="Enter profit..."
          className="w-full mt-1 text-sm font-mono"
          min="0"
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Profit Split</span>
        <span className="font-semibold">{profitSplit}%</span>
      </div>
      <div className="bg-accent/10 border border-accent/20 rounded-lg p-3 text-center">
        <div className="text-[10px] text-muted-foreground">Estimated Payout</div>
        <div className="text-lg font-bold font-mono text-accent">{formatCurrency(payout)}</div>
      </div>
    </div>
  );
}

// ── Helper ──────────────────────────────────────────────────

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

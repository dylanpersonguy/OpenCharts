import { Link } from "react-router-dom";
import type { AccountStats, EquityPoint, Fill, Position } from "../../../services/schemas";
import { type AccountWithExtras, startingBalanceOf } from "../../dashboardv2/useDashboardV2";
import { fmtSigned, fmtUsd, useCountUp } from "../theme-kit";
import { EquityChart, RadialGauge, Tile, TileHead } from "./vanta-tiles";

function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case "PHASE_1":
      return "Eval I";
    case "PHASE_2":
      return "Eval II";
    case "FUNDED":
      return "Funded";
    default:
      return phase ?? "—";
  }
}

/* ── Equity hero tile ───────────────────────────────────────── */

export function EquityHeroTile({
  account,
  history,
}: {
  account: AccountWithExtras | undefined;
  history: EquityPoint[];
}) {
  const equity = useCountUp(account?.equity ?? 0);
  const starting = account ? startingBalanceOf(account) : 0;
  const profit = (account?.equity ?? 0) - starting;
  const pct = starting > 0 ? (profit / starting) * 100 : 0;
  return (
    <Tile className="vt-reveal col-span-12 lg:col-span-7">
      <TileHead
        label="Account Equity"
        right={<span className="vt-chip vt-gold">{phaseLabel(account?.phase)}</span>}
      />
      <div className="px-5">
        <div className="vt-serif vt-shimmer text-[clamp(38px,4.5vw,58px)] font-semibold leading-none tabular-nums">
          {fmtUsd(equity)}
        </div>
        <div className="mt-2 flex items-baseline gap-3 pb-1">
          <span className={`text-sm font-bold tabular-nums ${profit >= 0 ? "vt-pos" : "vt-neg"}`}>
            {fmtSigned(profit)} ({profit >= 0 ? "+" : ""}
            {pct.toFixed(2)}%)
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            from {fmtUsd(starting)}
          </span>
        </div>
      </div>
      <div className="mt-auto px-2 pb-2">
        <EquityChart history={history} />
      </div>
    </Tile>
  );
}

/* ── Accounts tile ──────────────────────────────────────────── */

export function AccountsTile({
  accounts,
  activeAccountId,
  onSelect,
}: {
  accounts: AccountWithExtras[];
  activeAccountId: string | null;
  onSelect: (id: string) => void;
}) {
  const visible = accounts.filter((a) => a.status !== "CLOSED");
  return (
    <Tile className="vt-reveal-2 col-span-12 lg:col-span-5">
      <TileHead label="Accounts" right={<span className="vt-label">{visible.length}</span>} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visible.map((acc) => {
          const profit = (acc.equity || 0) - startingBalanceOf(acc);
          return (
            <button
              key={acc.id}
              type="button"
              className="vt-row w-full rounded-xl px-3 py-2.5 text-left"
              data-active={acc.id === activeAccountId}
              onClick={() => onSelect(acc.id)}
            >
              <div className="flex items-baseline justify-between">
                <span className="truncate text-xs font-bold">
                  {acc.label ?? acc.template?.name ?? "Account"}
                </span>
                <span className="vt-chip">{phaseLabel(acc.phase)}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between tabular-nums">
                <span className="text-sm font-semibold">{fmtUsd(acc.equity || 0)}</span>
                <span className={`text-[11px] font-bold ${profit >= 0 ? "vt-pos" : "vt-neg"}`}>
                  {fmtSigned(profit)}
                </span>
              </div>
            </button>
          );
        })}
        {visible.length === 0 && (
          <p className="px-3 py-6 text-xs text-muted-foreground">No accounts yet.</p>
        )}
      </div>
    </Tile>
  );
}

/* ── KPI mini tiles ─────────────────────────────────────────── */

function KpiTile({
  label,
  value,
  sub,
  tone,
  delay,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg";
  delay?: boolean;
}) {
  const toneClass = tone === "pos" ? "vt-pos" : tone === "neg" ? "vt-neg" : "";
  return (
    <Tile className={`${delay ? "vt-reveal-3" : "vt-reveal-2"} col-span-6 lg:col-span-3`}>
      <div className="px-5 py-4">
        <div className="vt-label">{label}</div>
        <div className={`vt-serif mt-1.5 text-2xl font-semibold tabular-nums ${toneClass}`}>
          {value}
        </div>
        {sub && <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{sub}</div>}
      </div>
    </Tile>
  );
}

export function KpiRow({
  account,
  stats,
  openPositionCount,
}: {
  account: AccountWithExtras | undefined;
  stats: AccountStats | undefined;
  openPositionCount: number;
}) {
  const floating = (account?.equity ?? 0) - (account?.balance ?? 0);
  return (
    <>
      <KpiTile
        label="Floating P&L"
        value={fmtSigned(floating)}
        tone={floating > 0 ? "pos" : floating < 0 ? "neg" : undefined}
      />
      <KpiTile
        label="Win Rate"
        value={stats ? `${(stats.winRate * 100).toFixed(1)}%` : "—"}
        sub={stats ? `${stats.totalTrades} trades` : undefined}
        delay
      />
      <KpiTile
        label="Profit Factor"
        value={stats ? stats.profitFactor.toFixed(2) : "—"}
        tone={stats && stats.profitFactor >= 1 ? "pos" : undefined}
        delay
      />
      <KpiTile label="Open Positions" value={String(openPositionCount)} delay />
    </>
  );
}

/* ── Risk gauges + target tile ──────────────────────────────── */

type MetricsLike = {
  ddDaily?: number | null;
  ddDailyMax?: number | null;
  ddTotal?: number | null;
  ddTotalMax?: number | null;
  profitTargetPercent?: number | null;
  tradingDaysCompleted?: number | null;
};

function targetProgress(
  metrics: MetricsLike | undefined,
  account: AccountWithExtras | undefined,
): { target: number; progress: number } | null {
  const target = metrics?.profitTargetPercent;
  if (!target || !account) return null;
  const starting = startingBalanceOf(account);
  if (starting <= 0) return null;
  const profitPct = (((account.equity ?? 0) - starting) / starting) * 100;
  return { target, progress: Math.max(0, Math.min(100, (profitPct / target) * 100)) };
}

export function RiskTile({
  metrics,
  account,
}: {
  metrics: MetricsLike | undefined;
  account: AccountWithExtras | undefined;
}) {
  const tp = targetProgress(metrics, account);
  return (
    <Tile className="vt-reveal-3 col-span-12 lg:col-span-5">
      <TileHead
        label="Risk Envelope"
        right={
          metrics?.tradingDaysCompleted != null ? (
            <span className="vt-label">{metrics.tradingDaysCompleted} days</span>
          ) : undefined
        }
      />
      <div className="flex flex-1 items-center justify-around px-4 pb-3">
        <RadialGauge label="Daily DD" used={metrics?.ddDaily ?? 0} max={metrics?.ddDailyMax ?? 5} />
        <RadialGauge
          label="Total DD"
          used={metrics?.ddTotal ?? 0}
          max={metrics?.ddTotalMax ?? 10}
        />
      </div>
      {tp && (
        <div className="px-5 pb-4">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="vt-label">Profit Target ({tp.target}%)</span>
            <span className="text-[11px] font-bold tabular-nums vt-gold">
              {tp.progress.toFixed(0)}%
            </span>
          </div>
          <div className="vt-meter">
            <div className="vt-meter-fill" style={{ width: `${tp.progress}%` }} />
          </div>
        </div>
      )}
    </Tile>
  );
}

/* ── Positions + activity tiles ─────────────────────────────── */

export function PositionsTile({ positions }: { positions: Position[] }) {
  const open = positions.filter((p) => p.quantity > 0);
  return (
    <Tile className="vt-reveal-3 col-span-12 lg:col-span-7">
      <TileHead
        label="Open Positions"
        right={
          <Link to="/trading" className="vt-label !text-[hsl(var(--accent))] hover:underline">
            Open Terminal →
          </Link>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {open.length === 0 ? (
          <p className="px-3 py-6 text-xs text-muted-foreground">Flat. No open exposure.</p>
        ) : (
          open.map((p) => {
            const pnl = p.unrealizedPnl ?? 0;
            return (
              <div
                key={p.id}
                className="vt-row flex items-baseline justify-between rounded-xl px-3 py-2.5"
              >
                <div className="flex items-baseline gap-3">
                  <span className="text-xs font-bold">{p.symbolName}</span>
                  <span
                    className={`text-[10px] font-bold ${p.side === "LONG" ? "vt-pos" : "vt-neg"}`}
                  >
                    {p.side} {p.quantity}
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    @ {p.entryPrice}
                  </span>
                </div>
                <span
                  className={`text-xs font-bold tabular-nums ${pnl >= 0 ? "vt-pos" : "vt-neg"}`}
                >
                  {fmtSigned(pnl)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </Tile>
  );
}

export function ActivityTile({ fills }: { fills: Fill[] }) {
  const recent = fills.slice(0, 8);
  return (
    <Tile className="vt-reveal-3 col-span-12">
      <TileHead label="Recent Activity" />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 lg:columns-2 lg:gap-10">
        {recent.length === 0 ? (
          <p className="py-4 text-xs text-muted-foreground">No executions yet.</p>
        ) : (
          recent.map((f) => (
            <div
              key={f.id}
              className="flex items-baseline justify-between border-b border-border/60 py-2 last:border-0"
            >
              <div className="flex items-baseline gap-2">
                <span
                  className={`h-1.5 w-1.5 self-center rounded-full ${f.side === "BUY" ? "bg-[hsl(var(--buy))]" : "bg-[hsl(var(--sell))]"}`}
                />
                <span className="text-xs font-bold">{f.symbolName}</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {f.quantity} @ {f.price}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {new Date(f.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))
        )}
      </div>
    </Tile>
  );
}

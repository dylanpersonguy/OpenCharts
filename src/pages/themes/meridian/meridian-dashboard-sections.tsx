import { Link } from "react-router-dom";
import type { AccountStats, EquityPoint, Fill, Position } from "../../../services/schemas";
import type { AccountWithExtras } from "../../dashboardv2/useDashboardV2";
import { startingBalanceOf } from "../../dashboardv2/useDashboardV2";
import {
  EquitySparkline,
  fmtSigned,
  fmtUsd,
  MeterRow,
  RuleHeading,
  StatCell,
  useCountUp,
} from "./meridian-primitives";

export function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case "PHASE_1":
      return "Evaluation I";
    case "PHASE_2":
      return "Evaluation II";
    case "FUNDED":
      return "Funded";
    default:
      return phase ?? "—";
  }
}

/* ── 01 · Hero: the equity statement ───────────────────────── */

export function HeroEquity({
  account,
  history,
}: {
  account: AccountWithExtras | undefined;
  history: EquityPoint[];
}) {
  const equity = account?.equity ?? 0;
  const starting = account ? startingBalanceOf(account) : 0;
  const profit = equity - starting;
  const profitPct = starting > 0 ? (profit / starting) * 100 : 0;
  const animated = useCountUp(equity);

  return (
    <section className="mr-panel mr-reveal p-6">
      <div className="flex items-baseline justify-between">
        <span className="mr-microlabel">Account Equity</span>
        <span className="mr-microlabel">{account?.label ?? account?.template?.name ?? ""}</span>
      </div>
      <div className="mr-display mr-num mt-3 text-[clamp(40px,6vw,72px)]">{fmtUsd(animated)}</div>
      <div className="mt-2 flex items-baseline gap-4">
        <span className={`mr-num text-sm font-semibold ${profit >= 0 ? "mr-pos" : "mr-neg"}`}>
          {fmtSigned(profit)} ({profit >= 0 ? "+" : ""}
          {profitPct.toFixed(2)}%)
        </span>
        <span className="mr-num text-[11px] text-muted-foreground">
          since {fmtUsd(starting)} start
        </span>
      </div>
      <hr className="mr-rule my-5" />
      <EquitySparkline history={history} />
    </section>
  );
}

/* ── 02 · Account index rail ───────────────────────────────── */

function AccountRow({
  acc,
  active,
  onSelect,
}: {
  acc: AccountWithExtras;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const profit = (acc.equity || 0) - startingBalanceOf(acc);
  return (
    <button
      type="button"
      onClick={() => onSelect(acc.id)}
      className={`w-full px-4 py-3 text-left transition-colors hover:bg-muted/60 ${active ? "mr-active-bar bg-muted/40" : ""}`}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold truncate">
          {acc.label ?? acc.template?.name ?? "Account"}
        </span>
        <span className="mr-microlabel">{phaseLabel(acc.phase)}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="mr-num text-sm font-semibold">{fmtUsd(acc.equity || 0)}</span>
        <span className={`mr-num text-[11px] font-semibold ${profit >= 0 ? "mr-pos" : "mr-neg"}`}>
          {fmtSigned(profit)}
        </span>
      </div>
    </button>
  );
}

export function AccountIndex({
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
    <section className="mr-panel mr-reveal-2 flex min-h-0 flex-col">
      <div className="p-4 pb-0">
        <RuleHeading
          index="02"
          title="Accounts"
          right={<span className="mr-num mr-microlabel">{visible.length}</span>}
        />
      </div>
      <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-xs text-muted-foreground">No accounts yet.</p>
        ) : (
          visible.map((acc) => (
            <AccountRow
              key={acc.id}
              acc={acc}
              active={acc.id === activeAccountId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </section>
  );
}

/* ── 03 · Performance figures ──────────────────────────────── */

function signTone(value: number): "pos" | "neg" | undefined {
  if (value > 0) return "pos";
  if (value < 0) return "neg";
  return undefined;
}

type Figure = { label: string; value: string; tone?: "pos" | "neg"; sub?: string };

function buildFigures(
  account: AccountWithExtras | undefined,
  stats: AccountStats | undefined,
  openPositionCount: number,
): Figure[] {
  const floating = (account?.equity ?? 0) - (account?.balance ?? 0);
  return [
    { label: "Balance", value: fmtUsd(account?.balance ?? 0) },
    { label: "Floating P&L", value: fmtSigned(floating), tone: signTone(floating) },
    { label: "Open Positions", value: String(openPositionCount) },
    {
      label: "Win Rate",
      value: stats ? `${(stats.winRate * 100).toFixed(1)}%` : "—",
      sub: stats ? `${stats.totalTrades} trades` : undefined,
    },
    {
      label: "Profit Factor",
      value: stats ? stats.profitFactor.toFixed(2) : "—",
      tone: stats && stats.profitFactor >= 1 ? "pos" : undefined,
    },
    {
      label: "Best / Worst",
      value: stats ? fmtSigned(stats.bestTrade) : "—",
      sub: stats ? fmtSigned(stats.worstTrade) : undefined,
    },
  ];
}

export function FiguresGrid({
  account,
  stats,
  openPositionCount,
}: {
  account: AccountWithExtras | undefined;
  stats: AccountStats | undefined;
  openPositionCount: number;
}) {
  const figures = buildFigures(account, stats, openPositionCount);
  return (
    <section className="mr-panel mr-reveal-2 p-4">
      <RuleHeading index="03" title="Figures" />
      <div className="grid grid-cols-2 divide-x divide-y divide-border border border-border md:grid-cols-3 xl:grid-cols-6">
        {figures.map((f) => (
          <StatCell key={f.label} label={f.label} value={f.value} tone={f.tone} sub={f.sub} />
        ))}
      </div>
    </section>
  );
}

/* ── 04 · Risk envelope meters ─────────────────────────────── */

export function RiskEnvelope({
  metrics,
}: {
  metrics:
    | {
        ddDaily?: number | null;
        ddDailyMax?: number | null;
        ddTotal?: number | null;
        ddTotalMax?: number | null;
        profitTargetPercent?: number | null;
        tradingDaysCompleted?: number | null;
      }
    | undefined;
}) {
  return (
    <section className="mr-panel mr-reveal-3 p-4">
      <RuleHeading
        index="04"
        title="Risk Envelope"
        right={
          metrics?.tradingDaysCompleted != null ? (
            <span className="mr-num mr-microlabel">
              {metrics.tradingDaysCompleted} trading days
            </span>
          ) : undefined
        }
      />
      <MeterRow
        label="Daily Drawdown"
        used={metrics?.ddDaily ?? 0}
        max={metrics?.ddDailyMax ?? 5}
      />
      <MeterRow
        label="Total Drawdown"
        used={metrics?.ddTotal ?? 0}
        max={metrics?.ddTotalMax ?? 10}
      />
      {metrics?.profitTargetPercent != null && (
        <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2">
          <span className="mr-microlabel">Profit Target</span>
          <span className="mr-num text-[11px] font-semibold">
            {metrics.profitTargetPercent.toFixed(0)}%
          </span>
        </div>
      )}
    </section>
  );
}

/* ── 05 · Open positions ───────────────────────────────────── */

function PositionRow({ p }: { p: Position }) {
  const pnl = p.unrealizedPnl ?? 0;
  return (
    <tr>
      <td className="font-semibold">{p.symbolName}</td>
      <td className={p.side === "LONG" ? "mr-pos" : "mr-neg"}>{p.side}</td>
      <td>{p.quantity}</td>
      <td>{p.entryPrice}</td>
      <td>{p.currentPrice ?? "—"}</td>
      <td className={`font-semibold ${pnl >= 0 ? "mr-pos" : "mr-neg"}`}>{fmtSigned(pnl)}</td>
    </tr>
  );
}

export function OpenPositions({ positions }: { positions: Position[] }) {
  const open = positions.filter((p) => p.quantity > 0);
  return (
    <section className="mr-panel mr-reveal-3 p-4">
      <RuleHeading
        index="05"
        title="Open Positions"
        right={
          <Link to="/trading" className="mr-microlabel !text-accent hover:underline">
            Open Terminal →
          </Link>
        }
      />
      {open.length === 0 ? (
        <p className="py-4 text-xs text-muted-foreground">Flat. No open exposure.</p>
      ) : (
        <table className="mr-table w-full">
          <thead>
            <tr>
              <th>Instrument</th>
              <th>Side</th>
              <th>Size</th>
              <th>Entry</th>
              <th>Mark</th>
              <th>P&L</th>
            </tr>
          </thead>
          <tbody>
            {open.map((p) => (
              <PositionRow key={p.id} p={p} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ── 06 · Activity ledger ──────────────────────────────────── */

export function ActivityLedger({ fills }: { fills: Fill[] }) {
  const recent = fills.slice(0, 8);
  return (
    <section className="mr-panel mr-reveal-3 p-4">
      <RuleHeading index="06" title="Recent Activity" />
      {recent.length === 0 ? (
        <p className="py-4 text-xs text-muted-foreground">No executions yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {recent.map((f) => (
            <div key={f.id} className="flex items-baseline justify-between py-2">
              <div className="flex items-baseline gap-2">
                <span
                  className={`mr-microlabel ${f.side === "BUY" ? "!text-[hsl(var(--buy))]" : "!text-[hsl(var(--sell))]"}`}
                >
                  {f.side}
                </span>
                <span className="text-xs font-semibold">{f.symbolName}</span>
                <span className="mr-num text-[11px] text-muted-foreground">
                  {f.quantity} @ {f.price}
                </span>
              </div>
              <span className="mr-num text-[11px] text-muted-foreground">
                {new Date(f.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

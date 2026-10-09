import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { computeSessionStats, type GroupStats, type SessionStats } from "../../services/replay/stats.ts";
import { EquityCurveChart } from "./EquityCurveChart.tsx";
import { journalRows } from "./ReplayJournalPanel.tsx";
import { useReplayJournal } from "./useReplayJournal.ts";
import { useReplaySession, useSessionEngineState } from "./useReplaySessions.ts";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const money = (x: number) => `${x >= 0 ? "" : "-"}${formatCurrency(Math.abs(x))}`;
const fmt = (sec: number) =>
  new Date(sec * 1000).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" });

function Tile({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-base font-semibold", tone === "up" && "text-buy", tone === "down" && "text-sell")}>{value}</div>
    </div>
  );
}

function StatTiles({ s }: { s: SessionStats }) {
  const pf = s.profitFactor === null ? "—" : Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "∞";
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      <Tile label="Net P&L" value={money(s.netPnl)} tone={s.netPnl >= 0 ? "up" : "down"} />
      <Tile label="Trades" value={String(s.tradeCount)} />
      <Tile label="Win rate" value={pct(s.winRate)} />
      <Tile label="Profit factor" value={pf} />
      <Tile label="Avg R" value={s.avgR === null ? "—" : s.avgR.toFixed(2)} />
      <Tile label="Expectancy" value={money(s.expectancy)} tone={s.expectancy >= 0 ? "up" : "down"} />
      <Tile label="Avg win" value={money(s.avgWin)} tone="up" />
      <Tile label="Avg loss" value={money(s.avgLoss)} tone="down" />
      <Tile label="Largest win" value={money(s.largestWin)} tone="up" />
      <Tile label="Largest loss" value={money(s.largestLoss)} tone="down" />
      <Tile label="Max drawdown" value={`${money(s.maxDrawdownAbs)} (${pct(s.maxDrawdownPct)})`} tone="down" />
      <Tile label="W / L / BE" value={`${s.wins} / ${s.losses} / ${s.breakeven}`} />
    </div>
  );
}

function Breakdown({ title, groups }: { title: string; groups: Readonly<Record<string, GroupStats>> }) {
  const rows = Object.entries(groups).sort((a, b) => b[1].netPnl - a[1].netPnl);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card">
      <h3 className="px-3 py-2 text-xs font-semibold border-b border-border">{title}</h3>
      <table className="w-full text-xs">
        <thead className="text-[10px] text-muted-foreground">
          <tr className="text-left">
            <th className="px-3 py-1 font-normal" />
            <th className="px-2 font-normal text-right">Trades</th>
            <th className="px-2 font-normal text-right">Win rate</th>
            <th className="px-2 font-normal text-right">Avg R</th>
            <th className="px-3 font-normal text-right">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, g]) => (
            <tr key={name} className="border-t border-border/50">
              <td className="px-3 py-1">{name}</td>
              <td className="px-2 text-right font-mono">{g.count}</td>
              <td className="px-2 text-right font-mono">{pct(g.winRate)}</td>
              <td className="px-2 text-right font-mono">{g.avgR === null ? "—" : g.avgR.toFixed(2)}</td>
              <td className={cn("px-3 text-right font-mono", g.netPnl >= 0 ? "text-buy" : "text-sell")}>{money(g.netPnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Route `/replay/:sessionId/stats` — performance summary and trade log of one session. */
export function ReplayStatsPage() {
  const { sessionId = "" } = useParams();
  const session = useReplaySession(sessionId);
  const engineState = useSessionEngineState(sessionId);
  const journal = useReplayJournal(sessionId);
  const trades = useMemo(() => engineState.data?.closedTrades ?? [], [engineState.data]);
  const stats = useMemo(
    () => computeSessionStats(trades, session.data?.startingBalance ?? 0, journal.data ?? []),
    [trades, session.data, journal.data],
  );
  const rows = useMemo(() => journalRows(trades), [trades]);
  const notes = useMemo(() => new Map((journal.data ?? []).map((e) => [e.positionId, e])), [journal.data]);

  if (session.isLoading || engineState.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!session.data) return <div className="p-6 text-sm">Session not found. <Link className="text-primary" to="/replay">Back to sessions</Link></div>;
  const s = session.data;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Button asChild size="sm" variant="ghost">
          <Link to="/replay">
            <ArrowLeft className="h-4 w-4 mr-1" /> Sessions
          </Link>
        </Button>
        <div>
          <h1 className="text-sm font-semibold">{s.name}</h1>
          <p className="text-[11px] text-muted-foreground">
            {s.symbol} · {fmt(s.startTime)} → {fmt(s.cursorTime)} UTC · start {formatCurrency(s.startingBalance)}
          </p>
        </div>
        <div className="flex-1" />
        <Button asChild size="sm">
          <Link to={`/replay/${s.id}`}>
            <Play className="h-3.5 w-3.5 mr-1" /> Resume
          </Link>
        </Button>
      </header>
      <main className="space-y-4 p-4">
        <StatTiles s={stats} />
        {stats.equityCurve.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-3">
            <h3 className="mb-2 text-xs font-semibold">Equity (closed trades)</h3>
            <EquityCurveChart points={stats.equityCurve} startTime={s.startTime} startingBalance={s.startingBalance} />
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-3">
          <Breakdown title="By setup" groups={stats.bySetup} />
          <Breakdown title="By mistake" groups={stats.byMistake} />
          <Breakdown title="By side" groups={stats.bySide} />
        </div>
        <div className="rounded-lg border border-border bg-card overflow-auto">
          <h3 className="px-3 py-2 text-xs font-semibold border-b border-border">Trades</h3>
          {rows.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">No closed trades yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[10px] text-muted-foreground">
                <tr className="text-left">
                  <th className="px-3 py-1 font-normal">Opened</th>
                  <th className="px-2 font-normal">Closed</th>
                  <th className="px-2 font-normal">Side</th>
                  <th className="px-2 font-normal text-right">Size</th>
                  <th className="px-2 font-normal">Exit</th>
                  <th className="px-2 font-normal text-right">R</th>
                  <th className="px-2 font-normal text-right">Net</th>
                  <th className="px-3 font-normal">Setup / notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const e = notes.get(r.positionId);
                  return (
                    <tr key={r.positionId} className="border-t border-border/50 align-top">
                      <td className="px-3 py-1 font-mono whitespace-nowrap">{fmt(r.entryTime)}</td>
                      <td className="px-2 font-mono whitespace-nowrap">{fmt(r.exitTime)}</td>
                      <td className={cn("px-2", r.side === "LONG" ? "text-buy" : "text-sell")}>{r.side}</td>
                      <td className="px-2 text-right font-mono">{r.quantity}</td>
                      <td className="px-2">{r.exitReasons.join("/")}</td>
                      <td className="px-2 text-right font-mono">{r.rMultiple === null ? "—" : r.rMultiple.toFixed(2)}</td>
                      <td className={cn("px-2 text-right font-mono", r.netPnl >= 0 ? "text-buy" : "text-sell")}>{money(r.netPnl)}</td>
                      <td className="px-3 text-muted-foreground">
                        {[e?.setup, ...(e?.mistakes ?? [])].filter(Boolean).join(", ")}
                        {e?.notes ? <div className="line-clamp-2 text-foreground/80">{e.notes}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}

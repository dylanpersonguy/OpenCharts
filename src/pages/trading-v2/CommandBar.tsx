import { ArrowLeftRight, Volume2, VolumeX, Zap } from "lucide-react";
import { Link } from "react-router-dom";

type AccountLike = {
  balance?: number;
  equity?: number;
  margin?: number;
} | null;

type CommandBarProps = {
  account: AccountLike;
  positionPnl: number;
  openPositions: number;
  isFeedConnected: boolean;
  oneClick: boolean;
  onToggleOneClick: () => void;
  soundMuted: boolean;
  onToggleMute: () => void;
};

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CommandBar(props: CommandBarProps) {
  const { account, positionPnl } = props;
  const balance = account?.balance ?? 0;
  const equity = (account?.equity ?? balance) + 0; // store equity excludes live pnl drift
  const pnlPct = balance > 0 ? (positionPnl / balance) * 100 : 0;

  return (
    <div className="tv2-commandbar flex items-center gap-5 px-4 py-2.5">
      <Brand />
      <div className="h-7 w-px bg-border shrink-0" />
      <Stat label="Equity" value={`$${fmt(equity)}`} />
      <Stat label="Balance" value={`$${fmt(balance)}`} />
      <PnlStat pnl={positionPnl} pct={pnlPct} />
      <Stat label="Margin" value={`$${fmt(account?.margin ?? 0)}`} />
      <RiskMeter pct={pnlPct} />
      <div className="flex-1" />
      <Controls {...props} />
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <span className="h-2 w-2 rounded-full bg-[#009AEE] shadow-[0_0_10px_rgba(0,154,238,0.8)]" />
      <span className="text-sm font-bold tracking-wide">Terminal</span>
      <span className="tv2-chip">V2 BETA</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden lg:block shrink-0">
      <div className="tv2-stat-label">{label}</div>
      <div className="tv2-stat-value text-sm">{value}</div>
    </div>
  );
}

function PnlStat({ pnl, pct }: { pnl: number; pct: number }) {
  const positive = pnl >= 0;
  const color = positive ? "text-emerald-400" : "text-red-400";
  return (
    <div className="shrink-0">
      <div className="tv2-stat-label flex items-center gap-1.5">
        Floating P&L
        <span
          className={`tv2-pulse h-1 w-1 rounded-full ${positive ? "bg-emerald-400" : "bg-red-400"}`}
        />
      </div>
      <div className={`tv2-stat-value text-sm ${color}`}>
        {positive ? "+" : ""}
        {fmt(pnl)} ({pct.toFixed(2)}%)
      </div>
    </div>
  );
}

/* Daily-risk visual: how much of the soft 5% floating-loss budget is used. */
function RiskMeter({ pct }: { pct: number }) {
  const used = Math.min(100, Math.max(0, (-pct / 5) * 100));
  const color = used > 80 ? "#f87171" : used > 50 ? "#fbbf24" : "#34d399";
  return (
    <div className="hidden xl:block w-36 shrink-0">
      <div className="tv2-stat-label flex justify-between">
        <span>Risk used</span>
        <span style={{ color }}>{used.toFixed(0)}%</span>
      </div>
      <div className="tv2-meter mt-1.5">
        <div className="tv2-meter-fill" style={{ width: `${used}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function Controls({
  isFeedConnected,
  oneClick,
  onToggleOneClick,
  soundMuted,
  onToggleMute,
  openPositions,
}: CommandBarProps) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="hidden lg:inline text-[11px] text-muted-foreground tabular-nums">
        {openPositions} open
      </span>
      <span
        className={`flex items-center gap-1.5 text-[11px] font-medium ${
          isFeedConnected ? "text-emerald-400" : "text-red-400"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${isFeedConnected ? "bg-emerald-400" : "bg-red-400 animate-pulse"}`}
        />
        {isFeedConnected ? "Live" : "Offline"}
      </span>
      <button
        type="button"
        onClick={onToggleOneClick}
        title="One-click trading"
        className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
          oneClick
            ? "border-[#009AEE]/50 bg-[#009AEE]/15 text-sky-300"
            : "border-border text-muted-foreground hover:text-foreground"
        }`}
      >
        <Zap className="h-3 w-3" />
        1-Click
      </button>
      <button
        type="button"
        onClick={onToggleMute}
        title={soundMuted ? "Unmute trade sounds" : "Mute trade sounds"}
        className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground transition-colors"
      >
        {soundMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
      </button>
      <Link
        to="/trading"
        title="Switch to the classic terminal"
        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeftRight className="h-3 w-3" />
        Classic
      </Link>
    </div>
  );
}

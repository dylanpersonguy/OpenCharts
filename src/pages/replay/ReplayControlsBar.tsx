import { useEffect, useRef } from "react";
import { Crosshair, Loader2, Pause, Play, SkipForward, Square } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { ReplayController } from "../../services/replay/controller.ts";
import { PLAYBACK_SPEEDS } from "../../services/replay/playback-clock.ts";
import { useReplayStore } from "../../services/replay/store.ts";
import { toast } from "../../services/toast.ts";

const fmtCursor = (sec: number) =>
  new Date(sec * 1000).toLocaleString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const toDateTimeInput = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 16);
const fromDateTimeInput = (v: string) => Math.floor(Date.parse(`${v}:00Z`) / 1000);

const btn =
  "flex items-center gap-1 h-7 px-2 rounded-md text-xs border border-border hover:bg-secondary disabled:opacity-40 disabled:pointer-events-none";

/** Transport bar for an open replay session: step, play, speed, jump and account summary. */
export function ReplayControlsBar({ controller }: { controller: ReplayController }) {
  const status = useReplayStore((s) => s.status);
  const cursor = useReplayStore((s) => s.cursorTime);
  const speed = useReplayStore((s) => s.speed);
  const stepUnit = useReplayStore((s) => s.stepUnit);
  const timeframe = useReplayStore((s) => s.timeframe);
  const busy = useReplayStore((s) => s.busy);
  const selecting = useReplayStore((s) => s.selectingBar);
  const account = useReplayStore((s) => s.account);
  const session = useReplayStore((s) => s.session);
  const error = useReplayStore((s) => s.error);
  const jumpRef = useRef<HTMLInputElement>(null);

  // Mirror the cursor into the jump box unless the user is editing it.
  useEffect(() => {
    const el = jumpRef.current;
    if (el && cursor && document.activeElement !== el) el.value = toDateTimeInput(cursor);
  }, [cursor]);

  const playing = status === "playing";
  const ended = status === "ended";
  const startBalance = session?.startingBalance ?? 0;
  const pnl = (account?.equity ?? startBalance) - startBalance;

  const jump = async (timeSec: number) => {
    const problem = await controller.jumpTo(timeSec);
    if (problem) toast.warning("Can't jump there", problem);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b border-border bg-card text-xs">
      <span className="rounded bg-primary/15 text-primary px-1.5 py-0.5 font-semibold tracking-wide">REPLAY</span>
      <span className="font-mono tabular-nums" title="Replay time (UTC) of the last revealed bar">
        {cursor ? fmtCursor(cursor) : "—"} UTC
      </span>
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Loading history" />}
      {error && (
        <span className="text-sell max-w-[320px] truncate" role="alert" title={error}>
          {error}
        </span>
      )}

      <div className="h-4 border-l border-border mx-1" />

      <button
        className={btn}
        onClick={() => void controller.step()}
        disabled={playing || ended}
        title="Step forward (Shift+→)"
      >
        <SkipForward className="h-3.5 w-3.5" />
        Step
      </button>
      <button
        className={cn(btn, playing && "bg-primary text-primary-foreground border-primary hover:bg-primary/90")}
        onClick={() => (playing ? controller.pause() : controller.play())}
        disabled={ended}
        title="Play / pause (Shift+↓)"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        {playing ? "Pause" : "Play"}
      </button>
      <select
        className="h-7 rounded-md border border-border bg-background px-1"
        value={speed}
        onChange={(e) => controller.setSpeed(Number(e.target.value))}
        aria-label="Playback speed (bars per second)"
      >
        {PLAYBACK_SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
      <select
        className="h-7 rounded-md border border-border bg-background px-1"
        value={stepUnit}
        onChange={(e) => controller.setStepUnit(e.target.value === "base" ? "base" : "chart")}
        aria-label="Step size"
        title="How far one step moves"
      >
        <option value="chart">Step: 1 {timeframe} bar</option>
        <option value="base">Step: 15m</option>
      </select>

      <div className="h-4 border-l border-border mx-1" />

      <button
        className={cn(btn, selecting && "bg-primary/20 border-primary text-primary")}
        onClick={() => controller.setSelectingBar(!selecting)}
        title="Click a bar on the chart to restart the replay from there"
      >
        <Crosshair className="h-3.5 w-3.5" />
        {selecting ? "Click a bar…" : "Select bar"}
      </button>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const value = jumpRef.current?.value;
          const target = value ? fromDateTimeInput(value) : Number.NaN;
          if (Number.isFinite(target)) void jump(target);
        }}
      >
        <input
          type="datetime-local"
          className="h-7 rounded-md border border-border bg-background px-1"
          ref={jumpRef}
          defaultValue={cursor ? toDateTimeInput(cursor) : ""}
          aria-label="Jump to date (UTC)"
        />
        <button type="submit" className={btn}>
          Go
        </button>
      </form>

      <div className="flex-1" />

      <span className="text-muted-foreground">Balance</span>
      <span className="font-mono">{formatCurrency(account?.balance ?? startBalance)}</span>
      <span className="text-muted-foreground">Equity</span>
      <span className={cn("font-mono", pnl >= 0 ? "text-buy" : "text-sell")}>
        {formatCurrency(account?.equity ?? startBalance)}
      </span>
      <button
        className={btn}
        disabled={ended}
        onClick={() => void controller.endSession()}
        title="Close all positions and finish this session"
      >
        <Square className="h-3 w-3" />
        End
      </button>
    </div>
  );
}

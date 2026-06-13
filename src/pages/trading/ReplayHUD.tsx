import { useState } from "react";
import { Play, Pause, Square } from "lucide-react";
import { cn } from "../../lib/utils.ts";
import { useTradingStore } from "../../services/store.tsx";
import { accountsApi } from "../../services/api/accounts.ts";

const SPEED_OPTIONS = [0.5, 1, 2, 5, 10] as const;
type Speed = (typeof SPEED_OPTIONS)[number];

function formatReplayTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function ReplayHUD({ accountId }: { accountId: string }) {
  const { isReplaying, replayPaused, replaySpeed, replayCursorTimestamp, setReplaySessionDate } =
    useTradingStore();

  const storageKey = `replay_session_date_${accountId}`;
  const [sessionDate, setSessionDate] = useState<string>(
    () => sessionStorage.getItem(storageKey) ?? new Date().toISOString().slice(0, 10),
  );

  const handleDateChange = (date: string) => {
    setSessionDate(date);
    sessionStorage.setItem(storageKey, date);
  };

  const handleStart = () => {
    setReplaySessionDate(sessionDate);
    accountsApi.replayStart(accountId, sessionDate, replaySpeed).catch(() => null);
  };

  const handlePause = () => {
    accountsApi.replayPause(accountId, sessionDate).catch(() => null);
  };

  const handleResume = () => {
    accountsApi.replayResume(accountId, sessionDate).catch(() => null);
  };

  const handleStop = () => {
    accountsApi.replayStop(accountId, sessionDate).catch(() => null);
  };

  const handleSpeed = (speed: Speed) => {
    if (!isReplaying) return;
    accountsApi.replaySetSpeed(accountId, sessionDate, speed).catch(() => null);
  };

  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-orange-500/10 border border-orange-500/30 shrink-0">
      <span className="text-orange-500 text-[10px] font-bold tracking-wider uppercase hidden sm:inline">
        Replay
      </span>

      {!isReplaying ? (
        <input
          type="date"
          value={sessionDate}
          onChange={(e) => handleDateChange(e.target.value)}
          max={new Date().toISOString().slice(0, 10)}
          className="text-[11px] bg-transparent border border-border rounded px-1 py-0 text-foreground w-[7.5rem] tabular-nums"
        />
      ) : (
        replayCursorTimestamp != null && (
          <span className="text-[11px] font-mono text-orange-400 tabular-nums">
            {formatReplayTime(replayCursorTimestamp)}
          </span>
        )
      )}

      {!isReplaying ? (
        <button
          onClick={handleStart}
          title="Start Replay"
          className="p-0.5 rounded hover:bg-orange-500/20 text-orange-500"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
        </button>
      ) : replayPaused ? (
        <button
          onClick={handleResume}
          title="Resume"
          className="p-0.5 rounded hover:bg-orange-500/20 text-orange-500"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
        </button>
      ) : (
        <button
          onClick={handlePause}
          title="Pause"
          className="p-0.5 rounded hover:bg-orange-500/20 text-orange-500"
        >
          <Pause className="h-3.5 w-3.5 fill-current" />
        </button>
      )}

      {isReplaying && (
        <button
          onClick={handleStop}
          title="Stop Replay"
          className="p-0.5 rounded hover:bg-red-500/20 text-red-400"
        >
          <Square className="h-3.5 w-3.5 fill-current" />
        </button>
      )}

      <div className="flex items-center gap-0.5">
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => handleSpeed(s)}
            disabled={!isReplaying}
            className={cn(
              "px-1 py-0.5 rounded text-[10px] font-medium transition-all",
              replaySpeed === s
                ? "bg-orange-500 text-white"
                : "text-muted-foreground hover:bg-orange-500/20 hover:text-orange-500 disabled:opacity-40 disabled:cursor-default",
            )}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}

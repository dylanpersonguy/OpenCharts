import { useRef, useCallback } from "react";
import { useTradingStore } from "../../services/store.tsx";
import { useReplaySession } from "../../services/queries.ts";
import { accountsApi } from "../../services/api/accounts.ts";

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function ReplayScrubber({ accountId }: { accountId: string }) {
  const { replayCursorTimestamp, replaySessionDate } = useTradingStore();
  const { data } = useReplaySession(accountId, replaySessionDate);

  const barRef = useRef<HTMLDivElement>(null);

  const tickBuffer = data?.tickBuffer ?? [];
  const tradeEvents = data?.tradeEvents ?? [];
  const sessionDate = replaySessionDate;

  const startMs = tickBuffer[0]?.t ?? null;
  const endMs = tickBuffer[tickBuffer.length - 1]?.t ?? null;
  const rangeMs = startMs != null && endMs != null ? endMs - startMs : 0;

  const thumbPct =
    replayCursorTimestamp != null && startMs != null && rangeMs > 0
      ? Math.max(0, Math.min(100, ((replayCursorTimestamp - startMs) / rangeMs) * 100))
      : null;

  const seekToX = useCallback(
    (clientX: number) => {
      if (!barRef.current || !sessionDate || startMs == null || rangeMs <= 0) return;
      const rect = barRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const ts = new Date(startMs + pct * rangeMs).toISOString();
      accountsApi.replaySeek(accountId, sessionDate, ts).catch(() => null);
    },
    [accountId, sessionDate, startMs, rangeMs],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      seekToX(e.clientX);
    },
    [seekToX],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.buttons !== 1) return;
      seekToX(e.clientX);
    },
    [seekToX],
  );

  if (!replaySessionDate || tickBuffer.length === 0) return null;

  return (
    <div className="h-7 px-3 flex items-center gap-2 bg-card border-t border-border shrink-0 select-none">
      {/* Start time label */}
      {startMs != null && (
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums shrink-0">
          {formatTime(startMs)}
        </span>
      )}

      {/* Track */}
      <div
        ref={barRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        className="relative flex-1 h-1.5 rounded-full bg-secondary cursor-pointer"
      >
        {/* Filled portion */}
        {thumbPct != null && (
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-orange-500/60"
            style={{ width: `${thumbPct}%` }}
          />
        )}

        {/* Trade event markers */}
        {startMs != null &&
          rangeMs > 0 &&
          tradeEvents.map((ev) => {
            const evMs = new Date(ev.timestamp).getTime();
            const pct = ((evMs - startMs) / rangeMs) * 100;
            if (pct < 0 || pct > 100) return null;
            return (
              <div
                key={ev.id}
                title={ev.type === "violation" ? ev.ruleCode : `${ev.type} ${ev.symbolName ?? ""}`}
                className={`absolute top-1/2 -translate-y-1/2 w-1 h-1 rounded-full ${
                  ev.type === "violation"
                    ? "bg-red-500"
                    : ev.type === "exit"
                      ? "bg-green-400"
                      : "bg-blue-400"
                }`}
                style={{ left: `${pct}%` }}
              />
            );
          })}

        {/* Thumb */}
        {thumbPct != null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-orange-500 border-2 border-background shadow"
            style={{ left: `${thumbPct}%` }}
          />
        )}
      </div>

      {/* End time label */}
      {endMs != null && (
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums shrink-0">
          {formatTime(endMs)}
        </span>
      )}
    </div>
  );
}

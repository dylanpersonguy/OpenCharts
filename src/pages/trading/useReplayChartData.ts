import { useEffect, useMemo } from "react";
import { accountsApi } from "../../services/api/accounts.ts";
import { useReplaySession } from "../../services/queries.ts";
import type { Candle } from "../../services/schemas.ts";
import { useTradingStore } from "../../services/store.tsx";
import { toast } from "../../services/toast.ts";

type ReplaySessionData = Awaited<ReturnType<typeof accountsApi.replayGetSession>>;
type ReplayTradeEvents = ReplaySessionData["tradeEvents"];
type TickBar = ReplaySessionData["tickBuffer"][number];

/** All 1m bars at or before the playback cursor, as chart candles. */
function sliceBufferToCursor(buf: TickBar[], cursorMs: number | null): Candle[] {
  const cutoff = cursorMs ?? buf[0]?.t ?? 0;
  const out: Candle[] = [];
  for (const b of buf) {
    if (b.t > cutoff) break;
    out.push({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });
  }
  return out;
}

function emptySessionReason(data: ReplaySessionData, sessionDate: string): string {
  return data.meta?.primarySymbol
    ? `No 1m candle history stored for ${data.meta.primarySymbol} on ${sessionDate}`
    : `No trading activity found on ${sessionDate}`;
}

/**
 * Bridges a replay session into chart-ready data.
 *
 * - Focuses the chart on the session's primary symbol when replay starts.
 * - Slices the 1m tick buffer up to the playback cursor, so the chart reveals
 *   bars progressively as `useReplayPlayback` advances the cursor.
 * - Detects empty sessions (no trades / no stored candles for that day) and
 *   stops the replay with an explanatory toast instead of silently idling.
 *
 * While `replayCandles` is non-null the caller must suppress the live feed
 * (tick / liveCandle props) so real-time data can't paint over the playback.
 */
export function useReplayChartData(accountId: string | null): {
  replayCandles: Candle[] | null;
  replayTradeEvents: ReplayTradeEvents | undefined;
} {
  const isReplaying = useTradingStore((s) => s.isReplaying);
  const replaySessionDate = useTradingStore((s) => s.replaySessionDate);
  const replayCursorTimestamp = useTradingStore((s) => s.replayCursorTimestamp);
  const setSelectedSymbol = useTradingStore((s) => s.setSelectedSymbol);

  const { data } = useReplaySession(isReplaying ? accountId : null, replaySessionDate);

  // Focus the chart on the replayed symbol once the session loads.
  const replaySymbol = isReplaying ? (data?.meta?.primarySymbol ?? null) : null;
  useEffect(() => {
    if (replaySymbol) setSelectedSymbol(replaySymbol);
  }, [replaySymbol, setSelectedSymbol]);

  // Empty session — no positions that day, or no 1m history stored. Stop and
  // tell the trader why; the old behavior was an idle loop with a frozen HUD.
  useEffect(() => {
    if (!isReplaying || !data || !replaySessionDate || !accountId) return;
    if (data.tickBuffer.length > 0) return;
    toast.warning("Replay unavailable", emptySessionReason(data, replaySessionDate));
    accountsApi.replayStop(accountId, replaySessionDate).catch(() => null);
    useTradingStore.getState().onReplayStateChanged("stopped");
  }, [isReplaying, data, replaySessionDate, accountId]);

  // Progressive reveal: all 1m bars at or before the playback cursor.
  const replayCandles = useMemo<Candle[] | null>(() => {
    if (!isReplaying || !data || data.tickBuffer.length === 0) return null;
    return sliceBufferToCursor(data.tickBuffer, replayCursorTimestamp);
  }, [isReplaying, data, replayCursorTimestamp]);

  return {
    replayCandles,
    replayTradeEvents: isReplaying ? data?.tradeEvents : undefined,
  };
}

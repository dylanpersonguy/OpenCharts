import { useMemo, type ReactNode } from "react";
import type { ReplayController } from "../../services/replay/controller.ts";
import { REPLAY_TIMEFRAMES, type ReplayTimeframe } from "../../services/replay/data/aggregate.ts";
import type { ClosedTrade, ReplayPosition } from "../../services/replay/engine/types.ts";
import { REPLAY_INSTRUMENT_DEFAULTS, REPLAY_SYMBOLS } from "../../services/replay/instruments.ts";
import { drawingsScope } from "../../services/replay/sessions.ts";
import { useReplayStore } from "../../services/replay/store.ts";
import type { Candle } from "../../services/schemas.ts";
import type { TickEntry } from "../../services/store.tsx";
import { toast } from "../../services/toast.ts";
import type { Timeframe } from "../trading/constants.ts";
import type { ReplayBindings, ReplayTradeMarker } from "./types.ts";

const iso = (sec: number) => new Date(sec * 1000).toISOString();

function entryMarker(id: string, symbol: string, side: string, price: number, time: number): ReplayTradeMarker {
  return { id: `${id}:in`, type: "entry", timestamp: iso(time), symbolName: symbol, side: side === "LONG" ? "BUY" : "SELL", price, pnl: null };
}

/** Entry/exit markers for closed trades (one entry per position) plus entries of open positions. */
export function tradeMarkers(closed: readonly ClosedTrade[], open: readonly ReplayPosition[]): ReplayTradeMarker[] {
  const seen = new Set<string>();
  const markers: ReplayTradeMarker[] = [];
  for (const t of closed) {
    if (!seen.has(t.positionId)) {
      seen.add(t.positionId);
      markers.push(entryMarker(t.positionId, t.symbol, t.side, t.entryPrice, t.entryTime));
    }
    markers.push({ id: `${t.id}:out`, type: "exit", timestamp: iso(t.exitTime), symbolName: t.symbol, side: t.side, price: t.exitPrice, pnl: t.netPnl });
  }
  for (const p of open) {
    if (!seen.has(p.id)) markers.push(entryMarker(p.id, p.symbolName, p.side, p.entryPrice, p.entryTime));
  }
  return markers;
}

function isReplayTimeframe(tf: string): tf is ReplayTimeframe {
  return (REPLAY_TIMEFRAMES as readonly string[]).includes(tf);
}

/** Derive TradingPage replay bindings from the replay store. */
export function useReplayBindings(
  controller: ReplayController,
  slots: { controls: ReactNode; nav: ReactNode; journal: ReactNode },
): ReplayBindings | null {
  const session = useReplayStore((s) => s.session);
  const bars = useReplayStore((s) => s.bars);
  const tick = useReplayStore((s) => s.tick);
  const account = useReplayStore((s) => s.account);
  const timeframe = useReplayStore((s) => s.timeframe);
  const viewKey = useReplayStore((s) => s.viewKey);
  const selecting = useReplayStore((s) => s.selectingBar);
  const closedTrades = useReplayStore((s) => s.closedTrades);
  const positions = useReplayStore((s) => s.positions);

  const symbol = session?.symbol;
  const ticks = useMemo<Record<string, TickEntry>>(() => {
    if (!tick || !symbol) return {};
    const digits = REPLAY_INSTRUMENT_DEFAULTS[symbol].digits;
    return { [symbol]: { ...tick, bidFmt: tick.bid.toFixed(digits), askFmt: tick.ask.toFixed(digits) } };
  }, [tick, symbol]);
  const markers = useMemo(() => tradeMarkers(closedTrades, positions), [closedTrades, positions]);

  return useMemo(() => {
    if (!session || !account) return null;
    return {
      sessionId: session.id,
      accountId: session.accountId,
      symbol: session.symbol,
      symbols: REPLAY_SYMBOLS.filter((s) => s.name === session.symbol),
      // Bars are structurally candles; identity is preserved for incremental chart updates.
      candles: bars as Candle[],
      ticks,
      account,
      timeframe,
      timeframes: REPLAY_TIMEFRAMES,
      onTimeframeChange: (tf: Timeframe) => {
        if (isReplayTimeframe(tf)) void controller.setTimeframe(tf);
      },
      tradeMarkers: markers,
      viewKey,
      onChartClick: selecting
        ? (timeSec: number) => {
            controller.setSelectingBar(false);
            void controller.jumpTo(timeSec).then((problem) => {
              if (problem) toast.warning("Can't jump there", problem);
            });
          }
        : undefined,
      drawingsKey: `${drawingsScope(session.id)}${session.symbol}`,
      controls: slots.controls,
      nav: slots.nav,
      journal: slots.journal,
    };
  }, [session, account, bars, ticks, timeframe, markers, viewKey, selecting, controller, slots.controls, slots.nav, slots.journal]);
}

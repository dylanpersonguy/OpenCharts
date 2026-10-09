import type { ClosedTrade, PositionSide } from "./engine/types.ts";
import type { ReplayJournalEntry } from "./session-types.ts";

/**
 * Session performance statistics. Partial closes of one position are merged
 * into a single trade, so counts and win rate are per position.
 */

export interface GroupStats {
  readonly count: number;
  readonly wins: number;
  readonly winRate: number;
  readonly netPnl: number;
  readonly avgR: number | null;
}

export interface EquityPoint {
  /** Unix seconds of the closing fill. */
  readonly time: number;
  readonly equity: number;
}

/** One position's result: all its closed slices combined. */
export interface TradeResult {
  readonly positionId: string;
  readonly side: PositionSide;
  readonly entryTime: number;
  readonly exitTime: number;
  readonly netPnl: number;
  readonly rMultiple: number | null;
}

export interface SessionStats {
  readonly tradeCount: number;
  readonly wins: number;
  readonly losses: number;
  readonly breakeven: number;
  readonly winRate: number;
  readonly grossProfit: number;
  readonly grossLoss: number;
  readonly netPnl: number;
  /** Gross profit / gross loss; Infinity with no losses, null with no trades. */
  readonly profitFactor: number | null;
  readonly avgWin: number;
  readonly avgLoss: number;
  readonly expectancy: number;
  readonly avgR: number | null;
  readonly tradesWithR: number;
  readonly largestWin: number;
  readonly largestLoss: number;
  readonly maxDrawdownAbs: number;
  readonly maxDrawdownPct: number;
  readonly equityCurve: readonly EquityPoint[];
  readonly bySide: Readonly<Record<string, GroupStats>>;
  readonly bySetup: Readonly<Record<string, GroupStats>>;
  readonly byMistake: Readonly<Record<string, GroupStats>>;
}

const UNTAGGED = "Untagged";

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: readonly number[]) => (xs.length === 0 ? 0 : sum(xs) / xs.length);

/** Merge partial-close slices by position, ordered by exit time. */
export function groupTrades(trades: readonly ClosedTrade[]): TradeResult[] {
  const groups = new Map<string, ClosedTrade[]>();
  for (const t of trades) groups.set(t.positionId, [...(groups.get(t.positionId) ?? []), t]);
  return [...groups.values()]
    .map((slices) => {
      const net = sum(slices.map((s) => s.netPnl));
      const withR = slices.filter((s) => s.rMultiple !== null);
      const first = slices[0] as ClosedTrade;
      return {
        positionId: first.positionId,
        side: first.side,
        entryTime: Math.min(...slices.map((s) => s.entryTime)),
        exitTime: Math.max(...slices.map((s) => s.exitTime)),
        netPnl: net,
        rMultiple: withR.length === 0 ? null : sum(withR.map((s) => s.rMultiple as number)),
      };
    })
    .sort((a, b) => a.exitTime - b.exitTime);
}

function groupStats(results: readonly TradeResult[]): GroupStats {
  const wins = results.filter((r) => r.netPnl > 0).length;
  const rs = results.flatMap((r) => (r.rMultiple === null ? [] : [r.rMultiple]));
  return {
    count: results.length,
    wins,
    winRate: results.length === 0 ? 0 : wins / results.length,
    netPnl: sum(results.map((r) => r.netPnl)),
    avgR: rs.length === 0 ? null : mean(rs),
  };
}

function groupBy(
  results: readonly TradeResult[],
  keysOf: (r: TradeResult) => readonly string[],
): Record<string, GroupStats> {
  const buckets = new Map<string, TradeResult[]>();
  for (const r of results) {
    for (const key of keysOf(r)) buckets.set(key, [...(buckets.get(key) ?? []), r]);
  }
  return Object.fromEntries([...buckets].map(([k, rs]) => [k, groupStats(rs)]));
}

function drawdown(results: readonly TradeResult[], startingBalance: number) {
  let equity = startingBalance;
  let peak = startingBalance;
  let maxAbs = 0;
  let maxPct = 0;
  const curve: EquityPoint[] = [];
  for (const r of results) {
    equity += r.netPnl;
    curve.push({ time: r.exitTime, equity });
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    if (dd > maxAbs) {
      maxAbs = dd;
      maxPct = peak > 0 ? dd / peak : 0;
    }
  }
  return { curve, maxAbs, maxPct };
}

/** Compute session statistics from closed trades plus optional journal tags. */
export function computeSessionStats(
  trades: readonly ClosedTrade[],
  startingBalance: number,
  journal: readonly ReplayJournalEntry[] = [],
): SessionStats {
  const results = groupTrades(trades);
  const pnls = results.map((r) => r.netPnl);
  const winners = pnls.filter((p) => p > 0);
  const losers = pnls.filter((p) => p < 0);
  const grossProfit = sum(winners);
  const grossLoss = -sum(losers);
  const rs = results.flatMap((r) => (r.rMultiple === null ? [] : [r.rMultiple]));
  const entryByPosition = new Map(journal.map((j) => [j.positionId, j]));
  const { curve, maxAbs, maxPct } = drawdown(results, startingBalance);

  return {
    tradeCount: results.length,
    wins: winners.length,
    losses: losers.length,
    breakeven: results.length - winners.length - losers.length,
    winRate: results.length === 0 ? 0 : winners.length / results.length,
    grossProfit,
    grossLoss,
    netPnl: sum(pnls),
    profitFactor: results.length === 0 ? null : grossLoss === 0 ? Number.POSITIVE_INFINITY : grossProfit / grossLoss,
    avgWin: mean(winners),
    avgLoss: mean(losers),
    expectancy: mean(pnls),
    avgR: rs.length === 0 ? null : mean(rs),
    tradesWithR: rs.length,
    largestWin: winners.length === 0 ? 0 : Math.max(...winners),
    largestLoss: losers.length === 0 ? 0 : Math.min(...losers),
    maxDrawdownAbs: maxAbs,
    maxDrawdownPct: maxPct,
    equityCurve: curve,
    bySide: groupBy(results, (r) => [r.side]),
    bySetup: groupBy(results, (r) => [entryByPosition.get(r.positionId)?.setup || UNTAGGED]),
    byMistake: groupBy(results, (r) => entryByPosition.get(r.positionId)?.mistakes ?? []),
  };
}

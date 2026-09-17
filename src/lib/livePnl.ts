import type { Position } from "../services/schemas";

export interface LiveTick {
  bid: number;
  ask: number;
  timestamp: number;
}

// Linear scaling: server snapshot (currentPrice, unrealizedPnl) tells us
// PnL-per-price-unit including contract size, side and FX conversion.
// We multiply by the live price delta to get instantaneous PnL between
// REST polls without re-deriving contract math on the client.
export function computeLivePnl(p: Position, tick?: LiveTick): number {
  if (!tick) return p.unrealizedPnl;
  const livePrice = p.side === "LONG" ? tick.bid : tick.ask;
  const snapPrice = p.currentPrice ?? p.entryPrice;
  const snapDelta = snapPrice - p.entryPrice;

  // A position that has not moved since its snapshot (a fresh fill, or a
  // flat tick) carries no scale factor to derive — dividing by ~0 would blow
  // up, and returning the snapshot froze P&L at 0 until the next REST poll.
  // Fall back to the position's own contract maths, which is exact whenever
  // the account and the instrument share a currency.
  if (Math.abs(snapDelta) < 1e-12) {
    const contractSize = p.contractSize ?? 1;
    const direction = p.side === "LONG" ? 1 : -1;
    return (livePrice - p.entryPrice) * p.quantity * contractSize * direction;
  }

  const perPriceUnit = p.unrealizedPnl / snapDelta;
  return perPriceUnit * (livePrice - p.entryPrice);
}

export function computeLivePrice(p: Position, tick?: LiveTick): number {
  if (!tick) return p.currentPrice ?? p.entryPrice;
  return p.side === "LONG" ? tick.bid : tick.ask;
}

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
  if (Math.abs(snapDelta) < 1e-12) return p.unrealizedPnl;
  const perPriceUnit = p.unrealizedPnl / snapDelta;
  return perPriceUnit * (livePrice - p.entryPrice);
}

export function computeLivePrice(p: Position, tick?: LiveTick): number {
  if (!tick) return p.currentPrice ?? p.entryPrice;
  return p.side === "LONG" ? tick.bid : tick.ask;
}

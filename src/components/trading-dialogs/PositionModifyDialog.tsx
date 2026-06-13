import { useState, useEffect } from "react";
import { api } from "../../services/api";
import { toast } from "../../services/toast";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useInstrumentLabels } from "../../hooks/useInstrumentLabels.ts";
import {
  X,
  TrendingUp,
  TrendingDown,
  Shield,
  SlidersHorizontal,
  Target,
  ArrowLeftRight,
  WifiOff,
} from "lucide-react";

interface Position {
  id: string;
  symbolName: string;
  side: string;
  quantity: number;
  entryPrice: number;
  currentPrice?: number;
  unrealizedPnl?: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  openedAt: string;
  /** Units per contract/lot. Defaults to 100000 (forex) when not provided. */
  contractSize?: number;
}

interface PositionModifyDialogProps {
  position: Position | null;
  onClose: () => void;
  onSaved: () => void;
  tick?: { bid: number; ask: number };
  isFeedConnected?: boolean;
}

export function PositionModifyDialog({
  position,
  onClose,
  onSaved,
  tick,
  isFeedConnected = true,
}: PositionModifyDialogProps) {
  const { formatQty, unitLabel, isFutures, instrumentType } = useInstrumentLabels();
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [partialQty, setPartialQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"modify" | "partial">("modify");

  // BUG-62 FIX: Reinitialize form fields when the selected position changes.
  // Previously used useState() callback which only runs on initial mount,
  // meaning switching positions kept stale TP/SL values.
  useEffect(() => {
    if (position) {
      setTp(position.takeProfit != null ? String(position.takeProfit) : "");
      setSl(position.stopLoss != null ? String(position.stopLoss) : "");
      setPartialQty("");
    }
  }, [position]);

  if (!position) return null;

  const currentPrice = tick
    ? position.side === "LONG"
      ? tick.bid
      : tick.ask
    : position.currentPrice || position.entryPrice;

  const pnlPerUnit =
    position.side === "LONG"
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;

  const handleModify = async () => {
    if (!isFeedConnected) {
      toast.error("No Data Feed", "Cannot modify positions while disconnected from the data feed");
      return;
    }
    const mods: { takeProfit?: number | null; stopLoss?: number | null } = {};
    // Empty string means "remove this level". Non-empty means "set to this value".
    // We only send the field if it actually changed from the persisted value.
    if (tp === "" && position.takeProfit != null) {
      mods.takeProfit = null; // removal
    } else if (tp !== "" && parseFloat(tp) !== position.takeProfit) {
      mods.takeProfit = parseFloat(tp);
    }
    if (sl === "" && position.stopLoss != null) {
      mods.stopLoss = null; // removal
    } else if (sl !== "" && parseFloat(sl) !== position.stopLoss) {
      mods.stopLoss = parseFloat(sl);
    }
    if (Object.keys(mods).length === 0) {
      toast.info("No Changes", "No modifications to apply");
      return;
    }
    setSaving(true);
    try {
      await api.modifyPosition(position.id, mods);
      toast.success("Position Modified", "TP/SL updated successfully");
      onSaved();
      onClose();
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (e?.code === "REQUEST_TIMEOUT") {
        toast.error(
          "Request Timed Out",
          "The server didn't respond in time. Check your connection and try again.",
        );
      } else {
        toast.error("Modify Failed", e.message || "Could not modify position");
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePartialClose = async () => {
    if (!isFeedConnected) {
      toast.error("No Data Feed", "Cannot close positions while disconnected from the data feed");
      return;
    }
    const qty = parseFloat(partialQty);
    if (isNaN(qty) || qty <= 0 || qty > position.quantity) {
      toast.warning("Invalid Quantity", `Enter a value between 0.01 and ${position.quantity}`);
      return;
    }
    setSaving(true);
    try {
      await api.closePosition(position.id, qty);
      toast.success("Partial Close", `Closed ${formatQty(qty)} of ${formatQty(position.quantity)}`);
      onSaved();
      onClose();
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (e?.code === "REQUEST_TIMEOUT") {
        toast.error(
          "Request Timed Out",
          "The server didn't respond in time. Check your connection and try again.",
        );
      } else {
        toast.error("Close Failed", e.message || "Could not partially close position");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSetBreakeven = () => {
    setSl(String(position.entryPrice));
    toast.info("Breakeven", "Stop Loss set to entry price — click Save to apply");
  };

  // Risk/reward calculation
  const tpVal = parseFloat(tp);
  const slVal = parseFloat(sl);
  const riskReward =
    !isNaN(tpVal) && !isNaN(slVal) && slVal !== position.entryPrice
      ? Math.abs((tpVal - position.entryPrice) / (position.entryPrice - slVal))
      : null;

  // Estimated P&L at TP/SL — use per-instrument contractSize if available.
  const contractSize = position.contractSize ?? 100000;
  const tpPnl = !isNaN(tpVal)
    ? (position.side === "LONG" ? tpVal - position.entryPrice : position.entryPrice - tpVal) *
      position.quantity *
      contractSize
    : null;
  const slPnl = !isNaN(slVal)
    ? (position.side === "LONG" ? slVal - position.entryPrice : position.entryPrice - slVal) *
      position.quantity *
      contractSize
    : null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl shadow-black/40 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 bg-secondary/50">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "p-1.5 rounded-lg",
                  position.side === "LONG" ? "bg-buy/15 text-buy" : "bg-sell/15 text-sell",
                )}
              >
                {position.side === "LONG" ? (
                  <TrendingUp className="h-4 w-4" />
                ) : (
                  <TrendingDown className="h-4 w-4" />
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold">Modify {position.symbolName}</h3>
                <p className="text-[10px] text-muted-foreground">
                  {position.side} {position.quantity} @ {formatNumber(position.entryPrice, 5)}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Current Status */}
          <div className="px-5 py-3 grid grid-cols-3 gap-3 border-b border-border/40 text-center">
            <div>
              <div className="text-[10px] text-muted-foreground">Current</div>
              <div className="text-sm font-mono font-semibold">{formatNumber(currentPrice, 5)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">P&L</div>
              <div
                className={cn(
                  "text-sm font-mono font-semibold",
                  (position.unrealizedPnl || 0) >= 0 ? "text-buy" : "text-sell",
                )}
              >
                {(position.unrealizedPnl || 0) >= 0 ? "+" : ""}
                {formatCurrency(position.unrealizedPnl || 0)}
              </div>
            </div>
            {instrumentType === "FOREX" && (
              <div>
                <div className="text-[10px] text-muted-foreground">Pips</div>
                <div
                  className={cn(
                    "text-sm font-mono font-semibold",
                    pnlPerUnit >= 0 ? "text-buy" : "text-sell",
                  )}
                >
                  {(pnlPerUnit * 10000).toFixed(1)}
                </div>
              </div>
            )}
          </div>

          {/* Disconnected warning */}
          {!isFeedConnected && (
            <div className="mx-5 mt-3 bg-destructive/10 border border-destructive/30 rounded px-3 py-2 text-center">
              <div className="flex items-center justify-center gap-1.5 text-destructive text-xs font-semibold">
                <WifiOff className="h-3.5 w-3.5" />
                Data Feed Disconnected
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Modifications disabled until connection is restored
              </p>
            </div>
          )}

          {/* Tabs */}
          <div className="flex border-b border-border/40">
            <button
              className={cn(
                "flex-1 py-2 text-xs font-medium",
                activeTab === "modify"
                  ? "text-accent border-b-2 border-accent"
                  : "text-muted-foreground",
              )}
              onClick={() => setActiveTab("modify")}
            >
              <SlidersHorizontal className="h-3 w-3 inline mr-1" /> Modify TP/SL
            </button>
            <button
              className={cn(
                "flex-1 py-2 text-xs font-medium",
                activeTab === "partial"
                  ? "text-accent border-b-2 border-accent"
                  : "text-muted-foreground",
              )}
              onClick={() => setActiveTab("partial")}
            >
              <ArrowLeftRight className="h-3 w-3 inline mr-1" /> Partial Close
            </button>
          </div>

          {/* Content */}
          <div className="px-5 py-4 space-y-3">
            {activeTab === "modify" && (
              <>
                {/* Take Profit */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <Target className="h-3 w-3 text-buy" /> Take Profit
                    </label>
                    {tpPnl !== null && (
                      <span
                        className={cn(
                          "text-[10px] font-mono",
                          tpPnl >= 0 ? "text-buy" : "text-sell",
                        )}
                      >
                        Est: {tpPnl >= 0 ? "+" : ""}
                        {formatCurrency(tpPnl)}
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    value={tp}
                    onChange={(e) => setTp(e.target.value)}
                    placeholder={position.takeProfit ? String(position.takeProfit) : "Not set"}
                    className="w-full text-sm font-mono"
                    step="0.00001"
                  />
                  {tp && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[10px] h-5 mt-1 text-muted-foreground"
                      onClick={() => setTp("")}
                    >
                      Remove TP
                    </Button>
                  )}
                </div>

                {/* Stop Loss */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <Shield className="h-3 w-3 text-sell" /> Stop Loss
                    </label>
                    {slPnl !== null && (
                      <span
                        className={cn(
                          "text-[10px] font-mono",
                          slPnl >= 0 ? "text-buy" : "text-sell",
                        )}
                      >
                        Est: {slPnl >= 0 ? "+" : ""}
                        {formatCurrency(slPnl)}
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    value={sl}
                    onChange={(e) => setSl(e.target.value)}
                    placeholder={position.stopLoss ? String(position.stopLoss) : "Not set"}
                    className="w-full text-sm font-mono"
                    step="0.00001"
                  />
                  <div className="flex gap-1 mt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[10px] h-5 text-muted-foreground"
                      onClick={handleSetBreakeven}
                    >
                      Breakeven ({formatNumber(position.entryPrice, 5)})
                    </Button>
                    {sl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-[10px] h-5 text-muted-foreground"
                        onClick={() => setSl("")}
                      >
                        Remove SL
                      </Button>
                    )}
                  </div>
                </div>

                {/* Risk/Reward */}
                {riskReward !== null && (
                  <div className="bg-secondary/50 rounded-lg p-2 text-center">
                    <span className="text-[10px] text-muted-foreground">Risk:Reward</span>
                    <span
                      className={cn(
                        "text-sm font-mono font-semibold ml-2",
                        riskReward >= 2
                          ? "text-buy"
                          : riskReward >= 1
                            ? "text-foreground"
                            : "text-sell",
                      )}
                    >
                      1:{riskReward.toFixed(2)}
                    </span>
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={handleModify}
                  disabled={saving || !isFeedConnected}
                  loading={saving}
                >
                  {saving ? "Saving..." : !isFeedConnected ? "Disconnected" : "Save Changes"}
                </Button>
              </>
            )}

            {activeTab === "partial" && (
              <>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Close Volume ({unitLabel})
                  </label>
                  <input
                    type="number"
                    value={partialQty}
                    onChange={(e) => setPartialQty(e.target.value)}
                    placeholder={`Max: ${position.quantity}`}
                    className="w-full mt-1 text-sm font-mono"
                    step={isFutures ? "1" : "0.01"}
                    min={isFutures ? "1" : "0.01"}
                    max={position.quantity}
                  />
                </div>

                {/* Quick partial close buttons */}
                <div className="grid grid-cols-4 gap-1">
                  {[25, 50, 75, 100].map((pct) => {
                    const rawAmt = (position.quantity * pct) / 100;
                    // For futures: snap to nearest integer, at least 1, at most position.quantity.
                    const amt = isFutures
                      ? Math.min(position.quantity, Math.max(1, Math.round(rawAmt)))
                      : rawAmt;
                    return (
                      <button
                        key={pct}
                        onClick={() => setPartialQty(isFutures ? String(amt) : amt.toFixed(2))}
                        className={cn(
                          "text-[10px] py-1.5 rounded border border-border transition-colors",
                          parseFloat(partialQty) === amt
                            ? "bg-accent/15 text-accent border-accent/30"
                            : "hover:bg-secondary",
                        )}
                      >
                        {pct}%
                        <div className="text-[9px] text-muted-foreground">
                          {isFutures ? amt : amt.toFixed(2)}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={handlePartialClose}
                  disabled={saving || !partialQty || !isFeedConnected}
                  loading={saving}
                >
                  {saving
                    ? "Closing..."
                    : !isFeedConnected
                      ? "Disconnected"
                      : `Close ${partialQty || "?"} ${unitLabel}`}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Order Confirmation Dialog (#7) ──────────────────────────

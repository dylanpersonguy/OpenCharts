import { useState } from "react";
import { X, Scissors } from "lucide-react";
import { formatNumber, formatCurrency, formatDate, cn, pnlClass } from "../../lib/utils.ts";

interface PositionRow {
  id: string;
  symbolName: string;
  side: "LONG" | "SHORT" | string;
  quantity: number;
  entryPrice: number;
  currentPrice?: number | null;
  unrealizedPnl: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  openedAt: string | Date;
}

export function PositionsTable({
  positions,
  onClose,
  onModify,
  onPartialClose,
  onSelectSymbol,
}: {
  positions: PositionRow[];
  onClose: (id: string) => void;
  onModify?: (p: PositionRow) => void;
  onPartialClose?: (id: string, quantity: number) => void;
  onSelectSymbol?: (symbolName: string) => void;
}) {
  const [partialCloseId, setPartialCloseId] = useState<string | null>(null);
  const [partialQty, setPartialQty] = useState("");

  if (positions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
        No open positions
      </div>
    );
  }

  const handlePartialSubmit = (positionId: string, maxQty: number) => {
    const qty = parseFloat(partialQty);
    if (!qty || qty <= 0 || qty >= maxQty) return;
    onPartialClose?.(positionId, qty);
    setPartialCloseId(null);
    setPartialQty("");
  };

  return (
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 bg-card z-10">
        <tr>
          <th>Symbol</th>
          <th>Side</th>
          <th>Qty</th>
          <th>Entry</th>
          <th>Current</th>
          <th>P&L</th>
          <th>SL</th>
          <th>TP</th>
          <th>Time</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <tr
            key={p.id}
            className={cn("hover:bg-secondary/30", onSelectSymbol ? "cursor-pointer" : undefined)}
            onClick={() => onSelectSymbol?.(p.symbolName)}
            onKeyDown={(e) => {
              if (!onSelectSymbol) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectSymbol(p.symbolName);
              }
            }}
            tabIndex={onSelectSymbol ? 0 : undefined}
          >
            <td className="font-semibold">{p.symbolName}</td>
            <td className={p.side === "LONG" ? "text-buy" : "text-sell"}>{p.side}</td>
            <td className="font-mono">{p.quantity}</td>
            <td className="font-mono">{formatNumber(p.entryPrice, 5)}</td>
            <td className="font-mono">{p.currentPrice ? formatNumber(p.currentPrice, 5) : "--"}</td>
            <td className={cn("font-mono font-semibold", pnlClass(p.unrealizedPnl))}>
              {p.unrealizedPnl >= 0 ? "+" : ""}
              {formatCurrency(p.unrealizedPnl)}
            </td>
            <td className="font-mono text-sell">
              {p.stopLoss ? formatNumber(p.stopLoss, 5) : "--"}
            </td>
            <td className="font-mono text-buy">
              {p.takeProfit ? formatNumber(p.takeProfit, 5) : "--"}
            </td>
            <td className="text-muted-foreground">{formatDate(p.openedAt)}</td>
            <td>
              {partialCloseId === p.id ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={partialQty}
                    onChange={(e) => setPartialQty(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={`Max ${p.quantity}`}
                    min={0.01}
                    max={p.quantity - 0.01}
                    step="any"
                    className="w-16 h-5 text-[10px] rounded border border-border bg-background px-1 font-mono"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handlePartialSubmit(p.id, p.quantity);
                      if (e.key === "Escape") {
                        setPartialCloseId(null);
                        setPartialQty("");
                      }
                    }}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePartialSubmit(p.id, p.quantity);
                    }}
                    className="px-1 py-0.5 text-[9px] rounded bg-warning/20 text-warning hover:bg-warning/30"
                  >
                    Go
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPartialCloseId(null);
                      setPartialQty("");
                    }}
                    className="px-1 py-0.5 text-[9px] rounded bg-secondary text-muted-foreground hover:bg-secondary/80"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-1">
                  {onModify && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onModify(p);
                      }}
                      className="px-1.5 py-0.5 text-[10px] rounded bg-accent/20 text-accent hover:bg-accent/30"
                    >
                      Modify
                    </button>
                  )}
                  {onPartialClose && p.quantity > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPartialCloseId(p.id);
                        setPartialQty("");
                      }}
                      className="px-1.5 py-0.5 text-[10px] rounded bg-warning/20 text-warning hover:bg-warning/30 flex items-center gap-0.5"
                      title="Partial Close"
                    >
                      <Scissors className="h-2.5 w-2.5" /> Partial
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(p.id);
                    }}
                    className="px-1.5 py-0.5 text-[10px] rounded bg-destructive/20 text-destructive hover:bg-destructive/30"
                  >
                    Close
                  </button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

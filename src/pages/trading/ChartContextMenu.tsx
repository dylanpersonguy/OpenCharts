import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  ClipboardCopy,
  ListTree,
  RotateCcw,
  Settings,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils.ts";

// ── Chart context menu (TradingView-style right-click menu) ──────────────────
// Rendered by ChartPanel at the cursor position when the user right-clicks
// empty chart space (right-clicks on a drawing open the drawing menu instead).

export interface ChartContextMenuProps {
  x: number;
  y: number;
  /** Price under the cursor (null when the click landed off the price scale). */
  price: number | null;
  pipDigits: number;
  symbol: string;
  tick?: { bid: number; ask: number };
  drawingsCount: number;
  indicatorsCount: number;
  onClose: () => void;
  onResetView: () => void;
  onCopyPrice: (price: number) => void;
  onAddAlert?: (price: number) => void;
  onQuickOrder?: (side: "BUY" | "SELL", type: "LIMIT" | "STOP", price: number) => void;
  onOpenObjectTree: () => void;
  onRemoveAllDrawings?: () => void;
  onClearIndicators?: () => void;
  onOpenSettings: () => void;
}

function MenuItem({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors",
        danger ? "text-red-400 hover:bg-red-500/10" : "text-foreground hover:bg-secondary",
      )}
    >
      <span className="flex h-3.5 w-3.5 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

function Separator() {
  return <div className="my-1 border-t border-border" />;
}

/** A resting order below the ask buys cheaper (limit); above it is a breakout stop. */
function buyOrderType(price: number, ask: number): "LIMIT" | "STOP" {
  return price <= ask ? "LIMIT" : "STOP";
}

/** A resting order above the bid sells dearer (limit); below it is a breakdown stop. */
function sellOrderType(price: number, bid: number): "LIMIT" | "STOP" {
  return price >= bid ? "LIMIT" : "STOP";
}

function TradeSection({
  price,
  pipDigits,
  symbol,
  tick,
  onQuickOrder,
  onAddAlert,
  onClose,
}: Pick<
  ChartContextMenuProps,
  "pipDigits" | "symbol" | "tick" | "onQuickOrder" | "onAddAlert" | "onClose"
> & { price: number }) {
  const p = price.toFixed(pipDigits);
  return (
    <>
      {onAddAlert && (
        <MenuItem
          icon={<Bell className="h-3.5 w-3.5" />}
          label={`Add alert on ${symbol} at ${p}`}
          onClick={() => {
            onAddAlert(price);
            onClose();
          }}
        />
      )}
      {onQuickOrder && tick && (
        <>
          <MenuItem
            icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
            label={`Buy 1 ${symbol} @ ${p} ${buyOrderType(price, tick.ask).toLowerCase()}`}
            onClick={() => {
              onQuickOrder("BUY", buyOrderType(price, tick.ask), price);
              onClose();
            }}
          />
          <MenuItem
            icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
            label={`Sell 1 ${symbol} @ ${p} ${sellOrderType(price, tick.bid).toLowerCase()}`}
            onClick={() => {
              onQuickOrder("SELL", sellOrderType(price, tick.bid), price);
              onClose();
            }}
          />
        </>
      )}
    </>
  );
}

export function ChartContextMenu(props: ChartContextMenuProps) {
  const {
    x,
    y,
    price,
    pipDigits,
    drawingsCount,
    indicatorsCount,
    onClose,
    onResetView,
    onCopyPrice,
    onOpenObjectTree,
    onRemoveAllDrawings,
    onClearIndicators,
    onOpenSettings,
  } = props;

  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp into the viewport once the real menu size is known.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - rect.width - 8),
      y: Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* click-away backdrop (also swallows the next right-click) */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        style={{ left: pos.x, top: pos.y }}
        className="fixed z-50 min-w-[230px] rounded-lg border border-border bg-card/95 py-1 shadow-2xl backdrop-blur-xl"
      >
        <MenuItem
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          label="Reset chart view"
          onClick={() => {
            onResetView();
            onClose();
          }}
        />
        {price != null && (
          <>
            <Separator />
            <MenuItem
              icon={<ClipboardCopy className="h-3.5 w-3.5" />}
              label={`Copy price ${price.toFixed(pipDigits)}`}
              onClick={() => {
                onCopyPrice(price);
                onClose();
              }}
            />
            <Separator />
            <TradeSection {...props} price={price} />
          </>
        )}
        <Separator />
        <MenuItem
          icon={<ListTree className="h-3.5 w-3.5" />}
          label="Object tree"
          onClick={() => {
            onOpenObjectTree();
            onClose();
          }}
        />
        {(drawingsCount > 0 || indicatorsCount > 0) && <Separator />}
        {drawingsCount > 0 && onRemoveAllDrawings && (
          <MenuItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={`Remove ${drawingsCount} drawing${drawingsCount === 1 ? "" : "s"}`}
            danger
            onClick={() => {
              onRemoveAllDrawings();
              onClose();
            }}
          />
        )}
        {indicatorsCount > 0 && onClearIndicators && (
          <MenuItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={`Remove ${indicatorsCount} indicator${indicatorsCount === 1 ? "" : "s"}`}
            danger
            onClick={() => {
              onClearIndicators();
              onClose();
            }}
          />
        )}
        <Separator />
        <MenuItem
          icon={<Settings className="h-3.5 w-3.5" />}
          label="Chart Settings…"
          onClick={() => {
            onOpenSettings();
            onClose();
          }}
        />
      </div>
    </>
  );
}

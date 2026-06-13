import {
  ArrowDownToLine,
  ArrowUpToLine,
  Eye,
  EyeOff,
  Layers,
  Lock,
  LockOpen,
  type LucideIcon,
  Minus,
  Square,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils.ts";
import type { DrawingLine } from "./constants.ts";

const TYPE_META: Record<string, { icon: LucideIcon; label: string }> = {
  trendline: { icon: TrendingUp, label: "Trendline" },
  horizontal: { icon: Minus, label: "Horizontal" },
  fibonacci: { icon: Layers, label: "Fibonacci" },
  rectangle: { icon: Square, label: "Rectangle" },
  position: { icon: TrendingUp, label: "Position" },
};

export interface ObjectTreePanelProps {
  drawings: DrawingLine[];
  selectedIds: string[];
  pipDigits: number;
  currentTf: string;
  onSelect: (d: DrawingLine) => void;
  onUpdate: (d: DrawingLine) => void;
  onRemove: (id: string) => void;
  onReorder: (d: DrawingLine, dir: "front" | "back") => void;
  onClose: () => void;
}

function RowIconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
    >
      {children}
    </button>
  );
}

function ObjectTreeRow({
  d,
  selected,
  pipDigits,
  currentTf,
  onSelect,
  onUpdate,
  onRemove,
  onReorder,
}: {
  d: DrawingLine;
  selected: boolean;
  pipDigits: number;
  currentTf: string;
  onSelect: (d: DrawingLine) => void;
  onUpdate: (d: DrawingLine) => void;
  onRemove: (id: string) => void;
  onReorder: (d: DrawingLine, dir: "front" | "back") => void;
}) {
  const meta = TYPE_META[d.type] ?? { icon: Minus, label: d.type };
  const Icon = meta.icon;
  const tfOnly = d.visibility === "tf" && d.createdTf !== currentTf;
  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 px-2 py-1 rounded text-xs",
        selected ? "bg-primary/15" : "hover:bg-secondary",
        (d.hidden || tfOnly) && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(d)}
        className="flex flex-1 min-w-0 items-center gap-1.5 text-left"
      >
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">
          {meta.label} {d.price.toFixed(pipDigits)}
          {tfOnly && <span className="ml-1 text-[9px] text-muted-foreground">({d.createdTf})</span>}
        </span>
      </button>
      <div className="hidden group-hover:flex items-center">
        <RowIconButton title="Bring to front" onClick={() => onReorder(d, "front")}>
          <ArrowUpToLine className="h-3 w-3" />
        </RowIconButton>
        <RowIconButton title="Send to back" onClick={() => onReorder(d, "back")}>
          <ArrowDownToLine className="h-3 w-3" />
        </RowIconButton>
      </div>
      <RowIconButton
        title={d.hidden ? "Show" : "Hide"}
        onClick={() => onUpdate({ ...d, hidden: !d.hidden })}
      >
        {d.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </RowIconButton>
      <RowIconButton
        title={d.locked ? "Unlock" : "Lock"}
        onClick={() => onUpdate({ ...d, locked: !d.locked })}
      >
        {d.locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
      </RowIconButton>
      <RowIconButton title="Delete" onClick={() => onRemove(d.id)}>
        <Trash2 className="h-3 w-3" />
      </RowIconButton>
    </div>
  );
}

/** TradingView-style object tree: every drawing on the symbol, managed per row. */
export function ObjectTreePanel({
  drawings,
  selectedIds,
  pipDigits,
  currentTf,
  onSelect,
  onUpdate,
  onRemove,
  onReorder,
  onClose,
}: ObjectTreePanelProps) {
  return (
    <div className="absolute top-2 right-2 bottom-10 z-20 w-60 flex flex-col rounded-lg bg-card border border-border shadow-xl">
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border">
        <span className="text-xs font-semibold">Objects ({drawings.length})</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-secondary text-muted-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
        {drawings.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">No drawings yet</div>
        ) : (
          [...drawings]
            .reverse()
            .map((d) => (
              <ObjectTreeRow
                key={d.id}
                d={d}
                selected={selectedIds.includes(d.id)}
                pipDigits={pipDigits}
                currentTf={currentTf}
                onSelect={onSelect}
                onUpdate={onUpdate}
                onRemove={onRemove}
                onReorder={onReorder}
              />
            ))
        )}
      </div>
    </div>
  );
}

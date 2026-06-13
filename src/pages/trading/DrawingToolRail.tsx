import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Circle,
  Equal,
  EyeOff,
  GripVertical,
  Layers,
  Layers3,
  type LucideIcon,
  Minus,
  MousePointer2,
  MoveUpRight,
  MoveVertical,
  PenTool,
  Ruler,
  Spline,
  Square,
  TrendingUp,
  Triangle,
  Type,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDragOffset } from "../../hooks/useDragOffset.ts";
import { cn } from "../../lib/utils.ts";
import type { DrawingTool } from "./constants.ts";

interface ToolMeta {
  tool: DrawingTool;
  icon: LucideIcon;
  label: string;
}

interface ToolGroup {
  id: string;
  icon: LucideIcon;
  label: string;
  tools: ToolMeta[];
}

// TradingView-style left rail: tools grouped behind a flyout per category.
const GROUPS: ToolGroup[] = [
  {
    id: "lines",
    icon: TrendingUp,
    label: "Lines",
    tools: [
      { tool: "trendline", icon: TrendingUp, label: "Trend Line" },
      { tool: "ray", icon: MoveUpRight, label: "Ray" },
      { tool: "extended", icon: Spline, label: "Extended Line" },
      { tool: "horizontal", icon: Minus, label: "Horizontal Line" },
      { tool: "vertical", icon: MoveVertical, label: "Vertical Line" },
      { tool: "channel", icon: Equal, label: "Parallel Channel" },
    ],
  },
  {
    id: "fib",
    icon: Layers,
    label: "Fibonacci",
    tools: [
      { tool: "fibonacci", icon: Layers, label: "Fib Retracement" },
      { tool: "fibextension", icon: Layers3, label: "Fib Extension" },
    ],
  },
  {
    id: "shapes",
    icon: Square,
    label: "Shapes",
    tools: [
      { tool: "rectangle", icon: Square, label: "Rectangle" },
      { tool: "ellipse", icon: Circle, label: "Ellipse" },
      { tool: "triangle", icon: Triangle, label: "Triangle" },
      { tool: "arrow", icon: ArrowRight, label: "Arrow" },
    ],
  },
  {
    id: "trade",
    icon: ArrowUpRight,
    label: "Trade",
    tools: [
      { tool: "long-position", icon: ArrowUpRight, label: "Long Position" },
      { tool: "short-position", icon: ArrowDownRight, label: "Short Position" },
      { tool: "measure", icon: Ruler, label: "Measure" },
    ],
  },
  { id: "text", icon: Type, label: "Text", tools: [{ tool: "text", icon: Type, label: "Text" }] },
];

function RailButton({
  icon: Icon,
  title,
  active,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "p-1.5 rounded hover:bg-secondary",
        active ? "bg-primary/20 text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function RailGroup({
  group,
  activeTool,
  open,
  onToggle,
  onSelect,
}: {
  group: ToolGroup;
  activeTool: DrawingTool;
  open: boolean;
  onToggle: () => void;
  onSelect: (t: DrawingTool) => void;
}) {
  const activeMeta = group.tools.find((t) => t.tool === activeTool);
  const Icon = activeMeta?.icon ?? group.icon;
  return (
    <div className="relative">
      <RailButton icon={Icon} title={group.label} active={Boolean(activeMeta)} onClick={onToggle} />
      {open && (
        <div className="absolute left-full top-0 ml-1 z-30 min-w-[180px] rounded-md bg-card border border-border shadow-xl py-1">
          {group.tools.map((t) => (
            <button
              key={t.tool}
              type="button"
              onClick={() => onSelect(t.tool)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-secondary text-left",
                activeTool === t.tool && "bg-secondary text-primary",
              )}
            >
              <t.icon className="h-3.5 w-3.5 shrink-0" />
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DrawingToolRail({
  drawingTool,
  onDrawingTool,
}: {
  drawingTool: DrawingTool;
  onDrawingTool: (t: DrawingTool) => void;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useDragOffset();

  useEffect(() => {
    if (!openGroup) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenGroup(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openGroup]);

  const select = (t: DrawingTool) => {
    onDrawingTool(drawingTool === t ? "none" : t);
    setOpenGroup(null);
  };

  const hide = () => {
    setOpenGroup(null);
    setHidden(true);
  };

  // Collapsed: a small restorable button where the rail was last positioned.
  if (hidden) {
    return (
      <button
        type="button"
        title="Show drawing tools"
        onClick={() => setHidden(false)}
        style={drag.style}
        className="absolute left-1 top-1 z-20 rounded-md border border-border bg-card/90 p-1.5 text-muted-foreground backdrop-blur-sm hover:text-primary"
      >
        <PenTool className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div
      ref={ref}
      style={drag.style}
      className="absolute left-1 top-1 z-20 flex flex-col items-center gap-0.5 rounded-md bg-card/90 border border-border p-0.5 backdrop-blur-sm"
    >
      <div
        onPointerDown={drag.onPointerDown}
        title="Drag to move"
        className="flex w-full cursor-move justify-center py-0.5 text-muted-foreground/50 hover:text-muted-foreground"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </div>
      <RailButton
        icon={MousePointer2}
        title="Cursor"
        active={drawingTool === "none"}
        onClick={() => {
          onDrawingTool("none");
          setOpenGroup(null);
        }}
      />
      {GROUPS.map((g) => (
        <RailGroup
          key={g.id}
          group={g}
          activeTool={drawingTool}
          open={openGroup === g.id}
          onToggle={() => setOpenGroup((o) => (o === g.id ? null : g.id))}
          onSelect={select}
        />
      ))}
      <div className="my-0.5 w-full border-t border-border/50" />
      <RailButton icon={EyeOff} title="Hide toolbar" onClick={hide} />
    </div>
  );
}

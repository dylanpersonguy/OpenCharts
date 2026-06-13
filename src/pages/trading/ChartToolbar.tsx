import {
  Activity,
  AlignCenter,
  ArrowDownRight,
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  BarChart3,
  Bot,
  CalendarDays,
  ChevronDown,
  Circle,
  Clock,
  Crosshair,
  Equal,
  Info,
  Layers,
  Layers3,
  type LucideIcon,
  Magnet,
  Maximize2,
  Minus,
  MoveUpRight,
  MoveVertical,
  Newspaper,
  Pencil,
  Repeat,
  Ruler,
  Search,
  SlidersHorizontal,
  Spline,
  Square,
  Star,
  Trash2,
  TrendingUp,
  Triangle,
  Type,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { INDICATOR_REGISTRY, type IndicatorType } from "../../lib/indicators.ts";
import { cn, formatNumber } from "../../lib/utils.ts";
import {
  type DrawingLine,
  type DrawingTool,
  type MagnetMode,
  REPLAY_ENABLED,
  TIMEFRAMES,
  type Timeframe,
} from "./constants.ts";
import { ChartTemplatesMenu } from "./ChartTemplatesMenu.tsx";
import { ReplayHUD } from "./ReplayHUD.tsx";
import { getPipDigits } from "./utils.ts";

export interface ChartToolbarProps {
  selectedSymbol: string;
  symbols: Array<{
    id?: string;
    name: string;
    displayName?: string | null;
    assetClass?: string;
    baseCurrency?: string;
    quoteCurrency?: string;
    category?: string;
    isActive?: boolean;
  }>;
  onSymbolChange: (s: string) => void;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  activeIndicators: IndicatorType[];
  onToggleIndicator: (type: IndicatorType) => void;
  showIndicatorMenu: boolean;
  onToggleIndicatorMenu: () => void;
  drawingTool: DrawingTool;
  onDrawingTool: (t: DrawingTool) => void;
  drawings: DrawingLine[];
  onClearDrawings: () => void;
  rightPanel: string;
  onRightPanel: (p: "order" | "dom" | "watchlist" | "news" | "ai-trader" | "tv-analysis") => void;
  aiTraderEnabled?: boolean;
  showRightPanel: boolean;
  onToggleRightPanel: () => void;
  tick?: { bid: number; ask: number; timestamp: number };
  symbolInfo?: {
    tickSize?: number;
    pipSize?: number;
    lotSize?: number;
    minLot?: number;
    maxLot?: number;
    lotStep?: number;
    contractSize?: number;
    marginPercent?: number;
    commission?: number;
  };
  isReplaying?: boolean;
  /** Account whose sessions can be replayed — mounts the replay HUD when set. */
  replayAccountId?: string | null;
  activePlugins?: string[];
  onTogglePlugin?: (id: string) => void;
  /** Replace the full indicator list (template load). Enables the templates menu. */
  onSetIndicators?: (indicators: IndicatorType[]) => void;
  /** Replace the full plugin list (template load). Enables the templates menu. */
  onSetPlugins?: (ids: string[]) => void;
  magnetMode?: MagnetMode;
  onCycleMagnet?: () => void;
  stayInDrawingMode?: boolean;
  onToggleStayInDrawingMode?: () => void;
}

export function ChartToolbar({
  selectedSymbol,
  symbols,
  onSymbolChange,
  timeframe,
  onTimeframeChange,
  activeIndicators,
  onToggleIndicator,
  showIndicatorMenu,
  onToggleIndicatorMenu,
  drawingTool,
  onDrawingTool,
  drawings,
  onClearDrawings,
  rightPanel,
  onRightPanel,
  showRightPanel,
  onToggleRightPanel,
  tick,
  symbolInfo,
  aiTraderEnabled,
  isReplaying = false,
  replayAccountId,
  activePlugins = [],
  onTogglePlugin,
  onSetIndicators,
  onSetPlugins,
  magnetMode = "none",
  onCycleMagnet,
  stayInDrawingMode = false,
  onToggleStayInDrawingMode,
}: ChartToolbarProps) {
  const [showSymbolSearch, setShowSymbolSearch] = useState(false);
  const [symbolFilter, setSymbolFilter] = useState("");

  const filteredSymbols = symbols.filter(
    (s) =>
      s.name.toLowerCase().includes(symbolFilter.toLowerCase()) ||
      (s.category || "").toLowerCase().includes(symbolFilter.toLowerCase()),
  );

  // Spread in pips/points: (ask - bid) / pipSize. Previously this multiplied
  // by contractSize which produced a meaningless quote-currency-per-lot number
  // (e.g. 9 pips on GBPJPY rendered as "900").
  const spread = tick
    ? ((tick.ask - tick.bid) * 10 ** getPipDigits(symbolInfo, selectedSymbol)).toFixed(1)
    : "--";

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-card text-xs shrink-0 overflow-x-auto md:overflow-visible flex-nowrap md:flex-wrap no-scrollbar">
      {/* Symbol Selector — TradingView style */}
      <div className="relative shrink-0">
        <button
          onClick={() => setShowSymbolSearch((v) => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-secondary font-bold text-sm tracking-tight"
        >
          {selectedSymbol}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>

        {showSymbolSearch && (
          <>
            {/* Mobile: full-screen modal (avoids parent overflow clipping) */}
            <div
              className="md:hidden fixed inset-0 z-[100] bg-black/60"
              onClick={() => setShowSymbolSearch(false)}
            >
              <div
                className="fixed inset-x-0 top-0 bg-card border-b border-border shadow-2xl flex flex-col max-h-[85vh]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-2 p-3 border-b border-border">
                  <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                  <input
                    autoFocus
                    placeholder="Search symbols..."
                    value={symbolFilter}
                    onChange={(e) => setSymbolFilter(e.target.value)}
                    className="flex-1 bg-transparent text-base outline-none"
                  />
                  <button
                    onClick={() => {
                      setShowSymbolSearch(false);
                      setSymbolFilter("");
                    }}
                    className="p-1.5 rounded-md hover:bg-secondary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto overscroll-contain">
                  {filteredSymbols.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No symbols match &ldquo;{symbolFilter}&rdquo;
                    </div>
                  ) : (
                    filteredSymbols.map((s) => (
                      <button
                        key={s.id || s.name}
                        onClick={() => {
                          onSymbolChange(s.name);
                          setShowSymbolSearch(false);
                          setSymbolFilter("");
                        }}
                        className={cn(
                          "w-full flex items-center justify-between px-4 py-3 text-base hover:bg-secondary border-b border-border/40 active:bg-secondary",
                          s.name === selectedSymbol && "bg-secondary",
                        )}
                      >
                        <div className="flex flex-col items-start">
                          <span className="font-semibold">{s.name}</span>
                          {s.displayName && s.displayName !== s.name && (
                            <span className="text-xs text-muted-foreground">{s.displayName}</span>
                          )}
                        </div>
                        <span className="text-muted-foreground text-xs uppercase tracking-wide">
                          {s.category || s.assetClass}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Desktop: absolute dropdown */}
            <div className="hidden md:block absolute top-full left-0 z-50 mt-1 w-64 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
              <input
                autoFocus
                placeholder="Search symbols..."
                value={symbolFilter}
                onChange={(e) => setSymbolFilter(e.target.value)}
                className="w-full px-3 py-2 text-sm border-b border-border bg-card"
              />
              <div className="max-h-60 overflow-y-auto">
                {filteredSymbols.map((s) => (
                  <button
                    key={s.id || s.name}
                    onClick={() => {
                      onSymbolChange(s.name);
                      setShowSymbolSearch(false);
                      setSymbolFilter("");
                    }}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-secondary",
                      s.name === selectedSymbol && "bg-secondary",
                    )}
                  >
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground text-xs">{s.category}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Live Price — bid / ask badges like TradingView */}
      {tick && (
        <div className="flex items-center gap-1 md:gap-1.5 px-1.5 md:px-2 border-l border-r border-border shrink-0">
          <span className="inline-flex items-center gap-1 px-1 md:px-1.5 py-0.5 rounded bg-[#0ecb81]/15 text-[#0ecb81] font-mono font-bold text-[12px] md:text-[13px] tabular-nums tracking-tight">
            {formatNumber(
              tick.bid,
              symbolInfo?.tickSize ? String(symbolInfo.tickSize).split(".")[1]?.length || 2 : 5,
            )}
          </span>
          <span className="text-muted-foreground text-[10px] font-medium">/</span>
          <span className="inline-flex items-center gap-1 px-1 md:px-1.5 py-0.5 rounded bg-[#f6465d]/15 text-[#f6465d] font-mono font-bold text-[12px] md:text-[13px] tabular-nums tracking-tight">
            {formatNumber(
              tick.ask,
              symbolInfo?.tickSize ? String(symbolInfo.tickSize).split(".")[1]?.length || 2 : 5,
            )}
          </span>
          <span className="text-muted-foreground text-[10px] font-medium ml-0.5 hidden md:inline">
            Sprd: {spread}
          </span>
        </div>
      )}

      {/* Timeframe Selector — locked to 1m while a replay session is active */}
      <div className="flex items-center gap-0.5 ml-1 shrink-0">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            disabled={isReplaying}
            title={isReplaying ? "Timeframe is fixed to 1m during replay" : undefined}
            className={cn(
              "px-2 py-1 rounded-md text-xs font-medium transition-all",
              tf === timeframe
                ? "bg-primary text-primary-foreground shadow-sm"
                : "hover:bg-secondary/80 text-muted-foreground hover:text-foreground",
              isReplaying && "opacity-40 cursor-default",
            )}
          >
            {tf}
          </button>
        ))}
      </div>

      {/* Session replay controls — disabled until the feature is QA'd */}
      {REPLAY_ENABLED && replayAccountId != null && <ReplayHUD accountId={replayAccountId} />}

      {/* Chart layout templates (save/load/autosave) */}
      {onSetIndicators && onSetPlugins && (
        <ChartTemplatesMenu
          activeIndicators={activeIndicators}
          onSetIndicators={onSetIndicators}
          activePlugins={activePlugins}
          onSetPlugins={onSetPlugins}
        />
      )}

      <div className="h-4 border-l border-border mx-1 hidden md:block" />

      {/* Indicators */}
      {
        <div className="relative hidden md:block">
          <button
            onClick={onToggleIndicatorMenu}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-xs",
              activeIndicators.length > 0
                ? "bg-primary/20 text-primary"
                : "hover:bg-secondary text-muted-foreground",
            )}
          >
            <BarChart3 className="h-3 w-3" />
            Indicators
            {activeIndicators.length > 0 && (
              <span className="bg-primary text-primary-foreground rounded-full px-1 text-[9px]">
                {activeIndicators.length}
              </span>
            )}
          </button>

          {showIndicatorMenu && (
            <div className="absolute top-full left-0 z-50 mt-1 w-64 bg-card border border-border rounded-lg shadow-xl p-2 space-y-0.5">
              {INDICATOR_REGISTRY.map((ind) => (
                <button
                  key={ind.type}
                  onClick={() => onToggleIndicator(ind.type)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-secondary text-left",
                    activeIndicators.includes(ind.type) && "bg-secondary",
                  )}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: ind.color }}
                  />
                  <span className="flex-1">{ind.label}</span>
                  <span className="text-[10px] text-muted-foreground">{ind.pane}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      }

      {/* Drawing Tools — pencil icon with dropdown */}
      {
        <div className="hidden md:flex items-center gap-0.5">
          <DrawingToolsDropdown
            drawingTool={drawingTool}
            onDrawingTool={onDrawingTool}
            drawings={drawings}
            onClearDrawings={onClearDrawings}
            magnetMode={magnetMode}
            onCycleMagnet={onCycleMagnet}
            stayInDrawingMode={stayInDrawingMode}
            onToggleStayInDrawingMode={onToggleStayInDrawingMode}
          />
          {onTogglePlugin && (
            <PluginsDropdown activePlugins={activePlugins} onTogglePlugin={onTogglePlugin} />
          )}
        </div>
      }

      <div className="flex-1 hidden md:block" />

      {/* Right Panel Toggles */}
      <div className="hidden md:flex items-center gap-0.5">
        <ToolButton
          icon={ArrowUpDown}
          tooltip="Order Panel"
          active={showRightPanel && rightPanel === "order"}
          onClick={() => onRightPanel("order")}
        />
        <ToolButton
          icon={Layers}
          tooltip="Depth of Market"
          active={showRightPanel && rightPanel === "dom"}
          onClick={() => onRightPanel("dom")}
        />
        <ToolButton
          icon={BarChart3}
          tooltip="Watchlist"
          active={showRightPanel && rightPanel === "watchlist"}
          onClick={() => onRightPanel("watchlist")}
        />
        <ToolButton
          icon={Newspaper}
          tooltip="News"
          active={showRightPanel && rightPanel === "news"}
          onClick={() => onRightPanel("news")}
        />
        <ToolButton
          icon={Star}
          tooltip="TradingView Analysis"
          active={showRightPanel && rightPanel === "tv-analysis"}
          onClick={() => onRightPanel("tv-analysis")}
        />
        {aiTraderEnabled && (
          <ToolButton
            icon={Bot}
            tooltip="AI Trader"
            active={showRightPanel && rightPanel === "ai-trader"}
            onClick={() => onRightPanel("ai-trader")}
          />
        )}
        <div className="h-4 border-l border-border mx-1" />
        <button
          onClick={onToggleRightPanel}
          className="px-1.5 py-1 rounded hover:bg-secondary text-muted-foreground"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export function ToolButton({
  icon: Icon,
  tooltip,
  active,
  onClick,
}: {
  icon: LucideIcon;
  tooltip: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={cn(
        "px-1.5 py-1 rounded",
        active ? "bg-primary/20 text-primary" : "hover:bg-secondary text-muted-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

const CHART_PLUGIN_ITEMS = [
  { id: "crosshair", icon: Crosshair, label: "Crosshair Highlight" },
  { id: "session", icon: Clock, label: "Session Highlighting" },
  { id: "session-breaks", icon: CalendarDays, label: "Session Breaks" },
  { id: "bands", icon: AlignCenter, label: "Bands Indicator" },
  { id: "tooltip", icon: Info, label: "OHLCV Tooltip" },
  { id: "delta-tooltip", icon: Activity, label: "Delta Tooltip" },
] satisfies Array<{ id: string; icon: LucideIcon; label: string }>;

function PluginsDropdown({
  activePlugins,
  onTogglePlugin,
}: {
  activePlugins: string[];
  onTogglePlugin: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const isActive = activePlugins.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Chart Plugins"
        className={cn(
          "flex items-center gap-1 px-1.5 py-1 rounded",
          isActive ? "bg-primary/20 text-primary" : "hover:bg-secondary text-muted-foreground",
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        {isActive && (
          <span className="bg-primary text-primary-foreground rounded-full px-1 text-[9px]">
            {activePlugins.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[190px]">
          {CHART_PLUGIN_ITEMS.map(({ id, icon: Icon, label }) => {
            const isOn = activePlugins.includes(id);
            return (
              <button
                key={id}
                onClick={() => onTogglePlugin(id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-secondary text-left",
                  isOn && "bg-secondary text-primary",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">{label}</span>
                {isOn && <span className="text-[10px] text-primary font-medium">ON</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const DRAWING_TOOLS = [
  { tool: "horizontal" as const, icon: Minus, label: "Horizontal Line", shortcut: "Alt+H" },
  { tool: "trendline" as const, icon: TrendingUp, label: "Trendline", shortcut: "Alt+T" },
  { tool: "fibonacci" as const, icon: Layers, label: "Fibonacci", shortcut: "Alt+F" },
  { tool: "rectangle" as const, icon: Square, label: "Rectangle", shortcut: "Alt+R" },
  { tool: "ray" as const, icon: MoveUpRight, label: "Ray", shortcut: "" },
  { tool: "extended" as const, icon: Spline, label: "Extended Line", shortcut: "" },
  { tool: "vertical" as const, icon: MoveVertical, label: "Vertical Line", shortcut: "" },
  { tool: "channel" as const, icon: Equal, label: "Parallel Channel", shortcut: "" },
  { tool: "fibextension" as const, icon: Layers3, label: "Fib Extension", shortcut: "" },
  { tool: "ellipse" as const, icon: Circle, label: "Ellipse", shortcut: "" },
  { tool: "arrow" as const, icon: ArrowRight, label: "Arrow", shortcut: "" },
  { tool: "triangle" as const, icon: Triangle, label: "Triangle", shortcut: "" },
  { tool: "text" as const, icon: Type, label: "Text", shortcut: "" },
  { tool: "long-position" as const, icon: ArrowUpRight, label: "Long Position", shortcut: "" },
  { tool: "short-position" as const, icon: ArrowDownRight, label: "Short Position", shortcut: "" },
  { tool: "measure" as const, icon: Ruler, label: "Measure", shortcut: "Alt+M" },
] satisfies Array<{ tool: DrawingTool; icon: LucideIcon; label: string; shortcut: string }>;

function DrawingOptionToggle({
  icon: Icon,
  label,
  enabled,
  onToggle,
}: {
  icon: LucideIcon;
  label: string;
  enabled: boolean;
  onToggle?: () => void;
}) {
  if (!onToggle) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-secondary text-left",
        enabled && "text-primary",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{label}</span>
      {enabled && <span className="text-[10px] text-primary font-medium">ON</span>}
    </button>
  );
}

function DrawingToolsDropdown({
  drawingTool,
  onDrawingTool,
  drawings,
  onClearDrawings,
  magnetMode,
  onCycleMagnet,
  stayInDrawingMode,
  onToggleStayInDrawingMode,
}: {
  drawingTool: DrawingTool;
  onDrawingTool: (t: DrawingTool) => void;
  drawings: DrawingLine[];
  onClearDrawings: () => void;
  magnetMode: MagnetMode;
  onCycleMagnet?: () => void;
  stayInDrawingMode: boolean;
  onToggleStayInDrawingMode?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const isActive = drawingTool !== "none";

  const handleSelect = (t: DrawingTool) => {
    onDrawingTool(drawingTool === t ? "none" : t);
    setOpen(false);
  };

  const handleClear = () => {
    onClearDrawings();
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Drawing Tools"
        className={cn(
          "px-1.5 py-1 rounded",
          isActive ? "bg-primary/20 text-primary" : "hover:bg-secondary text-muted-foreground",
        )}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[190px]">
          {DRAWING_TOOLS.map(({ tool, icon: Icon, label, shortcut }) => (
            <button
              key={tool}
              onClick={() => handleSelect(tool)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-secondary text-left",
                drawingTool === tool && "bg-secondary text-primary",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{label}</span>
              <span className="text-[10px] text-muted-foreground/60">{shortcut}</span>
            </button>
          ))}

          <div className="my-1 border-t border-border" />
          <DrawingOptionToggle
            icon={Magnet}
            label={
              magnetMode === "strong"
                ? "Magnet: strong"
                : magnetMode === "weak"
                  ? "Magnet: weak"
                  : "Magnet: off"
            }
            enabled={magnetMode !== "none"}
            onToggle={onCycleMagnet}
          />
          <DrawingOptionToggle
            icon={Repeat}
            label="Stay in drawing mode"
            enabled={stayInDrawingMode}
            onToggle={onToggleStayInDrawingMode}
          />

          {drawings.length > 0 && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                onClick={handleClear}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-secondary text-muted-foreground text-left"
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" />
                Clear All
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

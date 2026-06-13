import type { Dispatch, RefObject, SetStateAction } from "react";
import { GripVertical, Newspaper, Settings2, X } from "lucide-react";
import { useDragOffset } from "../../hooks/useDragOffset.ts";
import { cn } from "../../lib/utils.ts";
import type { NewsOverlayConfig } from "./constants.ts";
import type { NewsPopupState } from "./useNewsOverlay.ts";

interface NewsOverlayProps {
  newsConfig: NewsOverlayConfig;
  setNewsConfig: Dispatch<SetStateAction<NewsOverlayConfig>>;
  showNewsConfigDialog: boolean;
  setShowNewsConfigDialog: Dispatch<SetStateAction<boolean>>;
  newsPopup: NewsPopupState | null;
  setNewsPopup: Dispatch<SetStateAction<NewsPopupState | null>>;
  isDark: boolean;
  pipDigits: number;
  containerRef: RefObject<HTMLDivElement | null>;
}

export function NewsOverlay({
  newsConfig,
  setNewsConfig,
  showNewsConfigDialog,
  setShowNewsConfigDialog,
  newsPopup,
  setNewsPopup,
  isDark,
  containerRef,
}: NewsOverlayProps) {
  const configDrag = useDragOffset();
  return (
    <>
      {/* News event popup */}
      {newsPopup && (
        <div
          className="absolute z-30"
          style={{
            left: Math.min(
              Math.max(newsPopup.x - 140, 8),
              (containerRef.current?.clientWidth || 400) - 288,
            ),
            top: Math.max(newsPopup.y - 200, 8),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={cn(
              "w-[calc(100vw-2rem)] sm:w-[280px] rounded-lg shadow-2xl border overflow-hidden",
              isDark ? "bg-[#1e222d] border-[#363a45]" : "bg-white border-gray-200",
            )}
          >
            <div
              className={cn(
                "h-1",
                newsPopup.event.impact === "high"
                  ? "bg-red-500"
                  : newsPopup.event.impact === "medium"
                    ? "bg-amber-500"
                    : "bg-gray-400",
              )}
            />
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <h4
                  className={cn(
                    "font-bold text-[13px] leading-tight",
                    isDark ? "text-white" : "text-gray-900",
                  )}
                >
                  {newsPopup.event.event}
                </h4>
                <button
                  onClick={() => setNewsPopup(null)}
                  className="text-muted-foreground hover:text-foreground p-0.5"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3">
                {new Date(newsPopup.event.time).toLocaleDateString("en-US", {
                  day: "numeric",
                  month: "short",
                  year: "2-digit",
                })}{" "}
                {new Date(newsPopup.event.time).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </p>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Actual</span>
                  <span
                    className={cn("font-bold font-mono", isDark ? "text-white" : "text-gray-900")}
                  >
                    {newsPopup.event.actual || "—"}
                  </span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Forecast</span>
                  <span className="font-mono font-medium">{newsPopup.event.forecast || "—"}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Previous</span>
                  <span className="font-mono text-muted-foreground">
                    {newsPopup.event.previous || "—"}
                  </span>
                </div>
              </div>
              <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold text-[9px]",
                    newsPopup.event.impact === "high"
                      ? "bg-red-500/15 text-red-500"
                      : newsPopup.event.impact === "medium"
                        ? "bg-amber-500/15 text-amber-500"
                        : "bg-gray-500/15 text-gray-400",
                  )}
                >
                  {newsPopup.event.impact.toUpperCase()}
                </span>
                <span>{newsPopup.event.currency}</span>
                <span className="text-muted-foreground/50">|</span>
                <span>{newsPopup.event.country}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* News config button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowNewsConfigDialog((v) => !v);
          setNewsPopup(null);
        }}
        className={cn(
          "absolute bottom-2 right-24 z-10 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all",
          newsConfig.enabled
            ? "bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25"
            : "bg-secondary/60 text-muted-foreground border border-border hover:bg-secondary",
        )}
        title="News overlay settings"
      >
        <Newspaper className="h-3 w-3" />
        News
        <Settings2 className="h-2.5 w-2.5 ml-0.5 opacity-60" />
      </button>

      {/* News configuration dialog (draggable by its header) */}
      {showNewsConfigDialog && (
        <div
          className="absolute bottom-10 right-2 sm:right-24 z-30 w-[calc(100vw-1rem)] sm:w-[260px]"
          style={configDrag.style}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={cn(
              "rounded-lg shadow-2xl border overflow-hidden",
              isDark ? "bg-[#1e222d] border-[#363a45]" : "bg-white border-gray-200",
            )}
          >
            <div
              onPointerDown={configDrag.onPointerDown}
              className="flex cursor-grab select-none items-center justify-between px-3 py-2 border-b border-border/40 active:cursor-grabbing"
            >
              <span
                className={cn(
                  "flex items-center gap-1.5 font-bold text-[12px]",
                  isDark ? "text-white" : "text-gray-900",
                )}
              >
                <GripVertical className="h-3 w-3 text-muted-foreground/60" />
                News Overlay Settings
              </span>
              <button
                onClick={() => setShowNewsConfigDialog(false)}
                className="text-muted-foreground hover:text-foreground p-0.5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="p-3 space-y-3">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-[11px] font-medium">Enable News Overlay</span>
                <input
                  type="checkbox"
                  checked={newsConfig.enabled}
                  onChange={(e) => setNewsConfig((c) => ({ ...c, enabled: e.target.checked }))}
                  className="h-3.5 w-3.5 rounded accent-red-500 cursor-pointer"
                />
              </label>

              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium">Line Color</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={newsConfig.lineColor}
                    onChange={(e) => setNewsConfig((c) => ({ ...c, lineColor: e.target.value }))}
                    className="w-6 h-5 rounded border-0 cursor-pointer p-0 bg-transparent"
                  />
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {newsConfig.lineColor}
                  </span>
                </div>
              </div>

              <div className="border-t border-border/40" />

              <div className="space-y-1.5">
                <span
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-wider",
                    isDark ? "text-muted-foreground" : "text-gray-500",
                  )}
                >
                  Time Filters
                </span>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-[11px]">Show Past Events</span>
                  <input
                    type="checkbox"
                    checked={newsConfig.showPast}
                    onChange={(e) => setNewsConfig((c) => ({ ...c, showPast: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded accent-red-500 cursor-pointer"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-[11px]">Show Future Events</span>
                  <input
                    type="checkbox"
                    checked={newsConfig.showFuture}
                    onChange={(e) => setNewsConfig((c) => ({ ...c, showFuture: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded accent-red-500 cursor-pointer"
                  />
                </label>
              </div>

              <div className="border-t border-border/40" />

              <div className="space-y-1.5">
                <span
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-wider",
                    isDark ? "text-muted-foreground" : "text-gray-500",
                  )}
                >
                  Impact Levels
                </span>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                    High Impact
                  </span>
                  <input
                    type="checkbox"
                    checked={newsConfig.showHigh}
                    onChange={(e) => setNewsConfig((c) => ({ ...c, showHigh: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded accent-red-500 cursor-pointer"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                    Medium Impact
                  </span>
                  <input
                    type="checkbox"
                    checked={newsConfig.showMedium}
                    onChange={(e) => setNewsConfig((c) => ({ ...c, showMedium: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded accent-amber-500 cursor-pointer"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
                    Low Impact
                  </span>
                  <input
                    type="checkbox"
                    checked={newsConfig.showLow}
                    onChange={(e) => setNewsConfig((c) => ({ ...c, showLow: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded accent-gray-500 cursor-pointer"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";
import type {
  DrawingLine,
  DrawingTool,
  DrawingType,
  MagnetMode,
} from "../../../pages/trading/constants";
import { DrawingsPrimitive } from "./drawings-primitive";
import { dist, type Pt, snapAngle } from "./geometry";
import { hitTest } from "./hit-test";
import { makeResolveCtx, type ResolveCtx, resolveEntry, timeToX, xToTime } from "./resolve";
import type { DataPoint, DrawingCallbacks, Hit, ResolvedEntry } from "./types";

// Releasing the pointer farther than this from the first anchor commits the
// drawing in one press-drag-release gesture (otherwise we wait for a second
// click), mirroring TradingView's dual placement modes.
const DRAG_COMMIT_THRESHOLD_PX = 10;

// Magnet mode: snap an anchor's price to the nearest O/H/L/C of the bar under
// the cursor when within this many pixels (TradingView's "weak magnet").
const MAGNET_THRESHOLD_PX = 14;

// Object snapping: snap a placed/dragged anchor onto another drawing's anchor
// when the cursor is within this many pixels of it.
const SNAP_ANCHOR_PX = 8;

// Touch input gets fat-finger-friendly hit tolerances and a long-press menu.
const TOUCH_HIT_SCALE = 2;
const LONG_PRESS_MS = 500;
const LONG_PRESS_CANCEL_PX = 10;

// TradingView keyboard shortcuts (Alt+key, matched on physical key code).
const TOOL_SHORTCUTS: Record<string, DrawingTool> = {
  KeyT: "trendline",
  KeyH: "horizontal",
  KeyF: "fibonacci",
  KeyR: "rectangle",
  KeyM: "measure",
};

interface OhlcBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

function asOhlc(bar: object): OhlcBar | null {
  const b = bar as Partial<OhlcBar>;
  const valid =
    typeof b.open === "number" &&
    typeof b.high === "number" &&
    typeof b.low === "number" &&
    typeof b.close === "number";
  return valid ? (b as OhlcBar) : null;
}

/** Minimal cross-input event surface shared by mouse and touch paths. */
interface TakeoverEvt {
  shiftKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

function evtFromTouch(e: TouchEvent): TakeoverEvt {
  return {
    shiftKey: false,
    preventDefault: () => e.preventDefault(),
    stopPropagation: () => e.stopPropagation(),
  };
}

/** Drop undefined-valued keys so a style default never overwrites with undefined. */
function definedOnly<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

function isTextInputTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

interface GroupMember {
  origin: DrawingLine;
  entry: ResolvedEntry;
}

interface DragState {
  hit: Hit;
  startX: number;
  startY: number;
  origin: DrawingLine;
  originEntry: ResolvedEntry;
  /** Other selected drawings that move together on body drags. */
  group: GroupMember[];
  moved: boolean;
  isTouch: boolean;
}

interface PlacingState {
  p1: DataPoint;
  startX: number;
  startY: number;
}

export interface DrawingToolsManagerOptions {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  container: HTMLElement;
  /** Chart timeframe interval in seconds — used for whitespace extrapolation. */
  intervalSec: number;
  /** Current timeframe label, stamped on new drawings as createdTf. */
  timeframe: string;
  /** Account equity — drives the position tool's $-risk / size readout. */
  accountEquity?: number;
  callbacks: DrawingCallbacks;
}

/**
 * TradingView-style interaction layer for chart drawings.
 *
 * Placement: arm a tool, then click-move-click or press-drag-release with a
 * live preview. Editing: hover highlights, drag anchors or bodies (Shift =
 * 45° snap, magnet = OHLC snap), shift-click multi-selects and body drags
 * move the whole group, Delete removes the selection, Escape cancels. Touch
 * gets scaled hit targets, drag support, and long-press for settings.
 * Pointer-down events that land on a drawing are stopped in the capture
 * phase so the chart never pans underneath a drag.
 */
export class DrawingToolsManager {
  private readonly chart: IChartApi;
  private readonly series: ISeriesApi<SeriesType>;
  private readonly container: HTMLElement;
  private readonly cb: DrawingCallbacks;
  private readonly primitive: DrawingsPrimitive;
  // Mutable: the chart instance persists across timeframe changes (TradingView
  // behavior), so these are updated in place via updateTimeframe rather than
  // recreating the manager.
  private intervalSec: number;
  private timeframe: string;

  private tool: DrawingTool = "none";
  private drawings: DrawingLine[] = [];
  private placing: PlacingState | null = null;
  private drag: DragState | null = null;
  private selectedIds: string[] = [];
  private hoveredId: string | null = null;
  private magnetMode: MagnetMode = "none";
  private stayInMode = false;
  private longPress: { timer: number; id: string; startPos: Pt } | null = null;
  // The measure tool is a throwaway gesture: its result lingers as a preview
  // (never committed/persisted) until the next pointer-down or Escape.
  private measureResult: DrawingLine | null = null;
  // Copy/paste clipboard (deep copies of the drawings copied with Ctrl/Cmd+C).
  private clipboard: DrawingLine[] = [];
  // Per-type style defaults new drawings inherit (set via the settings dialog).
  private styleDefaults: Record<string, Partial<DrawingLine>> = {};

  constructor(opts: DrawingToolsManagerOptions) {
    this.chart = opts.chart;
    this.series = opts.series;
    this.container = opts.container;
    this.cb = opts.callbacks;
    this.intervalSec = opts.intervalSec;
    this.timeframe = opts.timeframe;
    this.primitive = new DrawingsPrimitive();
    this.primitive.setIntervalSec(opts.intervalSec);
    this.primitive.setAccountEquity(opts.accountEquity ?? 0);
    this.series.attachPrimitive(this.primitive);
    this.container.addEventListener("mousedown", this.handleMouseDown, true);
    this.container.addEventListener("dblclick", this.handleDblClick);
    this.container.addEventListener("contextmenu", this.handleContextMenu);
    this.container.addEventListener("touchstart", this.handleTouchStart, {
      capture: true,
      passive: false,
    });
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mouseup", this.handleMouseUp);
    window.addEventListener("touchmove", this.handleTouchMove, { passive: false });
    window.addEventListener("touchend", this.handleTouchEnd);
    window.addEventListener("touchcancel", this.handleTouchEnd);
    window.addEventListener("keydown", this.handleKeyDown);
  }

  destroy(): void {
    this.clearLongPress();
    this.container.removeEventListener("mousedown", this.handleMouseDown, true);
    this.container.removeEventListener("dblclick", this.handleDblClick);
    this.container.removeEventListener("contextmenu", this.handleContextMenu);
    this.container.removeEventListener("touchstart", this.handleTouchStart, true);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("touchmove", this.handleTouchMove);
    window.removeEventListener("touchend", this.handleTouchEnd);
    window.removeEventListener("touchcancel", this.handleTouchEnd);
    window.removeEventListener("keydown", this.handleKeyDown);
    try {
      this.series.detachPrimitive(this.primitive);
    } catch {
      /* chart already removed */
    }
    this.container.style.cursor = "";
  }

  setTool(tool: DrawingTool): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.cancelPlacement();
    this.applyCursor(null);
  }

  setMagnetMode(mode: MagnetMode): void {
    this.magnetMode = mode;
  }

  setStyleDefaults(defaults: Record<string, Partial<DrawingLine>>): void {
    this.styleDefaults = defaults;
  }

  setStayInDrawingMode(enabled: boolean): void {
    this.stayInMode = enabled;
  }

  setAccountEquity(equity: number): void {
    this.primitive.setAccountEquity(equity);
  }

  /**
   * Re-point the manager at a new timeframe without recreating it. The chart
   * and drawing primitive stay alive (so drawings never blink out on a TF
   * switch); only the interval used for whitespace extrapolation and the
   * createdTf stamped on new drawings change.
   */
  updateTimeframe(timeframe: string, intervalSec: number): void {
    this.timeframe = timeframe;
    this.intervalSec = intervalSec;
    this.primitive.setIntervalSec(intervalSec);
  }

  /** External selection (e.g. object tree row click). Unknown ids are dropped. */
  setSelection(ids: string[]): void {
    this.select(ids.filter((id) => this.drawings.some((d) => d.id === id)));
  }

  setDrawings(drawings: DrawingLine[]): void {
    // Mid-drag the local copy is authoritative; the post-onUpdate sync will
    // deliver the final state once the drag ends.
    if (this.drag) return;
    this.drawings = drawings.map((d) => ({ ...d }));
    const pruned = this.selectedIds.filter((id) => this.drawings.some((d) => d.id === id));
    if (pruned.length !== this.selectedIds.length) this.select(pruned);
    this.primitive.setDrawings(this.drawings);
  }

  // ── Coordinate helpers ─────────────────────────────────────────────

  private ctx(): ResolveCtx {
    return makeResolveCtx(this.chart, this.series, this.intervalSec);
  }

  /** Pointer position relative to the chart pane, or null when outside it. */
  private posFromClient(clientX: number, clientY: number): Pt | null {
    const rect = this.container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const timeScale = this.chart.timeScale();
    const paneWidth = timeScale.width();
    const paneHeight = rect.height - timeScale.height();
    if (paneWidth <= 0 || x < 0 || y < 0 || x > paneWidth || y > paneHeight) return null;
    return { x, y };
  }

  private eventPos(e: MouseEvent): Pt | null {
    return this.posFromClient(e.clientX, e.clientY);
  }

  private toPoint(p: Pt): DataPoint | null {
    const time = xToTime(this.ctx(), p.x);
    const price = this.series.coordinateToPrice(p.y);
    if (time === null || price === null) return null;
    return { time, price };
  }

  private resolveAll(): ResolvedEntry[] {
    const ctx = this.ctx();
    return this.drawings.map((d) => resolveEntry(d, ctx, "normal"));
  }

  // Build a drawing, then merge the user's saved style default for its type
  // (the measure gesture keeps its fixed look).
  private makeNew(tool: DrawingTool, p1: DataPoint, p2: DataPoint): DrawingLine {
    const d = this.buildNew(tool, p1, p2);
    if (tool === "measure") return d;
    const def = this.styleDefaults[d.type];
    return def ? { ...d, ...definedOnly(def) } : d;
  }

  private buildNew(tool: DrawingTool, p1: DataPoint, p2: DataPoint): DrawingLine {
    if (tool === "long-position" || tool === "short-position") {
      return this.makePosition(tool === "long-position" ? "long" : "short", p1, p2);
    }
    const base = {
      id: crypto.randomUUID(),
      color: tool === "trendline" ? "#2196F3" : "#f0b90b",
      createdTf: this.timeframe,
    };
    if (tool === "horizontal") return { ...base, type: "horizontal", price: p1.price };
    if (tool === "vertical") return { ...base, type: "vertical", price: p1.price, time: p1.time };
    const two = { ...base, price: p1.price, time: p1.time, price2: p2.price, time2: p2.time };
    if (tool === "ray") return { ...two, type: "trendline", extendRight: true };
    if (tool === "extended")
      return { ...two, type: "trendline", extendLeft: true, extendRight: true };
    if (tool === "measure")
      return { ...two, type: "trendline", color: "#b2b5be", lineStyle: "dashed" };
    if (tool === "channel") {
      // Offset line defaults parallel and mirrored below so it's visible/draggable.
      return { ...two, type: "channel", time3: p1.time, price3: 2 * p1.price - p2.price };
    }
    if (tool === "text") return { ...two, type: "text", text: "Text" };
    return { ...two, type: tool as DrawingType };
  }

  // Position tool: entry = first anchor price; the drag's release price becomes
  // the target and the stop is mirrored 1:1 on the opposite side (draggable
  // afterwards). Side only drives labelling/colour — risk math uses absolutes.
  private makePosition(side: "long" | "short", p1: DataPoint, p2: DataPoint): DrawingLine {
    const entry = p1.price;
    const target = p2.price;
    return {
      id: crypto.randomUUID(),
      type: "position",
      side,
      color: side === "long" ? "#089981" : "#f23645",
      createdTf: this.timeframe,
      price: entry,
      time: Math.min(p1.time, p2.time),
      time2: Math.max(p1.time, p2.time),
      targetPrice: target,
      stopPrice: entry - (target - entry),
      riskPct: 1,
    };
  }

  // ── Mouse handlers ─────────────────────────────────────────────────

  private handleMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    const pos = this.eventPos(e);
    if (!pos) return;
    this.clearMeasure();
    if (this.tool !== "none") {
      this.placementStart(pos, e);
      return;
    }
    this.selectionStart(pos, e, false);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    const pos = this.eventPos(e);
    if (this.drag) {
      if (pos) this.dragMove(pos, e.shiftKey);
      return;
    }
    if (!pos) {
      this.hoverHit(null);
      return;
    }
    if (this.placing) {
      this.placingMove(pos, e.shiftKey);
      return;
    }
    if (this.tool === "none") this.hoverHit(hitTest(this.resolveAll(), pos));
  };

  private handleMouseUp = (e: MouseEvent): void => {
    if (this.drag) {
      this.endDrag();
      return;
    }
    if (this.placing) this.maybeCommitPlacement(this.eventPos(e), e.shiftKey);
  };

  private handleDblClick = (e: MouseEvent): void => {
    if (this.tool !== "none") return;
    const pos = this.eventPos(e);
    if (!pos) return;
    const hit = hitTest(this.resolveAll(), pos);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    this.select([hit.id]);
    this.cb.onRequestSettings?.(hit.id);
  };

  private handleContextMenu = (e: MouseEvent): void => {
    const pos = this.eventPos(e);
    if (!pos) return;
    const hit = hitTest(this.resolveAll(), pos);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    if (!this.selectedIds.includes(hit.id)) this.select([hit.id]);
    this.cb.onContextMenu?.(hit.id, e.clientX, e.clientY);
  };

  // ── Touch handlers ─────────────────────────────────────────────────

  private handleTouchStart = (e: TouchEvent): void => {
    if (e.touches.length !== 1) return; // pinch / two-finger → chart
    const t = e.touches[0]!;
    const pos = this.posFromClient(t.clientX, t.clientY);
    if (!pos) return;
    if (this.tool !== "none") {
      this.placementStart(pos, evtFromTouch(e));
      return;
    }
    const hit = this.selectionStart(pos, evtFromTouch(e), true);
    if (hit) this.startLongPress(hit.id, pos);
  };

  private handleTouchMove = (e: TouchEvent): void => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0]!;
    const pos = this.posFromClient(t.clientX, t.clientY);
    this.cancelLongPressIfMoved(pos);
    if (this.drag) {
      e.preventDefault(); // keep the page/chart from scrolling mid-drag
      if (pos) this.dragMove(pos, false);
      return;
    }
    if (this.placing && pos) this.placingMove(pos, false);
  };

  private handleTouchEnd = (e: TouchEvent): void => {
    this.clearLongPress();
    if (this.drag) {
      this.endDrag();
      return;
    }
    if (!this.placing) return;
    const t = e.changedTouches[0];
    this.maybeCommitPlacement(t ? this.posFromClient(t.clientX, t.clientY) : null, false);
  };

  private startLongPress(id: string, pos: Pt): void {
    this.clearLongPress();
    const timer = window.setTimeout(() => {
      this.longPress = null;
      this.drag = null; // long-press opens settings instead of dragging
      this.applyCursor(null);
      this.cb.onRequestSettings?.(id);
    }, LONG_PRESS_MS);
    this.longPress = { timer, id, startPos: pos };
  }

  private cancelLongPressIfMoved(pos: Pt | null): void {
    if (!this.longPress) return;
    if (!pos || dist(pos, this.longPress.startPos) > LONG_PRESS_CANCEL_PX) this.clearLongPress();
  }

  private clearLongPress(): void {
    if (!this.longPress) return;
    window.clearTimeout(this.longPress.timer);
    this.longPress = null;
  }

  // ── Keyboard ───────────────────────────────────────────────────────

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (isTextInputTarget(e.target)) return;
    if (this.handleHistoryShortcut(e) || this.handleToolShortcut(e)) return;
    if (this.handleClipboardShortcut(e) || this.handleArrowNudge(e)) return;
    if (e.key === "Escape") {
      this.handleEscape();
      return;
    }
    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      this.selectedIds.length > 0 &&
      !this.drag
    ) {
      e.preventDefault();
      this.removeSelected();
    }
  };

  /** Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo. */
  private handleHistoryShortcut(e: KeyboardEvent): boolean {
    if (!e.ctrlKey && !e.metaKey) return false;
    if (e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) this.cb.onRedo?.();
      else this.cb.onUndo?.();
      return true;
    }
    if (e.code === "KeyY") {
      e.preventDefault();
      this.cb.onRedo?.();
      return true;
    }
    return false;
  }

  /** Alt+T/H/F/R arms the matching drawing tool. */
  private handleToolShortcut(e: KeyboardEvent): boolean {
    if (!e.altKey || e.ctrlKey || e.metaKey) return false;
    const tool = TOOL_SHORTCUTS[e.code];
    if (!tool) return false;
    e.preventDefault();
    this.cb.onSelectTool?.(tool);
    return true;
  }

  /** Ctrl/Cmd+C copy, +V paste, +D duplicate the current selection. */
  private handleClipboardShortcut(e: KeyboardEvent): boolean {
    if (!e.ctrlKey && !e.metaKey) return false;
    if (e.code === "KeyC") {
      this.copySelected();
      return true;
    }
    if (e.code === "KeyV") {
      e.preventDefault();
      this.pasteClipboard();
      return true;
    }
    if (e.code === "KeyD") {
      e.preventDefault();
      this.copySelected();
      this.pasteClipboard();
      return true;
    }
    return false;
  }

  /** Arrow keys nudge the selection 1px (10px with Shift). */
  private handleArrowNudge(e: KeyboardEvent): boolean {
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = deltas[e.key];
    if (!d || this.selectedIds.length === 0) return false;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    this.nudgeSelected(d[0] * step, d[1] * step);
    return true;
  }

  private copySelected(): void {
    this.clipboard = this.drawings
      .filter((d) => this.selectedIds.includes(d.id))
      .map((d) => ({ ...d }));
  }

  private pasteClipboard(): void {
    if (this.clipboard.length === 0) return;
    const dt = this.intervalSec * 3; // paste a few bars to the right
    const created = this.clipboard.map((d) => this.offsetCopy(d, dt));
    this.drawings = [...this.drawings, ...created];
    this.primitive.setDrawings(this.drawings);
    for (const d of created) this.cb.onAdd({ ...d });
    this.select(created.map((c) => c.id));
  }

  private offsetCopy(d: DrawingLine, dt: number): DrawingLine {
    return {
      ...d,
      id: crypto.randomUUID(),
      time: d.time != null ? d.time + dt : undefined,
      time2: d.time2 != null ? d.time2 + dt : undefined,
      time3: d.time3 != null ? d.time3 + dt : undefined,
    };
  }

  private nudgeSelected(dx: number, dy: number): void {
    const entries = this.resolveAll();
    const updates: DrawingLine[] = [];
    for (const id of this.selectedIds) {
      const origin = this.drawings.find((d) => d.id === id);
      const entry = entries.find((en) => en.d.id === id);
      if (!origin || !entry || origin.locked) continue;
      const u = this.shiftDrawing(origin, entry, dx, dy);
      if (u) updates.push(u);
    }
    if (updates.length === 0) return;
    const byId = new Map(updates.map((u) => [u.id, u]));
    this.drawings = this.drawings.map((d) => byId.get(d.id) ?? d);
    this.primitive.setDrawings(this.drawings);
    for (const u of updates) this.cb.onUpdate({ ...u });
  }

  private handleEscape(): void {
    this.clearMeasure();
    if (this.tool !== "none") {
      this.tool = "none";
      this.cancelPlacement();
      this.applyCursor(null);
      this.cb.onToolFinished();
      return;
    }
    this.select([]);
  }

  // ── Placement ──────────────────────────────────────────────────────

  private placementStart(pos: Pt, e: TakeoverEvt): void {
    const pt = this.pointFor(pos, e.shiftKey, this.placementAnchorPx());
    if (!pt) return;
    // Take the event over so the chart doesn't pan while drawing.
    e.preventDefault();
    e.stopPropagation();
    if (this.tool === "horizontal" || this.tool === "vertical" || this.tool === "text") {
      this.commitDrawing(this.makeNew(this.tool, pt, pt));
      return;
    }
    if (this.placing) {
      this.commitPlacement(this.placing.p1, pt);
      return;
    }
    this.placing = { p1: pt, startX: pos.x, startY: pos.y };
    this.primitive.setPreview(this.makeNew(this.tool, pt, pt));
  }

  // Branches the measure tool (a throwaway readout) away from the persist path.
  private commitPlacement(p1: DataPoint, p2: DataPoint): void {
    if (this.tool === "measure") {
      this.finishMeasure(p1, p2);
      return;
    }
    this.commitDrawing(this.makeNew(this.tool, p1, p2));
  }

  private finishMeasure(p1: DataPoint, p2: DataPoint): void {
    this.placing = null;
    this.measureResult = {
      id: "measure",
      type: "trendline",
      color: "#b2b5be",
      lineStyle: "dashed",
      price: p1.price,
      time: p1.time,
      price2: p2.price,
      time2: p2.time,
    };
    this.primitive.setPreview(this.measureResult);
    this.tool = "none";
    this.applyCursor(null);
    this.cb.onToolFinished();
  }

  private clearMeasure(): void {
    if (!this.measureResult) return;
    this.measureResult = null;
    this.primitive.setPreview(null);
  }

  private placingMove(pos: Pt, shiftKey: boolean): void {
    const pt = this.pointFor(pos, shiftKey, this.placementAnchorPx());
    if (!pt || !this.placing) return;
    this.primitive.setPreview(this.makeNew(this.tool, this.placing.p1, pt));
  }

  private maybeCommitPlacement(pos: Pt | null, shiftKey: boolean): void {
    const placing = this.placing!;
    if (!pos || dist(pos, { x: placing.startX, y: placing.startY }) < DRAG_COMMIT_THRESHOLD_PX) {
      return;
    }
    const pt = this.pointFor(pos, shiftKey, this.placementAnchorPx());
    if (pt) this.commitPlacement(placing.p1, pt);
  }

  private commitDrawing(d: DrawingLine): void {
    this.placing = null;
    this.primitive.setPreview(null);
    this.drawings = [...this.drawings, d];
    this.primitive.setDrawings(this.drawings);
    this.cb.onAdd({ ...d });
    if (this.stayInMode && this.tool !== "none") return; // keep tool armed
    this.select([d.id]);
    this.tool = "none";
    this.applyCursor(null);
    this.cb.onToolFinished();
  }

  private cancelPlacement(): void {
    this.placing = null;
    this.primitive.setPreview(null);
  }

  // ── Selection & dragging ───────────────────────────────────────────

  private selectionStart(pos: Pt, e: TakeoverEvt, isTouch: boolean): Hit | null {
    const entries = this.resolveAll();
    const hit = hitTest(entries, pos, isTouch ? TOUCH_HIT_SCALE : 1);
    if (!hit) {
      if (!e.shiftKey) this.select([]);
      return null;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) {
      this.toggleSelection(hit.id);
      return hit;
    }
    if (!this.selectedIds.includes(hit.id)) this.select([hit.id]);
    this.beginDrag(hit, pos, entries, isTouch);
    return hit;
  }

  private toggleSelection(id: string): void {
    const next = this.selectedIds.includes(id)
      ? this.selectedIds.filter((x) => x !== id)
      : [...this.selectedIds, id];
    this.select(next);
  }

  private beginDrag(hit: Hit, pos: Pt, entries: ResolvedEntry[], isTouch: boolean): void {
    const origin = this.drawings.find((d) => d.id === hit.id);
    const originEntry = entries.find((en) => en.d.id === hit.id);
    // Locked drawings are selectable (so they can be unlocked) but never drag.
    if (!origin || !originEntry || origin.locked) return;
    const group = hit.region.kind === "body" ? this.groupFor(hit.id, entries) : [];
    this.drag = {
      hit,
      startX: pos.x,
      startY: pos.y,
      origin: { ...origin },
      originEntry,
      group,
      moved: false,
      isTouch,
    };
    this.applyCursor("grabbing");
  }

  /** Other selected, unlocked drawings that ride along on a body drag. */
  private groupFor(primaryId: string, entries: ResolvedEntry[]): GroupMember[] {
    if (this.selectedIds.length < 2 || !this.selectedIds.includes(primaryId)) return [];
    const out: GroupMember[] = [];
    for (const id of this.selectedIds) {
      if (id === primaryId) continue;
      const origin = this.drawings.find((d) => d.id === id);
      const entry = entries.find((en) => en.d.id === id);
      if (origin && entry && !origin.locked) out.push({ origin: { ...origin }, entry });
    }
    return out;
  }

  private dragMove(pos: Pt, shiftKey: boolean): void {
    const drag = this.drag!;
    const updates = this.computeDragUpdates(drag, pos, shiftKey);
    if (updates.length === 0) return;
    drag.moved = true;
    const byId = new Map(updates.map((u) => [u.id, u]));
    this.drawings = this.drawings.map((d) => byId.get(d.id) ?? d);
    this.primitive.setDrawings(this.drawings);
  }

  private computeDragUpdates(drag: DragState, pos: Pt, shiftKey: boolean): DrawingLine[] {
    if (drag.hit.region.kind !== "body") {
      const u = this.dragPoint(drag, pos, shiftKey);
      return u ? [u] : [];
    }
    const dx = pos.x - drag.startX;
    const dy = pos.y - drag.startY;
    const updates: DrawingLine[] = [];
    const primary = this.shiftDrawing(drag.origin, drag.originEntry, dx, dy);
    if (!primary) return [];
    updates.push(primary);
    for (const g of drag.group) {
      const u = this.shiftDrawing(g.origin, g.entry, dx, dy);
      if (u) updates.push(u);
    }
    return updates;
  }

  private dragPoint(drag: DragState, pos: Pt, shiftKey: boolean): DrawingLine | null {
    if (drag.hit.region.kind !== "point") return null;
    const pt = this.pointFor(pos, shiftKey, this.dragAnchorPx(drag));
    if (!pt) return null;
    const updated: DrawingLine = { ...drag.origin };
    const { timeKey, priceKey } = drag.hit.region;
    if (timeKey) updated[timeKey] = pt.time;
    if (priceKey) updated[priceKey] = pt.price;
    return updated;
  }

  /** Move a whole drawing by a pixel delta (body / group drag). */
  private shiftDrawing(
    origin: DrawingLine,
    entry: ResolvedEntry,
    dx: number,
    dy: number,
  ): DrawingLine | null {
    if (origin.type === "horizontal") {
      if (entry.y1 === null) return null;
      const price = this.series.coordinateToPrice(entry.y1 + dy);
      return price === null ? null : { ...origin, price };
    }
    if (origin.type === "vertical") {
      const p = this.shiftPoint(entry.x1, entry.y1, dx, 0);
      return p ? { ...origin, time: p.time } : null;
    }
    if (origin.type === "position") return this.shiftPosition(origin, entry, dx, dy);
    if (origin.type === "channel") return this.shiftChannel(origin, entry, dx, dy);
    const p1 = this.shiftPoint(entry.x1, entry.y1, dx, dy);
    const p2 = this.shiftPoint(entry.x2, entry.y2, dx, dy);
    if (!p1 || !p2) return null;
    return { ...origin, time: p1.time, price: p1.price, time2: p2.time, price2: p2.price };
  }

  // Body-drag a parallel channel: move all three anchors together.
  private shiftChannel(
    origin: DrawingLine,
    entry: ResolvedEntry,
    dx: number,
    dy: number,
  ): DrawingLine | null {
    const p1 = this.shiftPoint(entry.x1, entry.y1, dx, dy);
    const p2 = this.shiftPoint(entry.x2, entry.y2, dx, dy);
    const p3 = this.shiftPoint(entry.x1, entry.y3 ?? entry.y1, dx, dy);
    if (!p1 || !p2 || !p3) return null;
    return {
      ...origin,
      time: p1.time,
      price: p1.price,
      time2: p2.time,
      price2: p2.price,
      time3: p3.time,
      price3: p3.price,
    };
  }

  // Body-drag a position: shift the box in time and every price row together.
  private shiftPosition(
    origin: DrawingLine,
    entry: ResolvedEntry,
    dx: number,
    dy: number,
  ): DrawingLine | null {
    const p = this.shiftPoint(entry.x1, entry.y1, dx, dy);
    if (!p) return null;
    const dPrice = p.price - origin.price;
    const dTime = p.time - (origin.time ?? p.time);
    return {
      ...origin,
      time: (origin.time ?? 0) + dTime,
      time2: (origin.time2 ?? 0) + dTime,
      price: p.price,
      stopPrice: origin.stopPrice != null ? origin.stopPrice + dPrice : undefined,
      targetPrice: origin.targetPrice != null ? origin.targetPrice + dPrice : undefined,
    };
  }

  private shiftPoint(x: number | null, y: number | null, dx: number, dy: number): DataPoint | null {
    if (x === null || y === null) return null;
    return this.toPoint({ x: x + dx, y: y + dy });
  }

  private endDrag(): void {
    const drag = this.drag!;
    this.drag = null;
    this.applyCursor(null);
    if (!drag.moved) return;
    const ids = [drag.hit.id, ...drag.group.map((g) => g.origin.id)];
    for (const id of ids) {
      const d = this.drawings.find((x) => x.id === id);
      if (d) this.cb.onUpdate({ ...d });
    }
  }

  // ── Snapping (Shift = 45° angle, magnet = OHLC price) ──────────────

  /**
   * Resolve a cursor position to a data point, applying Shift angle-snap
   * (trendlines, when an opposite anchor exists) or magnet OHLC snapping.
   */
  private pointFor(pos: Pt, shiftKey: boolean, angleAnchor: Pt | null): DataPoint | null {
    const snapped = this.snapToNearbyAnchor(pos);
    if (snapped) return snapped;
    if (shiftKey && angleAnchor) return this.toPoint(snapAngle(angleAnchor, pos));
    const pt = this.toPoint(pos);
    if (!pt || this.magnetMode === "none") return pt;
    return this.magnetSnap(pt, pos.y);
  }

  // Snap an anchor to a nearby *other* drawing's anchor (object snapping). The
  // currently-selected drawings are skipped so dragging never snaps to itself.
  private snapToNearbyAnchor(pos: Pt): DataPoint | null {
    for (const e of this.resolveAll()) {
      if (this.selectedIds.includes(e.d.id)) continue;
      for (const c of this.anchorPoints(e)) {
        if (dist(pos, { x: c.x, y: c.y }) <= SNAP_ANCHOR_PX)
          return { time: c.time, price: c.price };
      }
    }
    return null;
  }

  private anchorPoints(e: ResolvedEntry): Array<{ x: number; y: number } & DataPoint> {
    const d = e.d;
    const out: Array<{ x: number; y: number } & DataPoint> = [];
    if (e.x1 != null && e.y1 != null && d.time != null) {
      out.push({ x: e.x1, y: e.y1, time: d.time, price: d.price });
    }
    if (e.x2 != null && e.y2 != null && d.time2 != null && d.price2 != null) {
      out.push({ x: e.x2, y: e.y2, time: d.time2, price: d.price2 });
    }
    if (e.x3 != null && e.y3 != null && d.time3 != null && d.price3 != null) {
      out.push({ x: e.x3, y: e.y3, time: d.time3, price: d.price3 });
    }
    return out;
  }

  /** Pixel position of the first anchor while placing a trendline. */
  private placementAnchorPx(): Pt | null {
    if (!this.placing || this.tool !== "trendline") return null;
    const x = timeToX(this.ctx(), this.placing.p1.time);
    const y = this.series.priceToCoordinate(this.placing.p1.price);
    return x !== null && y !== null ? { x, y } : null;
  }

  /** Pixel position of the anchor opposite the one being dragged. */
  private dragAnchorPx(drag: DragState): Pt | null {
    if (drag.origin.type !== "trendline" || drag.hit.region.kind !== "point") return null;
    const en = drag.originEntry;
    const movingP1 = drag.hit.region.timeKey === "time";
    const x = movingP1 ? en.x2 : en.x1;
    const y = movingP1 ? en.y2 : en.y1;
    return x !== null && y !== null ? { x, y } : null;
  }

  private magnetSnap(pt: DataPoint, cursorY: number): DataPoint {
    const candle = this.candleAt(pt.time);
    if (!candle) return pt;
    let bestPrice = pt.price;
    // Strong magnet always snaps to the nearest OHLC; weak only when close.
    let bestDist = this.magnetMode === "strong" ? Number.POSITIVE_INFINITY : MAGNET_THRESHOLD_PX;
    for (const price of [candle.open, candle.high, candle.low, candle.close]) {
      const y = this.series.priceToCoordinate(price);
      if (y === null) continue;
      const d = Math.abs(y - cursorY);
      if (d < bestDist) {
        bestDist = d;
        bestPrice = price;
      }
    }
    return { time: pt.time, price: bestPrice };
  }

  /** Binary search the series data for the bar at the given unix time. */
  private candleAt(time: number): OhlcBar | null {
    const data = this.series.data();
    let lo = 0;
    let hi = data.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = data[mid]!.time as number;
      if (t === time) return asOhlc(data[mid]!);
      if (t < time) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  // ── State helpers ──────────────────────────────────────────────────

  private removeSelected(): void {
    const ids = this.selectedIds;
    this.select([]);
    this.drawings = this.drawings.filter((d) => !ids.includes(d.id));
    this.primitive.setDrawings(this.drawings);
    for (const id of ids) this.cb.onRemove(id);
  }

  private select(ids: string[]): void {
    const same =
      ids.length === this.selectedIds.length && ids.every((id, i) => id === this.selectedIds[i]);
    if (same) return;
    this.selectedIds = ids;
    this.primitive.setSelected(ids);
    this.cb.onSelectionChange?.([...ids]);
  }

  private hoverHit(hit: Hit | null): void {
    const id = hit?.id ?? null;
    if (id !== this.hoveredId) {
      this.hoveredId = id;
      this.primitive.setHovered(id);
    }
    this.applyCursor(hit ? "pointer" : null);
  }

  private applyCursor(interactionCursor: "pointer" | "grabbing" | null): void {
    if (interactionCursor) {
      this.container.style.cursor = interactionCursor;
      return;
    }
    this.container.style.cursor = this.tool !== "none" ? "crosshair" : "";
  }
}

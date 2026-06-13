import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  ISeriesPrimitiveAxisView,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
} from "lightweight-charts";
import type { DrawingLine } from "../../../pages/trading/constants";
import { PluginBase } from "../plugin-base";
import { renderEntry } from "./renderers";
import { makeResolveCtx, resolveEntry } from "./resolve";
import type { DrawCtxInfo, EntryState, ResolvedEntry } from "./types";

class DrawingsPaneRenderer implements ISeriesPrimitivePaneRenderer {
  private readonly _entries: ResolvedEntry[];
  private readonly _info: DrawCtxInfo;

  constructor(entries: ResolvedEntry[], info: DrawCtxInfo) {
    this._entries = entries;
    this._info = info;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      for (const e of this._entries) renderEntry(scope, e, this._info);
    });
  }
}

class DrawingsPaneView implements ISeriesPrimitivePaneView {
  private readonly _source: DrawingsPrimitive;
  private _entries: ResolvedEntry[] = [];

  constructor(source: DrawingsPrimitive) {
    this._source = source;
  }

  update(): void {
    this._entries = this._source.resolveEntries();
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return new DrawingsPaneRenderer(this._entries, this._source.drawInfo());
  }
}

class PriceAxisLabelView implements ISeriesPrimitiveAxisView {
  private readonly _source: DrawingsPrimitive;
  private readonly _price: number;
  private readonly _color: string;
  private _y: number | null = null;

  constructor(source: DrawingsPrimitive, price: number, color: string) {
    this._source = source;
    this._price = price;
    this._color = color;
  }

  update(): void {
    this._y = this._source.series.priceToCoordinate(this._price);
  }

  coordinate(): number {
    return this._y ?? -1;
  }

  visible(): boolean {
    return this._y !== null;
  }

  tickVisible(): boolean {
    return true;
  }

  text(): string {
    return this._source.series.priceFormatter().format(this._price);
  }

  textColor(): string {
    return "#ffffff";
  }

  backColor(): string {
    return this._color;
  }
}

// Horizontal lines always label their price on the axis; other drawings show
// their anchor prices only while selected (TradingView behavior).
function appendAxisViews(
  views: PriceAxisLabelView[],
  d: DrawingLine,
  selectedIds: ReadonlySet<string>,
  source: DrawingsPrimitive,
): void {
  if (d.type === "horizontal") {
    views.push(new PriceAxisLabelView(source, d.price, d.color));
    return;
  }
  if (!selectedIds.has(d.id)) return;
  if (Number.isFinite(d.price)) views.push(new PriceAxisLabelView(source, d.price, d.color));
  if (d.price2 != null) views.push(new PriceAxisLabelView(source, d.price2, d.color));
}

/**
 * Single series primitive that renders every user drawing (plus the in-flight
 * preview) on one canvas pass. Interaction state (hover/selection) is pushed
 * in by DrawingToolsManager.
 */
export class DrawingsPrimitive extends PluginBase {
  private _drawings: DrawingLine[] = [];
  private _preview: DrawingLine | null = null;
  private _selectedIds: Set<string> = new Set();
  private _hoveredId: string | null = null;
  private _intervalSec = 60;
  private _accountEquity = 0;
  private readonly _paneViews = [new DrawingsPaneView(this)];
  private _axisViews: PriceAxisLabelView[] = [];

  setDrawings(drawings: DrawingLine[]): void {
    this._drawings = drawings;
    this._rebuildAxisViews();
    this.requestUpdate();
  }

  setPreview(d: DrawingLine | null): void {
    this._preview = d;
    this.requestUpdate();
  }

  setSelected(ids: readonly string[]): void {
    this._selectedIds = new Set(ids);
    this._rebuildAxisViews();
    this.requestUpdate();
  }

  setHovered(id: string | null): void {
    if (this._hoveredId === id) return;
    this._hoveredId = id;
    this.requestUpdate();
  }

  setAccountEquity(equity: number): void {
    if (this._accountEquity === equity) return;
    this._accountEquity = equity;
    this.requestUpdate();
  }

  /** Account context the position tool reads for its $-risk / size readout. */
  drawInfo(): DrawCtxInfo {
    return {
      accountEquity: this._accountEquity,
      priceFormat: (p: number) => this.series.priceFormatter().format(p),
    };
  }

  setIntervalSec(intervalSec: number): void {
    if (this._intervalSec === intervalSec) return;
    this._intervalSec = intervalSec;
    // The interval drives whitespace extrapolation of anchors past either data
    // edge — repaint so a timeframe switch re-resolves drawings immediately
    // rather than waiting for the next unrelated chart paint.
    this.requestUpdate();
  }

  updateAllViews(): void {
    for (const v of this._paneViews) v.update();
    for (const v of this._axisViews) v.update();
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this._paneViews;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this._axisViews;
  }

  resolveEntries(): ResolvedEntry[] {
    const ctx = makeResolveCtx(this.chart, this.series, this._intervalSec);
    const entries = this._drawings.map((d) => resolveEntry(d, ctx, this._stateFor(d.id)));
    if (this._preview) entries.push(resolveEntry(this._preview, ctx, "preview"));
    return entries;
  }

  private _stateFor(id: string): EntryState {
    if (this._selectedIds.has(id)) return "selected";
    if (id === this._hoveredId) return "hovered";
    return "normal";
  }

  private _rebuildAxisViews(): void {
    const views: PriceAxisLabelView[] = [];
    for (const d of this._drawings) appendAxisViews(views, d, this._selectedIds, this);
    this._axisViews = views;
  }
}

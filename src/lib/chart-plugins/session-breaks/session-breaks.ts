import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  DataChangedScope,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  SeriesPrimitivePaneViewZOrder,
  Time,
} from "lightweight-charts";
import { PluginBase } from "../plugin-base";

/**
 * Session Breaks — TradingView-style vertical dashed lines at the first bar
 * of each new trading session, separating one trading day's price action
 * from the next on intraday charts.
 *
 * Session reset rules:
 * - "utc-midnight": new session at 00:00 UTC (forex, crypto, metals, …)
 * - "ny-0930":      new session at 09:30 America/New_York (US equities RTH);
 *                   DST-aware via Intl, pre-market bars belong to the prior
 *                   session so the break lands exactly on the 09:30 bar.
 */
export type SessionStartRule = "utc-midnight" | "ny-0930";

export interface SessionBreaksOptions {
  color: string;
  /** Line width in media px. */
  width: number;
  /** Dash pattern in media px. */
  dash: number[];
  sessionStart: SessionStartRule;
}

const defaultOptions: SessionBreaksOptions = {
  color: "rgba(130, 150, 190, 0.5)",
  width: 1,
  dash: [5, 5],
  sessionStart: "utc-midnight",
};

const RTH_OPEN_MINUTES = 9 * 60 + 30; // 09:30 New York

class SessionBreaksPaneRenderer implements ISeriesPrimitivePaneRenderer {
  private readonly _xs: number[];
  private readonly _options: SessionBreaksOptions;

  constructor(xs: number[], options: SessionBreaksOptions) {
    this._xs = xs;
    this._options = options;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.save();
      ctx.strokeStyle = this._options.color;
      ctx.lineWidth = Math.max(1, this._options.width * scope.horizontalPixelRatio);
      ctx.setLineDash(this._options.dash.map((v) => v * scope.verticalPixelRatio));
      for (const x of this._xs) {
        const xb = Math.round(x * scope.horizontalPixelRatio);
        ctx.beginPath();
        ctx.moveTo(xb, 0);
        ctx.lineTo(xb, scope.bitmapSize.height);
        ctx.stroke();
      }
      ctx.restore();
    });
  }
}

class SessionBreaksPaneView implements ISeriesPrimitivePaneView {
  private readonly _source: SessionBreaks;
  private _xs: number[] = [];

  constructor(source: SessionBreaks) {
    this._source = source;
  }

  update(): void {
    const timeScale = this._source.chart.timeScale();
    const xs: number[] = [];
    for (const time of this._source.breakTimes()) {
      const x = timeScale.timeToCoordinate(time as Time);
      if (x !== null) xs.push(x);
    }
    this._xs = xs;
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return new SessionBreaksPaneRenderer(this._xs, this._source.options());
  }

  zOrder(): SeriesPrimitivePaneViewZOrder {
    return "bottom"; // behind candles, like TradingView session breaks
  }
}

export class SessionBreaks extends PluginBase {
  private readonly _options: SessionBreaksOptions;
  private readonly _paneViews: SessionBreaksPaneView[];
  private _breakTimes: number[] = [];
  private _nyFormatter: Intl.DateTimeFormat | null = null;
  // Incremental state so live tick updates don't rescan the whole series.
  private _lastBarTime = 0;
  private _lastSessionKey: number | null = null;

  constructor(options: Partial<SessionBreaksOptions> = {}) {
    super();
    this._options = { ...defaultOptions, ...options };
    this._paneViews = [new SessionBreaksPaneView(this)];
  }

  options(): SessionBreaksOptions {
    return this._options;
  }

  breakTimes(): readonly number[] {
    return this._breakTimes;
  }

  public override attached(param: Parameters<PluginBase["attached"]>[0]): void {
    super.attached(param);
    this._recomputeAll();
  }

  protected override dataUpdated(scope: DataChangedScope): void {
    if (scope === "update") this._appendLatest();
    else this._recomputeAll();
    this.requestUpdate();
  }

  updateAllViews(): void {
    for (const view of this._paneViews) view.update();
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this._paneViews;
  }

  // ── Session detection ──────────────────────────────────────────────

  private _recomputeAll(): void {
    const data = this.series.data();
    const breaks: number[] = [];
    let prevKey: number | null = null;
    let lastTime = 0;
    for (const bar of data) {
      const t = bar.time as number;
      const key = this._sessionKey(t);
      if (prevKey !== null && key !== prevKey) breaks.push(t);
      prevKey = key;
      lastTime = t;
    }
    this._breakTimes = breaks;
    this._lastSessionKey = prevKey;
    this._lastBarTime = lastTime;
  }

  /** O(1) handling of live bar updates — only the newest bar can add a break. */
  private _appendLatest(): void {
    const data = this.series.data();
    const last = data[data.length - 1];
    if (!last) return;
    const t = last.time as number;
    if (t === this._lastBarTime) return; // same bar ticking
    if (t < this._lastBarTime) {
      this._recomputeAll(); // out-of-order write — fall back to a full scan
      return;
    }
    const key = this._sessionKey(t);
    if (this._lastSessionKey !== null && key !== this._lastSessionKey) this._breakTimes.push(t);
    this._lastSessionKey = key;
    this._lastBarTime = t;
  }

  /** Bars with the same key belong to the same trading session. */
  private _sessionKey(timeSec: number): number {
    if (this._options.sessionStart === "utc-midnight") return Math.floor(timeSec / 86_400);
    return this._nySessionKey(timeSec);
  }

  // Key = the NY calendar day the session opened on; bars before 09:30 local
  // (pre-market / overnight) count toward the previous session.
  private _nySessionKey(timeSec: number): number {
    const p = this._nyParts(timeSec);
    let dayMs = Date.UTC(p.year, p.month - 1, p.day);
    if (p.minutesOfDay < RTH_OPEN_MINUTES) dayMs -= 86_400_000;
    return dayMs / 86_400_000;
  }

  private _nyParts(timeSec: number): {
    year: number;
    month: number;
    day: number;
    minutesOfDay: number;
  } {
    if (!this._nyFormatter) {
      this._nyFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        hourCycle: "h23",
      });
    }
    const fields: Record<string, number> = {};
    for (const part of this._nyFormatter.formatToParts(new Date(timeSec * 1000))) {
      if (part.type !== "literal") fields[part.type] = Number(part.value);
    }
    return {
      year: fields.year ?? 1970,
      month: fields.month ?? 1,
      day: fields.day ?? 1,
      minutesOfDay: (fields.hour ?? 0) * 60 + (fields.minute ?? 0),
    };
  }
}

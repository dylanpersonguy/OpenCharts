import type { ChartBar, ChartTheme, IndicatorLine, RenderChartType, ViewState } from './types';
import { DEFAULT_THEME } from './types';
import {
  barToX,
  clamp,
  computeYRange,
  formatPrice,
  formatTime,
  getVisibleRange,
  niceStep,
  priceToY,
  xToBar,
  yToPrice,
} from './utils';

// Layout constants
const PRICE_SCALE_WIDTH = 70;
const TIME_SCALE_HEIGHT = 26;
const VOLUME_HEIGHT_RATIO = 0.18;
const MIN_BAR_WIDTH = 2;
const MAX_BAR_WIDTH = 40;
const CROSSHAIR_DASH = [4, 3];

export class ChartEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;
  private width = 0;
  private height = 0;

  // Data
  private bars: ChartBar[] = [];
  private indicators: IndicatorLine[] = [];
  private chartType: RenderChartType = 'candlestick';
  private theme: ChartTheme = DEFAULT_THEME;

  // View state
  private view: ViewState = { scrollX: 0, barWidth: 8, yRange: null };

  // Crosshair state
  private mouseX = -1;
  private mouseY = -1;
  private showCrosshair = false;

  // Interaction state
  private isPanning = false;
  private panStartX = 0;
  private panStartScrollX = 0;

  // Callbacks
  private onCrosshairMove?: (bar: ChartBar | null, price: number) => void;

  // Animation
  private animFrame = 0;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.dpr = window.devicePixelRatio || 1;
    this.bindEvents();
    // Defer initial resize to next frame so the container has layout
    requestAnimationFrame(() => {
      if (!this.destroyed) {
        this.resize();
      }
    });
  }

  // ─── Public API ──────────────────────────────────────

  setData(bars: ChartBar[]): void {
    this.bars = bars;
    this.fitContent();
    this.requestRender();
  }

  updateBar(bar: ChartBar): void {
    if (this.bars.length === 0) {
      this.bars.push(bar);
    } else {
      const last = this.bars[this.bars.length - 1];
      if (last.time === bar.time) {
        this.bars[this.bars.length - 1] = bar;
      } else {
        this.bars.push(bar);
      }
    }
    this.requestRender();
  }

  setChartType(type: RenderChartType): void {
    this.chartType = type;
    this.requestRender();
  }

  setIndicators(indicators: IndicatorLine[]): void {
    this.indicators = indicators;
    this.requestRender();
  }

  setTheme(theme: Partial<ChartTheme>): void {
    this.theme = { ...DEFAULT_THEME, ...theme };
    this.requestRender();
  }

  onCrosshair(cb: (bar: ChartBar | null, price: number) => void): void {
    this.onCrosshairMove = cb;
  }

  fitContent(): void {
    const chartW = this.chartWidth();
    if (this.bars.length === 0 || chartW < 1) return;

    const visibleBars = Math.max(1, Math.floor(chartW / this.view.barWidth));
    this.view.scrollX = Math.max(0, this.bars.length - visibleBars + 5);
    this.view.yRange = null;
    this.requestRender();
  }

  resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) return;

    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.requestRender();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.animFrame);
    this.unbindEvents();
  }

  // ─── Layout helpers ──────────────────────────────────

  private chartWidth(): number {
    return this.width - PRICE_SCALE_WIDTH;
  }

  private chartHeight(): number {
    return this.height - TIME_SCALE_HEIGHT;
  }

  private mainChartHeight(): number {
    return this.chartHeight() * (1 - VOLUME_HEIGHT_RATIO);
  }

  private volumeChartTop(): number {
    return this.mainChartHeight();
  }

  private volumeChartHeight(): number {
    return this.chartHeight() * VOLUME_HEIGHT_RATIO;
  }

  // ─── Rendering ───────────────────────────────────────

  private requestRender(): void {
    if (this.destroyed) return;
    cancelAnimationFrame(this.animFrame);
    this.animFrame = requestAnimationFrame(() => this.render());
  }

  private render(): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    if (w < 1 || h < 1) return;
    const chartW = this.chartWidth();
    const chartH = this.chartHeight();
    const mainH = this.mainChartHeight();
    if (chartW < 1 || chartH < 1 || mainH < 1) return;

    // Background
    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, w, h);

    if (this.bars.length === 0) {
      this.drawWatermark(ctx, chartW, mainH);
      this.drawScaleBorders(ctx, chartW, chartH);
      return;
    }

    // Visible range
    const { startIdx, endIdx } = getVisibleRange(this.bars.length, chartW, this.view);
    const yRange = this.view.yRange || computeYRange(this.bars, startIdx, endIdx);
    const { min: yMin, max: yMax } = yRange;

    // Draw layers
    this.drawGrid(ctx, chartW, mainH, yMin, yMax);
    this.drawWatermark(ctx, chartW, mainH);
    this.drawVolume(ctx, chartW, startIdx, endIdx);
    this.drawMainSeries(ctx, chartW, mainH, startIdx, endIdx, yMin, yMax);
    this.drawIndicators(ctx, chartW, mainH, startIdx, endIdx, yMin, yMax);
    this.drawScaleBorders(ctx, chartW, chartH);
    this.drawPriceScale(ctx, chartW, mainH, yMin, yMax);
    this.drawTimeScale(ctx, chartW, chartH, startIdx, endIdx);
    this.drawLastPriceLine(ctx, chartW, mainH, yMin, yMax);

    if (this.showCrosshair && this.mouseX >= 0 && this.mouseX < chartW && this.mouseY >= 0 && this.mouseY < chartH) {
      this.drawCrosshair(ctx, chartW, chartH, mainH, yMin, yMax, startIdx);
    }
  }

  // ─── Grid ────────────────────────────────────────────

  private drawGrid(ctx: CanvasRenderingContext2D, chartW: number, mainH: number, yMin: number, yMax: number): void {
    ctx.strokeStyle = this.theme.gridLine;
    ctx.lineWidth = 1;

    // Horizontal grid lines
    const yStep = niceStep(yMax - yMin, 6);
    if (yStep > 0 && isFinite(yStep)) {
      const startY = Math.ceil(yMin / yStep) * yStep;
      const maxLines = 20;
      let drawn = 0;
      for (let p = startY; p <= yMax && drawn < maxLines; p += yStep, drawn++) {
        const y = Math.round(priceToY(p, yMin, yMax, mainH)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartW, y);
        ctx.stroke();
      }
    }

    // Vertical grid lines — every N bars
    const spacing = Math.max(1, Math.round(80 / this.view.barWidth));
    const { startIdx, endIdx } = getVisibleRange(this.bars.length, chartW, this.view);
    for (let i = startIdx; i <= endIdx; i += spacing) {
      const x = Math.round(barToX(i, this.view)) + 0.5;
      if (x < 0 || x > chartW) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, mainH);
      ctx.stroke();
    }
  }

  // ─── Watermark ───────────────────────────────────────

  private drawWatermark(ctx: CanvasRenderingContext2D, chartW: number, mainH: number): void {
    ctx.save();
    ctx.font = 'bold 52px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = this.theme.watermark;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('OpenCharts', chartW / 2, mainH / 2 - 10);
    ctx.font = '16px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('Open Source Charting', chartW / 2, mainH / 2 + 30);
    ctx.restore();
  }

  // ─── Main Series ─────────────────────────────────────

  private drawMainSeries(
    ctx: CanvasRenderingContext2D,
    chartW: number,
    mainH: number,
    startIdx: number,
    endIdx: number,
    yMin: number,
    yMax: number,
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, chartW, mainH);
    ctx.clip();

    switch (this.chartType) {
      case 'candlestick':
        this.drawCandlesticks(ctx, mainH, startIdx, endIdx, yMin, yMax);
        break;
      case 'line':
        this.drawLine(ctx, chartW, mainH, startIdx, endIdx, yMin, yMax);
        break;
      case 'area':
        this.drawArea(ctx, chartW, mainH, startIdx, endIdx, yMin, yMax);
        break;
    }

    ctx.restore();
  }

  private drawCandlesticks(
    ctx: CanvasRenderingContext2D,
    mainH: number,
    startIdx: number,
    endIdx: number,
    yMin: number,
    yMax: number,
  ): void {
    const bodyW = Math.max(1, this.view.barWidth * 0.7);

    for (let i = startIdx; i <= endIdx; i++) {
      const bar = this.bars[i];
      if (!bar) continue;

      const x = barToX(i, this.view);
      const isUp = bar.close >= bar.open;
      const color = isUp ? this.theme.upColor : this.theme.downColor;
      const wickColor = isUp ? this.theme.upWick : this.theme.downWick;

      const oY = priceToY(bar.open, yMin, yMax, mainH);
      const cY = priceToY(bar.close, yMin, yMax, mainH);
      const hY = priceToY(bar.high, yMin, yMax, mainH);
      const lY = priceToY(bar.low, yMin, yMax, mainH);

      // Wick
      ctx.strokeStyle = wickColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, hY);
      ctx.lineTo(Math.round(x) + 0.5, lY);
      ctx.stroke();

      // Body
      const top = Math.min(oY, cY);
      const bodyH = Math.max(1, Math.abs(oY - cY));
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x - bodyW / 2), top, bodyW, bodyH);
    }
  }

  private drawLine(
    ctx: CanvasRenderingContext2D,
    _chartW: number,
    mainH: number,
    startIdx: number,
    endIdx: number,
    yMin: number,
    yMax: number,
  ): void {
    ctx.strokeStyle = this.theme.lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    let started = false;
    for (let i = startIdx; i <= endIdx; i++) {
      const bar = this.bars[i];
      if (!bar) continue;
      const x = barToX(i, this.view);
      const y = priceToY(bar.close, yMin, yMax, mainH);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  private drawArea(
    ctx: CanvasRenderingContext2D,
    chartW: number,
    mainH: number,
    startIdx: number,
    endIdx: number,
    yMin: number,
    yMax: number,
  ): void {
    // Line
    const points: { x: number; y: number }[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const bar = this.bars[i];
      if (!bar) continue;
      points.push({ x: barToX(i, this.view), y: priceToY(bar.close, yMin, yMax, mainH) });
    }
    if (points.length < 2) return;

    // Fill
    const gradient = ctx.createLinearGradient(0, 0, 0, mainH);
    gradient.addColorStop(0, this.theme.areaTop);
    gradient.addColorStop(1, this.theme.areaBottom);

    ctx.beginPath();
    ctx.moveTo(points[0].x, mainH);
    for (const p of points) ctx.lineTo(p.x, p.y);
    ctx.lineTo(points[points.length - 1].x, mainH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Stroke
    ctx.strokeStyle = this.theme.lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }

  // ─── Volume ──────────────────────────────────────────

  private drawVolume(
    ctx: CanvasRenderingContext2D,
    chartW: number,
    startIdx: number,
    endIdx: number,
  ): void {
    const volTop = this.volumeChartTop();
    const volH = this.volumeChartHeight();

    // Find max volume in range
    let maxVol = 0;
    for (let i = startIdx; i <= endIdx; i++) {
      if (this.bars[i]) maxVol = Math.max(maxVol, this.bars[i].volume);
    }
    if (maxVol === 0) return;

    const barW = Math.max(1, this.view.barWidth * 0.7);

    for (let i = startIdx; i <= endIdx; i++) {
      const bar = this.bars[i];
      if (!bar) continue;

      const x = barToX(i, this.view);
      const h = (bar.volume / maxVol) * volH;
      const isUp = bar.close >= bar.open;

      ctx.fillStyle = isUp ? this.theme.volumeUp : this.theme.volumeDown;
      ctx.fillRect(Math.round(x - barW / 2), volTop + volH - h, barW, h);
    }

    // Top border line for volume pane
    ctx.strokeStyle = this.theme.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, volTop + 0.5);
    ctx.lineTo(chartW, volTop + 0.5);
    ctx.stroke();
  }

  // ─── Indicators ──────────────────────────────────────

  private drawIndicators(
    ctx: CanvasRenderingContext2D,
    chartW: number,
    mainH: number,
    startIdx: number,
    endIdx: number,
    yMin: number,
    yMax: number,
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, chartW, mainH);
    ctx.clip();

    for (const ind of this.indicators) {
      ctx.strokeStyle = ind.color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();

      let started = false;
      for (let i = startIdx; i <= endIdx; i++) {
        const val = ind.values[i];
        if (val === null || val === undefined) {
          started = false;
          continue;
        }
        const x = barToX(i, this.view);
        const y = priceToY(val, yMin, yMax, mainH);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  // ─── Last Price Line ─────────────────────────────────

  private drawLastPriceLine(
    ctx: CanvasRenderingContext2D,
    chartW: number,
    mainH: number,
    yMin: number,
    yMax: number,
  ): void {
    if (this.bars.length === 0) return;
    const last = this.bars[this.bars.length - 1];
    const y = priceToY(last.close, yMin, yMax, mainH);
    const isUp = last.close >= last.open;

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = isUp ? this.theme.upColor : this.theme.downColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(chartW, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // Price tag on the scale
    const tagW = PRICE_SCALE_WIDTH;
    const tagH = 20;
    ctx.fillStyle = isUp ? this.theme.upColor : this.theme.downColor;
    ctx.fillRect(chartW, Math.round(y) - tagH / 2, tagW, tagH);
    ctx.fillStyle = '#fff';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatPrice(last.close), chartW + tagW / 2, Math.round(y));
    ctx.restore();
  }

  // ─── Scale borders ───────────────────────────────────

  private drawScaleBorders(ctx: CanvasRenderingContext2D, chartW: number, chartH: number): void {
    ctx.strokeStyle = this.theme.scaleBorder;
    ctx.lineWidth = 1;

    // Right price scale border
    ctx.beginPath();
    ctx.moveTo(chartW + 0.5, 0);
    ctx.lineTo(chartW + 0.5, this.height);
    ctx.stroke();

    // Bottom time scale border
    ctx.beginPath();
    ctx.moveTo(0, chartH + 0.5);
    ctx.lineTo(this.width, chartH + 0.5);
    ctx.stroke();
  }

  // ─── Price Scale ─────────────────────────────────────

  private drawPriceScale(
    ctx: CanvasRenderingContext2D,
    chartW: number,
    mainH: number,
    yMin: number,
    yMax: number,
  ): void {
    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(chartW, 0, PRICE_SCALE_WIDTH, this.height);

    ctx.fillStyle = this.theme.textMuted;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const step = niceStep(yMax - yMin, 6);
    if (step > 0 && isFinite(step)) {
      const startP = Math.ceil(yMin / step) * step;
      let drawn = 0;
      for (let p = startP; p <= yMax && drawn < 20; p += step, drawn++) {
        const y = priceToY(p, yMin, yMax, mainH);
        if (y < 5 || y > mainH - 5) continue;
        ctx.fillText(formatPrice(p), chartW + PRICE_SCALE_WIDTH - 6, y);
      }
    }
  }

  // ─── Time Scale ──────────────────────────────────────

  private drawTimeScale(
    ctx: CanvasRenderingContext2D,
    chartW: number,
    chartH: number,
    startIdx: number,
    endIdx: number,
  ): void {
    const y = chartH + TIME_SCALE_HEIGHT / 2 + 2;

    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, chartH + 1, this.width, TIME_SCALE_HEIGHT);

    ctx.fillStyle = this.theme.textMuted;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const spacing = Math.max(1, Math.round(100 / this.view.barWidth));

    let prevTime: number | null = null;
    for (let i = startIdx; i <= endIdx; i += spacing) {
      const bar = this.bars[i];
      if (!bar) continue;
      const x = barToX(i, this.view);
      if (x < 30 || x > chartW - 30) continue;

      const label = formatTime(bar.time, prevTime);
      ctx.fillText(label, x, y);
      prevTime = bar.time;
    }
  }

  // ─── Crosshair ───────────────────────────────────────

  private drawCrosshair(
    ctx: CanvasRenderingContext2D,
    chartW: number,
    chartH: number,
    mainH: number,
    yMin: number,
    yMax: number,
    startIdx: number,
  ): void {
    const mx = this.mouseX;
    const my = this.mouseY;

    ctx.save();
    ctx.setLineDash(CROSSHAIR_DASH);
    ctx.strokeStyle = this.theme.crosshair;
    ctx.lineWidth = 1;

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(Math.round(mx) + 0.5, 0);
    ctx.lineTo(Math.round(mx) + 0.5, chartH);
    ctx.stroke();

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(0, Math.round(my) + 0.5);
    ctx.lineTo(chartW, Math.round(my) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // Price label on scale
    if (my < mainH) {
      const price = yToPrice(my, yMin, yMax, mainH);
      const labelText = formatPrice(price);
      const tagH = 20;
      ctx.fillStyle = this.theme.labelBg;
      ctx.fillRect(chartW, Math.round(my) - tagH / 2, PRICE_SCALE_WIDTH, tagH);
      ctx.fillStyle = this.theme.text;
      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, chartW + PRICE_SCALE_WIDTH / 2, Math.round(my));
    }

    // Time label on scale
    const barIdx = Math.round(xToBar(mx, this.view));
    if (barIdx >= 0 && barIdx < this.bars.length) {
      const bar = this.bars[barIdx];
      const d = new Date(bar.time * 1000);
      const timeLabel = d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const tw = ctx.measureText(timeLabel).width + 12;
      const tx = clamp(Math.round(mx) - tw / 2, 0, chartW - tw);
      ctx.fillStyle = this.theme.labelBg;
      ctx.fillRect(tx, chartH, tw, TIME_SCALE_HEIGHT);
      ctx.fillStyle = this.theme.text;
      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(timeLabel, tx + tw / 2, chartH + TIME_SCALE_HEIGHT / 2 + 2);

      // Callback
      this.onCrosshairMove?.(bar, my < mainH ? yToPrice(my, yMin, yMax, mainH) : 0);
    }

    ctx.restore();
  }

  // ─── Event handling ──────────────────────────────────

  private boundHandlers: [string, EventListener, AddEventListenerOptions][] = [];

  private bindEvents(): void {
    const add = (type: string, fn: EventListener, opts: AddEventListenerOptions = {}) => {
      this.boundHandlers.push([type, fn, opts]);
      this.canvas.addEventListener(type, fn, opts);
    };

    add('mousedown', this.onMouseDown.bind(this) as EventListener);
    add('mousemove', this.onMouseMove.bind(this) as EventListener);
    add('mouseup', this.onMouseUp.bind(this) as EventListener);
    add('mouseleave', this.onMouseLeave.bind(this) as EventListener);
    add('wheel', this.onWheel.bind(this) as EventListener, { passive: false });
    add('touchstart', this.onTouchStart.bind(this) as EventListener, { passive: true });
    add('touchmove', this.onTouchMove.bind(this) as EventListener, { passive: true });
    add('touchend', this.onTouchEnd.bind(this) as EventListener, { passive: true });
  }

  private unbindEvents(): void {
    for (const [type, fn, opts] of this.boundHandlers) {
      this.canvas.removeEventListener(type, fn, opts);
    }
    this.boundHandlers = [];
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    this.isPanning = true;
    this.panStartX = e.clientX;
    this.panStartScrollX = this.view.scrollX;
    this.canvas.style.cursor = 'grabbing';
  }

  private onMouseMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;
    this.showCrosshair = true;

    if (this.isPanning) {
      const dx = e.clientX - this.panStartX;
      this.view.scrollX = clamp(
        this.panStartScrollX - dx / this.view.barWidth,
        -10,
        Math.max(0, this.bars.length - 5),
      );
      this.view.yRange = null; // reset auto-scale on pan
    }

    this.requestRender();
  }

  private onMouseUp(_e: MouseEvent): void {
    this.isPanning = false;
    this.canvas.style.cursor = 'crosshair';
  }

  private onMouseLeave(_e: MouseEvent): void {
    this.isPanning = false;
    this.showCrosshair = false;
    this.canvas.style.cursor = 'crosshair';
    this.onCrosshairMove?.(null, 0);
    this.requestRender();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;

    // Zoom centered on mouse position
    const barUnderMouse = xToBar(mx, this.view);
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newBarWidth = clamp(this.view.barWidth * zoomFactor, MIN_BAR_WIDTH, MAX_BAR_WIDTH);

    // Adjust scrollX to keep the bar under mouse in place
    this.view.barWidth = newBarWidth;
    this.view.scrollX = barUnderMouse - (mx - newBarWidth / 2) / newBarWidth;
    this.view.scrollX = clamp(this.view.scrollX, -10, Math.max(0, this.bars.length - 5));
    this.view.yRange = null;

    this.requestRender();
  }

  // Touch support
  private lastTouchX = 0;
  private lastPinchDist = 0;

  private onTouchStart(e: TouchEvent): void {
    if (e.touches.length === 1) {
      this.isPanning = true;
      this.lastTouchX = e.touches[0].clientX;
      this.panStartScrollX = this.view.scrollX;
    } else if (e.touches.length === 2) {
      this.lastPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
    }
  }

  private onTouchMove(e: TouchEvent): void {
    if (e.touches.length === 1 && this.isPanning) {
      const dx = e.touches[0].clientX - this.lastTouchX;
      this.view.scrollX = clamp(
        this.view.scrollX - dx / this.view.barWidth,
        -10,
        Math.max(0, this.bars.length - 5),
      );
      this.lastTouchX = e.touches[0].clientX;
      this.view.yRange = null;
      this.requestRender();
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      if (this.lastPinchDist > 0) {
        const scale = dist / this.lastPinchDist;
        this.view.barWidth = clamp(this.view.barWidth * scale, MIN_BAR_WIDTH, MAX_BAR_WIDTH);
        this.view.yRange = null;
        this.requestRender();
      }
      this.lastPinchDist = dist;
    }
  }

  private onTouchEnd(_e: TouchEvent): void {
    this.isPanning = false;
    this.lastPinchDist = 0;
  }
}

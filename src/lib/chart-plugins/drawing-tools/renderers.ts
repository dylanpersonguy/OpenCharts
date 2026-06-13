import type { BitmapCoordinatesRenderingScope } from "fancy-canvas";
import type { DrawingLine, DrawingLineStyle } from "../../../pages/trading/constants";
import type { DrawCtxInfo, ResolvedEntry, ResolvedFibLevel } from "./types";

const HANDLE_RADIUS = 5;
const LINE_WIDTH = 2;
const FIB_BAND_ALPHA = 0.08;
const RECT_FILL_ALPHA = 0.14;

interface BPt {
  x: number;
  y: number;
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`;
}

function toBitmap(scope: BitmapCoordinatesRenderingScope, x: number, y: number): BPt {
  return {
    x: Math.round(x * scope.horizontalPixelRatio),
    y: Math.round(y * scope.verticalPixelRatio),
  };
}

function showHandles(e: ResolvedEntry): boolean {
  return e.state === "hovered" || e.state === "selected";
}

// Dash pattern (media px) for each drawing line style.
function dashFor(style: DrawingLineStyle | undefined): readonly number[] | undefined {
  if (style === "dashed") return [6, 6];
  if (style === "dotted") return [2, 3];
  return undefined;
}

function applyDash(
  scope: BitmapCoordinatesRenderingScope,
  dash: readonly number[] | undefined,
): void {
  if (!dash) return;
  scope.context.setLineDash(dash.map((v) => v * scope.horizontalPixelRatio));
}

function strokeLine(
  scope: BitmapCoordinatesRenderingScope,
  a: BPt,
  b: BPt,
  color: string,
  widthMedia: number,
  dash?: readonly number[],
): void {
  const ctx = scope.context;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = widthMedia * scope.verticalPixelRatio;
  applyDash(scope, dash);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function drawHandle(scope: BitmapCoordinatesRenderingScope, p: BPt, color: string): void {
  const ctx = scope.context;
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, HANDLE_RADIUS * scope.horizontalPixelRatio, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 1.5 * scope.horizontalPixelRatio;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

export function renderEntry(
  scope: BitmapCoordinatesRenderingScope,
  e: ResolvedEntry,
  info: DrawCtxInfo,
): void {
  switch (e.d.type) {
    case "trendline":
      renderTrendline(scope, e);
      break;
    case "horizontal":
      renderHorizontal(scope, e);
      break;
    case "rectangle":
      renderRectangle(scope, e);
      break;
    case "fibonacci":
      renderFibonacci(scope, e);
      break;
    case "position":
      renderPosition(scope, e, info);
      break;
    case "vertical":
      renderVertical(scope, e);
      break;
    case "channel":
      renderChannel(scope, e);
      break;
    case "ellipse":
      renderEllipse(scope, e);
      break;
    case "arrow":
      renderArrow(scope, e);
      break;
    case "triangle":
      renderTriangle(scope, e);
      break;
    case "text":
      renderText(scope, e);
      break;
    case "fibextension":
      renderFibonacci(scope, e);
      break;
    default:
      break;
  }
}

// ── Parity tools: vertical / channel / shapes / text ─────────────────────────

function renderVertical(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null) return;
  const x = Math.round(e.x1 * scope.horizontalPixelRatio);
  strokeLine(
    scope,
    { x, y: 0 },
    { x, y: scope.bitmapSize.height },
    e.d.color,
    e.d.width ?? 1.5,
    dashFor(e.d.lineStyle),
  );
  if (showHandles(e)) {
    drawHandle(scope, { x, y: Math.round(scope.bitmapSize.height / 2) }, e.d.color);
  }
}

// Parallel channel: the main anchor line plus a copy offset by (price3 − price1),
// with a translucent fill between them.
function renderChannel(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return;
  if (e.y3 == null) return;
  const dy = e.y3 - e.y1;
  const a1 = toBitmap(scope, e.x1, e.y1);
  const b1 = toBitmap(scope, e.x2, e.y2);
  const a2 = toBitmap(scope, e.x1, e.y3);
  const b2 = toBitmap(scope, e.x2, e.y2 + dy);
  const ctx = scope.context;
  ctx.save();
  ctx.fillStyle = hexToRgba(e.d.fillColor ?? e.d.color, e.d.fillOpacity ?? 0.1);
  ctx.beginPath();
  ctx.moveTo(a1.x, a1.y);
  ctx.lineTo(b1.x, b1.y);
  ctx.lineTo(b2.x, b2.y);
  ctx.lineTo(a2.x, a2.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const dash = dashFor(e.d.lineStyle);
  strokeLine(scope, a1, b1, e.d.color, e.d.width ?? LINE_WIDTH, dash);
  strokeLine(scope, a2, b2, e.d.color, e.d.width ?? LINE_WIDTH, dash);
  if (showHandles(e)) {
    drawHandle(scope, a1, e.d.color);
    drawHandle(scope, b1, e.d.color);
    drawHandle(scope, a2, e.d.color);
  }
}

function renderEllipse(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return;
  const a = toBitmap(scope, e.x1, e.y1);
  const b = toBitmap(scope, e.x2, e.y2);
  const ctx = scope.context;
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(e.d.fillColor ?? e.d.color, e.d.fillOpacity ?? RECT_FILL_ALPHA);
  ctx.fill();
  ctx.strokeStyle = e.d.color;
  ctx.lineWidth = (e.d.width ?? 1.5) * scope.verticalPixelRatio;
  applyDash(scope, dashFor(e.d.lineStyle));
  ctx.stroke();
  ctx.restore();
  if (showHandles(e)) drawRectHandles(scope, a, b, e.d.color);
}

function renderArrow(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return;
  const a = toBitmap(scope, e.x1, e.y1);
  const b = toBitmap(scope, e.x2, e.y2);
  strokeLine(scope, a, b, e.d.color, e.d.width ?? LINE_WIDTH, dashFor(e.d.lineStyle));
  drawArrowhead(scope, a, b, e.d.color);
  if (showHandles(e)) {
    drawHandle(scope, a, e.d.color);
    drawHandle(scope, b, e.d.color);
  }
}

function drawArrowhead(
  scope: BitmapCoordinatesRenderingScope,
  from: BPt,
  to: BPt,
  color: string,
): void {
  const ctx = scope.context;
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const len = 12 * scope.horizontalPixelRatio;
  const spread = Math.PI / 7;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - len * Math.cos(ang - spread), to.y - len * Math.sin(ang - spread));
  ctx.lineTo(to.x - len * Math.cos(ang + spread), to.y - len * Math.sin(ang + spread));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function renderTriangle(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return;
  const a = toBitmap(scope, e.x1, e.y1);
  const b = toBitmap(scope, e.x2, e.y2);
  const ctx = scope.context;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo((a.x + b.x) / 2, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(a.x, b.y);
  ctx.closePath();
  ctx.fillStyle = hexToRgba(e.d.fillColor ?? e.d.color, e.d.fillOpacity ?? RECT_FILL_ALPHA);
  ctx.fill();
  ctx.strokeStyle = e.d.color;
  ctx.lineWidth = (e.d.width ?? 1.5) * scope.verticalPixelRatio;
  applyDash(scope, dashFor(e.d.lineStyle));
  ctx.stroke();
  ctx.restore();
  if (showHandles(e)) {
    drawHandle(scope, a, e.d.color);
    drawHandle(scope, b, e.d.color);
  }
}

function textFont(d: ResolvedEntry["d"], sizePx: number): string {
  const style = d.italic ? "italic " : "";
  const weight = d.bold ? "bold " : "";
  return `${style}${weight}${Math.round(sizePx)}px sans-serif`;
}

function renderText(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null) return;
  const ctx = scope.context;
  const hpr = scope.horizontalPixelRatio;
  const size = (e.d.fontSize ?? 14) * scope.verticalPixelRatio;
  const lines = (e.d.text ?? "Text").split("\n");
  const at = toBitmap(scope, e.x1, e.y1);
  const lineH = size * 1.3;
  const pad = 4 * hpr;

  ctx.save();
  ctx.font = textFont(e.d, size);
  ctx.textBaseline = "top";

  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxW = textW + pad * 2;
  const boxH = lines.length * lineH + pad * 2;
  const bx = at.x - pad;
  const by = at.y - pad;

  if (e.d.textBg) {
    ctx.fillStyle = e.d.textBgColor ?? "#1e222d";
    ctx.fillRect(bx, by, boxW, boxH);
  }
  if (e.d.textBorder) {
    ctx.strokeStyle = e.d.textBorderColor ?? e.d.color;
    ctx.lineWidth = hpr;
    ctx.strokeRect(bx, by, boxW, boxH);
  }

  ctx.fillStyle = e.d.color;
  lines.forEach((l, i) => ctx.fillText(l, at.x, at.y + i * lineH));

  if (showHandles(e)) {
    ctx.strokeStyle = e.d.color;
    ctx.lineWidth = hpr;
    ctx.setLineDash([3 * hpr, 3 * hpr]);
    ctx.strokeRect(bx, by, boxW, boxH);
  }
  ctx.restore();
}

// ── Position tool (long/short risk-reward) ───────────────────────────────────

const POS_GREEN = "#089981";
const POS_RED = "#f23645";

function renderPosition(
  scope: BitmapCoordinatesRenderingScope,
  e: ResolvedEntry,
  info: DrawCtxInfo,
): void {
  const { x1, x2, y1, yStop, yTarget } = e;
  if (x1 === null || x2 === null || y1 === null || yStop == null || yTarget == null) return;
  const xa = Math.min(x1, x2);
  const xb = Math.max(x1, x2);
  posZone(scope, xa, xb, y1, yTarget, POS_GREEN);
  posZone(scope, xa, xb, y1, yStop, POS_RED);
  strokeLine(scope, toBitmap(scope, xa, y1), toBitmap(scope, xb, y1), "#d1d4dc", 1.5, [5, 3]);
  if (showHandles(e)) renderPositionHandles(scope, e, xa, xb, y1);
  const lines = positionReadout(e.d, info);
  if (lines.length > 0) {
    const at = toBitmap(scope, xb + 8, y1);
    drawLabelBox(scope, at.x, at.y, lines, e.d.color);
  }
}

function posZone(
  scope: BitmapCoordinatesRenderingScope,
  xa: number,
  xb: number,
  yFrom: number,
  yTo: number,
  color: string,
): void {
  const ctx = scope.context;
  const a = toBitmap(scope, xa, Math.min(yFrom, yTo));
  const b = toBitmap(scope, xb, Math.max(yFrom, yTo));
  ctx.save();
  ctx.fillStyle = hexToRgba(color, 0.12);
  ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.strokeStyle = hexToRgba(color, 0.6);
  ctx.lineWidth = scope.verticalPixelRatio;
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.restore();
}

function renderPositionHandles(
  scope: BitmapCoordinatesRenderingScope,
  e: ResolvedEntry,
  xa: number,
  xb: number,
  y1: number,
): void {
  const xm = (xa + xb) / 2;
  drawHandle(scope, toBitmap(scope, xm, y1), e.d.color);
  if (e.yTarget != null) drawHandle(scope, toBitmap(scope, xm, e.yTarget), e.d.color);
  if (e.yStop != null) drawHandle(scope, toBitmap(scope, xm, e.yStop), e.d.color);
  drawHandle(scope, toBitmap(scope, xb, y1), e.d.color);
}

function positionReadout(d: DrawingLine, info: DrawCtxInfo): string[] {
  if (d.stopPrice == null || d.targetPrice == null) return [];
  const reward = Math.abs(d.targetPrice - d.price);
  const risk = Math.abs(d.price - d.stopPrice);
  const rr = risk > 0 ? reward / risk : 0;
  const side = d.side === "short" ? "Short" : "Long";
  const lines = [
    `${side}  RR ${rr.toFixed(2)}`,
    `T ${info.priceFormat(d.targetPrice)}  ${signPct(d.targetPrice, d.price)}`,
    `S ${info.priceFormat(d.stopPrice)}  ${signPct(d.stopPrice, d.price)}`,
  ];
  if (info.accountEquity > 0 && risk > 0) {
    const riskAmt = (info.accountEquity * (d.riskPct ?? 1)) / 100;
    const qty = riskAmt / risk;
    lines.push(`Risk $${riskAmt.toFixed(0)} · Qty ${qty >= 100 ? qty.toFixed(0) : qty.toFixed(2)}`);
  }
  return lines;
}

function signPct(v: number, entry: number): string {
  if (entry === 0) return "0%";
  const p = ((v - entry) / entry) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
}

// Reusable dark readout box (position stats, text labels).
function drawLabelBox(
  scope: BitmapCoordinatesRenderingScope,
  x: number,
  y: number,
  lines: string[],
  borderColor: string,
): void {
  const ctx = scope.context;
  const hpr = scope.horizontalPixelRatio;
  const vpr = scope.verticalPixelRatio;
  ctx.save();
  ctx.font = `${Math.round(10 * vpr)}px monospace`;
  const lineH = 13 * vpr;
  const pad = 6 * hpr;
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const height = lines.length * lineH + pad;
  const bx = Math.min(x, scope.bitmapSize.width - width);
  const by = Math.min(Math.max(y, 0), scope.bitmapSize.height - height);
  ctx.fillStyle = "rgba(20, 24, 35, 0.92)";
  ctx.beginPath();
  ctx.roundRect(bx, by, width, height, 4 * hpr);
  ctx.fill();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#e0e3ea";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad / 2 + i * lineH));
  ctx.restore();
}

function renderTrendline(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return;
  const a = toBitmap(scope, e.x1, e.y1);
  const b = toBitmap(scope, e.x2, e.y2);
  const seg = e.seg ?? { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 };
  const sa = toBitmap(scope, seg.x1, seg.y1);
  const sb = toBitmap(scope, seg.x2, seg.y2);
  strokeLine(scope, sa, sb, e.d.color, e.d.width ?? LINE_WIDTH, dashFor(e.d.lineStyle));
  if (e.d.arrowEnd) drawArrowhead(scope, sa, sb, e.d.color);
  if (e.d.arrowStart) drawArrowhead(scope, sb, sa, e.d.color);
  if (showHandles(e)) {
    drawHandle(scope, a, e.d.color);
    drawHandle(scope, b, e.d.color);
    drawMidpointHandle(scope, a, b, e.d.color);
  }
  if (e.d.alertEnabled) {
    const right = a.x >= b.x ? a : b;
    drawAlertBadge(scope, right.x, right.y);
  }
  if (e.stats && e.stats.length > 0) drawStatsBox(scope, b, e.stats, e.d, a);
}

// Smaller square handle at the anchor midpoint — grabbing it body-drags the
// whole line (the hit-test already treats the line body as a move target).
function drawMidpointHandle(
  scope: BitmapCoordinatesRenderingScope,
  a: BPt,
  b: BPt,
  color: string,
): void {
  const ctx = scope.context;
  const half = 3 * scope.horizontalPixelRatio;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * scope.horizontalPixelRatio;
  ctx.beginPath();
  ctx.rect(mx - half, my - half, half * 2, half * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// Δprice / % / bars / angle readout near the second anchor (TV-style).
function drawStatsBox(
  scope: BitmapCoordinatesRenderingScope,
  at: BPt,
  stats: string[],
  d: { color: string },
  from: BPt,
): void {
  const ctx = scope.context;
  const hpr = scope.horizontalPixelRatio;
  const vpr = scope.verticalPixelRatio;
  const angleDeg = Math.round((Math.atan2(from.y - at.y, at.x - from.x) * 180) / Math.PI);
  const lines = [...stats, `${angleDeg}°`];
  ctx.save();
  ctx.font = `${Math.round(10 * vpr)}px monospace`;
  const lineH = 13 * vpr;
  const pad = 6 * hpr;
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const height = lines.length * lineH + pad;
  const x = Math.min(at.x + 10 * hpr, scope.bitmapSize.width - width);
  const y = Math.min(at.y + 10 * vpr, scope.bitmapSize.height - height);
  ctx.fillStyle = "rgba(20, 24, 35, 0.92)";
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 4 * hpr);
  ctx.fill();
  ctx.strokeStyle = d.color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#e0e3ea";
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    ctx.fillText(line, x + pad, y + pad / 2 + i * lineH);
  });
  ctx.restore();
}

function renderHorizontal(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.y1 === null) return;
  const y = Math.round(e.y1 * scope.verticalPixelRatio);
  strokeLine(
    scope,
    { x: 0, y },
    { x: scope.bitmapSize.width, y },
    e.d.color,
    e.d.width ?? 1.5,
    dashFor(e.d.lineStyle),
  );
  if (showHandles(e))
    drawHandle(scope, { x: Math.round(scope.bitmapSize.width / 2), y }, e.d.color);
  if (e.d.alertEnabled) {
    drawAlertBadge(scope, scope.bitmapSize.width - 14 * scope.horizontalPixelRatio, y);
  }
}

// Amber bell dot marking a line that fires an alert when price crosses it.
function drawAlertBadge(scope: BitmapCoordinatesRenderingScope, x: number, y: number): void {
  const ctx = scope.context;
  const r = 4 * scope.horizontalPixelRatio;
  ctx.save();
  ctx.fillStyle = "#f0b90b";
  ctx.strokeStyle = "#1b1f2a";
  ctx.lineWidth = scope.horizontalPixelRatio;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function renderRectangle(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return;
  const a = toBitmap(scope, e.x1, e.y1);
  const b = toBitmap(scope, e.x2, e.y2);
  const ctx = scope.context;
  ctx.save();
  ctx.fillStyle = hexToRgba(e.d.color, RECT_FILL_ALPHA);
  ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.strokeStyle = e.d.color;
  ctx.lineWidth = (e.d.width ?? 1.5) * scope.verticalPixelRatio;
  applyDash(scope, dashFor(e.d.lineStyle));
  ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.restore();
  if (showHandles(e)) drawRectHandles(scope, a, b, e.d.color);
}

function drawRectHandles(
  scope: BitmapCoordinatesRenderingScope,
  a: BPt,
  b: BPt,
  color: string,
): void {
  drawHandle(scope, a, color);
  drawHandle(scope, b, color);
  drawHandle(scope, { x: a.x, y: b.y }, color);
  drawHandle(scope, { x: b.x, y: a.y }, color);
}

function renderFibonacci(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.x2 === null || !e.fibLevels || e.fibLevels.length === 0) return;
  const xA = Math.round(Math.min(e.x1, e.x2) * scope.horizontalPixelRatio);
  const xB = Math.round(Math.max(e.x1, e.x2) * scope.horizontalPixelRatio);
  renderFibBands(scope, e.fibLevels, xA, xB);
  for (const lvl of e.fibLevels) renderFibLevel(scope, lvl, xA, xB);
  renderFibConnector(scope, e);
}

function renderFibBands(
  scope: BitmapCoordinatesRenderingScope,
  levels: ResolvedFibLevel[],
  xA: number,
  xB: number,
): void {
  const ctx = scope.context;
  for (let i = 0; i < levels.length - 1; i++) {
    const top = levels[i]!;
    const bottom = levels[i + 1]!;
    if (top.y === null || bottom.y === null) continue;
    const yA = Math.round(top.y * scope.verticalPixelRatio);
    const yB = Math.round(bottom.y * scope.verticalPixelRatio);
    ctx.fillStyle = hexToRgba(bottom.color, FIB_BAND_ALPHA);
    ctx.fillRect(xA, Math.min(yA, yB), xB - xA, Math.abs(yB - yA));
  }
}

function renderFibLevel(
  scope: BitmapCoordinatesRenderingScope,
  lvl: ResolvedFibLevel,
  xA: number,
  xB: number,
): void {
  if (lvl.y === null) return;
  const y = Math.round(lvl.y * scope.verticalPixelRatio);
  strokeLine(scope, { x: xA, y }, { x: xB, y }, lvl.color, 1);
  const ctx = scope.context;
  ctx.save();
  ctx.font = `${Math.round(10 * scope.verticalPixelRatio)}px monospace`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = lvl.color;
  ctx.fillText(lvl.label, xA - 6 * scope.horizontalPixelRatio, y);
  ctx.restore();
}

// Dashed diagonal between the two anchors, like TradingView's fib trend
// connector — also where the drag handles live.
function renderFibConnector(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return;
  const a = toBitmap(scope, e.x1, e.y1);
  const b = toBitmap(scope, e.x2, e.y2);
  strokeLine(scope, a, b, e.d.color, 1, [4, 4]);
  if (showHandles(e)) {
    drawHandle(scope, a, e.d.color);
    drawHandle(scope, b, e.d.color);
  }
}

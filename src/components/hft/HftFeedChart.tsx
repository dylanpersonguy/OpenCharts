/**
 * HftFeedChart — WP7-style dual-feed chart with full analytics suite
 *
 * Panels (top to bottom):
 *   1. PRICE — fast feed (cyan) vs slow feed (gray)
 *        Signal zone shading · Convergence target line · Lag bracket
 *        Position entry / TP / SL lines with P&L labels
 *   2. GAP — gap in pips over time
 *        Spread cost band · Net opportunity fill (bright) · Full gap fill (dim)
 *        Signal cross markers · Gap velocity readout · Stats overlay
 *   3. HISTOGRAM — gap magnitude distribution (last 60s)
 *        Green bars = bins above minPipGap threshold
 *   4. STATS ROW — avg, max, net opp, spread, velocity, lag
 */
import { memo, useMemo, useRef, useLayoutEffect } from "react";
import type { GapStats } from "../../hooks/useHftBot";
import type { Position } from "../../services/schemas";
import { cn } from "../../lib/utils";

// ── Layout ──────────────────────────────────────────────────────
const VW    = 920;
const PAD_L = 58;
const PAD_R = 8;
const CW    = VW - PAD_L - PAD_R;

const PH      = 200;   // price panel height
const GH      = 114;   // gap panel height
const HIST_H  = 48;    // histogram height
const DIV     = 8;     // divider between panels
const TOTAL_H  = PH + DIV + GH + DIV + HIST_H;
// Extra height for histogram x-axis labels that fall below TOTAL_H
const CANVAS_H = TOTAL_H + 12;

// Y offsets — price panel
const PY0 = 8;
const PY1 = PH - 2;

// Y offsets — gap panel
const G_OFF = PH + DIV;
const GY0   = G_OFF + 6;    // chart top
const GY1   = G_OFF + GH - 22; // chart bottom (leaves room for time labels)

// Y offsets — histogram
const H_OFF = G_OFF + GH + DIV;
const HY0   = H_OFF + 14;   // bar top
const HY1   = TOTAL_H - 2;  // bar bottom

// Helpers
function lerp(v: number, a: number, b: number, c: number, d: number) {
  if (b === a) return (c + d) / 2;
  return c + ((v - a) / (b - a)) * (d - c);
}
function fmt(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}
function polyline(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
}
function fillArea(ctx: CanvasRenderingContext2D, pts: [number, number][], zeroY: number) {
  if (pts.length < 2) return;
  const x0 = pts[0]![0];
  const xN = pts[pts.length - 1]![0];
  ctx.moveTo(x0, zeroY);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.lineTo(xN, zeroY);
  ctx.closePath();
}

interface Props {
  stat: GapStats;
  minPipGap: number;
  /** Open positions for this symbol — used for trade overlay lines */
  openPositions?: Position[];
}

export const HftFeedChart = memo(function HftFeedChart({
  stat,
  minPipGap,
  openPositions = [],
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const h = stat.history;
  // Stable reference — only recomputes when openPositions array or the symbol changes,
  // not on every render. Without this memo, `chart` useMemo would recompute on every render.
  const posForSym = useMemo(
    () => openPositions.filter((p) => p.symbolName === stat.symbol),
    [openPositions, stat.symbol],
  );

  const chart = useMemo(() => {
    if (h.length < 2) return null;

    const tsMin = h[0]!.ts;
    const tsMax = h[h.length - 1]!.ts;
    const toX = (ts: number) => PAD_L + lerp(ts, tsMin, tsMax, 0, CW);

    // ── PRICE PANEL Y-SCALE ───────────────────────────────────────
    // Expand range to include all position levels so lines stay visible
    const posLevels = posForSym.flatMap((p) => [
      p.entryPrice,
      ...(p.takeProfit != null ? [p.takeProfit] : []),
      ...(p.stopLoss != null ? [p.stopLoss] : []),
    ]);
    const priceVals = [
      ...h.filter((s) => s.liveMid > 0).map((s) => s.liveMid),
      ...h.filter((s) => s.delayedMid > 0).map((s) => s.delayedMid),
      ...posLevels,
    ];
    if (priceVals.length === 0) return null;

    const pRaw0 = Math.min(...priceVals);
    const pRaw1 = Math.max(...priceVals);
    const pPad  = Math.max((pRaw1 - pRaw0) * 0.20, 0.5);
    const pLow  = pRaw0 - pPad;
    const pHigh = pRaw1 + pPad;
    const toYp  = (p: number) => lerp(p, pHigh, pLow, PY0, PY1);

    const livePts: [number, number][] = h
      .filter((s) => s.liveMid > 0)
      .map((s) => [toX(s.ts), toYp(s.liveMid)]);
    const slwPts: [number, number][] = h
      .filter((s) => s.delayedMid > 0)
      .map((s) => [toX(s.ts), toYp(s.delayedMid)]);

    // 4 evenly-spaced Y-axis price labels
    const priceLabels = [0, 1, 2, 3].map((i) => {
      const v = pLow + (pHigh - pLow) * (i / 3);
      return { y: toYp(v), label: v.toFixed(5) };
    });

    // Signal zones in price panel (shaded background where |gap| ≥ threshold)
    type Zone = { x0: number; x1: number; pos: boolean };
    const sigZones: Zone[] = [];
    let zStart: number | null = null;
    let zPos = true;
    for (let i = 0; i < h.length; i++) {
      const s = h[i]!;
      const above = Math.abs(s.gapPips) >= minPipGap;
      if (above && zStart === null) { zStart = s.ts; zPos = s.gapPips > 0; }
      else if (!above && zStart !== null) {
        sigZones.push({ x0: toX(zStart), x1: toX(h[i - 1]!.ts), pos: zPos });
        zStart = null;
      }
    }
    if (zStart !== null) sigZones.push({ x0: toX(zStart), x1: toX(tsMax), pos: zPos });

    // Convergence target (where slow feed will reach = current live price)
    const targetY   = toYp(stat.livePrice);
    const slowEndY  = toYp(stat.accountPrice);

    // Position overlay lines
    const posLines = posForSym.map((p) => ({
      entryY: toYp(p.entryPrice),
      tpY:    p.takeProfit != null ? toYp(p.takeProfit) : null,
      slY:    p.stopLoss   != null ? toYp(p.stopLoss)   : null,
      side:   p.side,
      qty:    p.quantity,
      pnl:    p.unrealizedPnl,
      tp:     p.takeProfit,
      sl:     p.stopLoss,
    }));

    // ── GAP PANEL Y-SCALE ─────────────────────────────────────────
    const absGaps = h.map((s) => Math.abs(s.gapPips));
    const rawMax  = Math.max(Math.max(...absGaps, 0), minPipGap * 1.9, 1);
    const gLow = -rawMax; const gHigh = rawMax;
    const toYg   = (g: number) => lerp(g, gHigh, gLow, GY0, GY1);
    const zeroY  = toYg(0);
    const tpY    = toYg(minPipGap);
    const tnY    = toYg(-minPipGap);

    // Spread cost band bounds
    const spHalf = stat.spreadPips / 2;
    const spTopY = toYg(spHalf);
    const spBotY = toYg(-spHalf);

    // Gap area points (full, dim)
    const gPts: [number, number][] = h.map((s) => [toX(s.ts), toYg(s.gapPips)]);

    // Net opportunity points — gap above spread cost (bright fill)
    const nPts: [number, number][] = h.map((s) => {
      const abs = Math.abs(s.gapPips);
      const net = Math.max(0, abs - spHalf * 2) * (s.gapPips >= 0 ? 1 : -1);
      return [toX(s.ts), toYg(net)] as [number, number];
    });

    // Signal threshold crossing markers (vertical lines in gap panel)
    const crossMarkers: { x: number; pos: boolean }[] = [];
    for (let i = 1; i < h.length; i++) {
      const prev = h[i - 1]!; const curr = h[i]!;
      if (Math.abs(prev.gapPips) < minPipGap && Math.abs(curr.gapPips) >= minPipGap)
        crossMarkers.push({ x: toX(curr.ts), pos: curr.gapPips > 0 });
    }

    // Gap velocity (pips/second) over last ~5 samples
    let velocity = 0;
    const n = h.length;
    if (n >= 4) {
      const a = h[Math.max(0, n - 5)]!; const b = h[n - 1]!;
      const dtSec = (b.ts - a.ts) / 1000;
      if (dtSec > 0.1) velocity = (b.gapPips - a.gapPips) / dtSec;
    }

    // Pip Y-axis labels
    const pipLabels = [gHigh, minPipGap, 0, -minPipGap, gLow]
      .filter((v, i, a) => a.indexOf(v) === i)
      .map((v) => ({ y: toYg(v), label: v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1) }));

    // ── HISTOGRAM ────────────────────────────────────────────────
    const N_BINS = Math.max(Math.ceil(rawMax + 1), 8);
    const bins   = new Array(N_BINS).fill(0) as number[];
    for (const s of h) {
      const b = Math.min(Math.floor(Math.abs(s.gapPips)), N_BINS - 1);
      bins[b]!++;
    }
    const maxBin = Math.max(...bins, 1);
    const binW   = CW / N_BINS;

    // Time labels (5 evenly spaced)
    const timeLabels = [0, 1, 2, 3, 4].map((i) => {
      const ts = tsMin + ((tsMax - tsMin) * i) / 4;
      return { x: toX(ts), label: fmt(ts) };
    });

    // Current snapshot values
    const lastGap = h[n - 1]!.gapPips;
    const lastGapY = toYg(lastGap);
    const lastX    = toX(tsMax);
    const isSig    = Math.abs(lastGap) >= minPipGap;
    const netOpp   = Math.max(0, Math.abs(lastGap) - spHalf * 2);

    // Dynamic threshold: show the rolling avg that the threshold is derived from
    const isDynamic   = stat.dynamicThreshold != null;
    const avgGapPosY  = isDynamic && stat.avgGapPips > 0 ? toYg(stat.avgGapPips) : null;
    const avgGapNegY  = isDynamic && stat.avgGapPips > 0 ? toYg(-stat.avgGapPips) : null;

    return {
      livePts, slwPts, priceLabels, sigZones, targetY, slowEndY, posLines,
      gPts, nPts, zeroY, tpY, tnY, spTopY, spBotY,
      crossMarkers, velocity, pipLabels,
      bins, maxBin, binW, N_BINS,
      timeLabels, lastGap, lastGapY, lastX, isSig, netOpp,
      isDynamic, avgGapPosY, avgGapNegY,
    };
  }, [h, minPipGap, stat, posForSym]);

  // Canvas draw — fires whenever geometry changes (i.e. each tick, capped at 60fps by RAF)
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !chart) return;

    const dpr = window.devicePixelRatio || 1;
    // Only resize the backing store when dimensions actually change (avoids GPU texture
    // reallocation and a synchronous browser layout on every tick).
    if (canvas.width !== VW * dpr || canvas.height !== CANVAS_H * dpr) {
      canvas.width  = VW * dpr;
      canvas.height = CANVAS_H * dpr;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // setTransform resets the matrix to dpr-scale without accumulating; safe to call
    // every draw whether or not the canvas was resized above.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, VW, CANVAS_H);

    const {
      livePts, slwPts, priceLabels, sigZones, targetY, slowEndY, posLines,
      gPts, nPts, zeroY, tpY, tnY, spTopY, spBotY,
      crossMarkers, velocity, pipLabels,
      bins, maxBin, binW, N_BINS,
      timeLabels, lastGap, lastGapY, lastX, isSig,
      isDynamic, avgGapPosY, avgGapNegY,
    } = chart;

    const velColor = velocity > 0.15 ? "#0ecb81" : velocity < -0.15 ? "#f6465d" : "#94a3b8";
    const velIcon  = velocity > 0.15 ? "▲" : velocity < -0.15 ? "▼" : "─";

    // ══ PRICE PANEL ══════════════════════════════════════════

    ctx.fillStyle = "rgba(255,255,255,0.015)";
    ctx.fillRect(PAD_L, PY0, CW, PY1 - PY0);

    for (const z of sigZones) {
      const x = Math.max(z.x0, PAD_L);
      const w = Math.max(0, Math.min(z.x1, PAD_L + CW) - x);
      if (w > 0) {
        ctx.fillStyle = z.pos ? "rgba(14,203,129,0.08)" : "rgba(246,70,93,0.08)";
        ctx.fillRect(x, PY0, w, PY1 - PY0);
      }
    }

    for (const { y, label } of priceLabels) {
      ctx.strokeStyle = "#1e293b"; ctx.lineWidth = 0.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(PAD_L + CW, y); ctx.stroke();
      ctx.strokeStyle = "#334155"; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(PAD_L - 4, y); ctx.lineTo(PAD_L, y); ctx.stroke();
      ctx.fillStyle = "#64748b"; ctx.font = "7.5px monospace"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText(label, PAD_L - 6, y);
    }

    ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 0.8; ctx.setLineDash([3, 2]); ctx.globalAlpha = 0.45;
    ctx.beginPath(); ctx.moveTo(PAD_L, targetY); ctx.lineTo(PAD_L + CW, targetY); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 0.65;
    ctx.fillStyle = "#22d3ee"; ctx.font = "7px monospace"; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
    ctx.fillText("conv. target", PAD_L + CW - 2, targetY - 3);
    ctx.globalAlpha = 1;

    if (Math.abs(targetY - slowEndY) > 6) {
      // Lag bracket drawn 12px inside the right edge so it and its label stay within canvas bounds
      const bkX = PAD_L + CW - 12;
      ctx.globalAlpha = 0.45; ctx.strokeStyle = "#64748b"; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(bkX, targetY); ctx.lineTo(bkX, slowEndY);
      ctx.moveTo(bkX - 2, targetY); ctx.lineTo(bkX + 2, targetY);
      ctx.moveTo(bkX - 2, slowEndY); ctx.lineTo(bkX + 2, slowEndY);
      ctx.stroke();
      ctx.fillStyle = "#64748b"; ctx.font = "6.5px monospace"; ctx.textAlign = "right";
      ctx.fillText(`${(stat.measuredLagMs / 1000).toFixed(0)}s`, bkX - 4, (targetY + slowEndY) / 2 + 2);
      ctx.globalAlpha = 1;
    }

    for (const p of posLines) {
      const isLong = p.side === "LONG";
      const eColor = isLong ? "#0ecb81" : "#f6465d";
      if (p.slY !== null) {
        ctx.strokeStyle = "#f6465d"; ctx.lineWidth = 0.9; ctx.setLineDash([5, 3]); ctx.globalAlpha = 0.75;
        ctx.beginPath(); ctx.moveTo(PAD_L, p.slY); ctx.lineTo(PAD_L + CW, p.slY); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 0.85;
        ctx.fillStyle = "#f6465d"; ctx.font = "6.5px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        ctx.fillText(`SL ${p.sl?.toFixed(5) ?? ""}`, PAD_L + 4, p.slY + 8);
        ctx.globalAlpha = 1;
      }
      if (p.tpY !== null) {
        ctx.strokeStyle = "#0ecb81"; ctx.lineWidth = 0.9; ctx.setLineDash([5, 3]); ctx.globalAlpha = 0.75;
        ctx.beginPath(); ctx.moveTo(PAD_L, p.tpY); ctx.lineTo(PAD_L + CW, p.tpY); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 0.85;
        ctx.fillStyle = "#0ecb81"; ctx.font = "6.5px monospace"; ctx.textAlign = "left";
        ctx.fillText(`TP ${p.tp?.toFixed(5) ?? ""}`, PAD_L + 4, p.tpY - 2);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = eColor; ctx.lineWidth = 1; ctx.setLineDash([4, 2]); ctx.globalAlpha = 0.65;
      ctx.beginPath(); ctx.moveTo(PAD_L, p.entryY); ctx.lineTo(PAD_L + CW, p.entryY); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = isLong ? "rgba(14,203,129,0.2)" : "rgba(246,70,93,0.2)";
      ctx.fillRect(PAD_L + CW - 58, p.entryY - 8, 58, 14);
      ctx.fillStyle = eColor; ctx.font = "bold 7.5px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`${isLong ? "BUY" : "SELL"} ${p.qty}L`, PAD_L + CW - 29, p.entryY);
      if (p.pnl !== 0) {
        ctx.fillStyle = p.pnl >= 0 ? "#0ecb81" : "#f6465d"; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
        ctx.fillText(`${p.pnl >= 0 ? "+" : ""}${p.pnl.toFixed(2)}`, PAD_L + CW - 2, p.entryY + 13);
      }
    }

    ctx.strokeStyle = "#64748b"; ctx.lineWidth = 1.5; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.setLineDash([]);
    ctx.beginPath(); polyline(ctx, slwPts); ctx.stroke();
    ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 2;
    ctx.beginPath(); polyline(ctx, livePts); ctx.stroke();

    ctx.fillStyle = "#94a3b8"; ctx.font = "bold 8px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText("PRICE (FAST vs SLOW)", PAD_L + 4, PY0 + 12);
    ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PAD_L + CW - 112, PY0 + 14); ctx.lineTo(PAD_L + CW - 96, PY0 + 14); ctx.stroke();
    ctx.fillStyle = "#22d3ee"; ctx.font = "7.5px monospace";
    ctx.fillText("Fast feed", PAD_L + CW - 94, PY0 + 17);
    ctx.strokeStyle = "#64748b"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(PAD_L + CW - 50, PY0 + 14); ctx.lineTo(PAD_L + CW - 34, PY0 + 14); ctx.stroke();
    ctx.fillStyle = "#64748b"; ctx.fillText("Slow feed", PAD_L + CW - 32, PY0 + 17);
    ctx.strokeStyle = "#1e293b"; ctx.lineWidth = 1; ctx.strokeRect(PAD_L, PY0, CW, PY1 - PY0);

    // ══ DIVIDER ══════════════════════════════════════════════
    ctx.fillStyle = "#0f172a"; ctx.fillRect(0, PH, VW, DIV);

    // ══ GAP PANEL ════════════════════════════════════════════

    ctx.fillStyle = "rgba(255,255,255,0.015)"; ctx.fillRect(PAD_L, GY0, CW, GY1 - GY0);
    if (spBotY > spTopY) {
      ctx.fillStyle = "rgba(148,163,184,0.10)"; ctx.fillRect(PAD_L, spTopY, CW, spBotY - spTopY);
    }

    ctx.strokeStyle = "#1e293b"; ctx.lineWidth = 0.5; ctx.setLineDash([2, 4]);
    for (const { y, label } of pipLabels) {
      if (label !== "0") { ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(PAD_L + CW, y); ctx.stroke(); }
    }
    ctx.setLineDash([]);
    for (const { y, label } of pipLabels) {
      ctx.strokeStyle = "#334155"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD_L - 4, y); ctx.lineTo(PAD_L, y); ctx.stroke();
      const v = parseFloat(label);
      ctx.fillStyle = label === "0" ? "#94a3b8" : v > 0 ? "#0ecb81" : "#f6465d";
      ctx.font = "7.5px monospace"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText(label, PAD_L - 6, y);
    }

    ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 0.8; ctx.setLineDash([4, 3]); ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(PAD_L, tpY); ctx.lineTo(PAD_L + CW, tpY);
    ctx.moveTo(PAD_L, tnY); ctx.lineTo(PAD_L + CW, tnY);
    ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#f59e0b"; ctx.font = "7px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const threshLabel = isDynamic ? "dyn" : "threshold";
    ctx.fillText(`+${minPipGap.toFixed(1)}p ${threshLabel}`, PAD_L + 2, tpY - 2);
    ctx.fillText(`−${minPipGap.toFixed(1)}p ${threshLabel}`, PAD_L + 2, tnY + 8);
    ctx.globalAlpha = 1;

    // Average gap reference lines — only drawn when dynamic threshold is active
    // Shows the rolling 60s average that the dynamic threshold is derived from
    if (isDynamic && avgGapPosY != null && avgGapNegY != null) {
      ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 0.7; ctx.setLineDash([6, 4]); ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(PAD_L, avgGapPosY); ctx.lineTo(PAD_L + CW, avgGapPosY);
      ctx.moveTo(PAD_L, avgGapNegY); ctx.lineTo(PAD_L + CW, avgGapNegY);
      ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#22d3ee"; ctx.font = "6.5px monospace"; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
      ctx.fillText(`avg ${stat.avgGapPips.toFixed(1)}p`, PAD_L + CW - 2, avgGapPosY - 2);
      ctx.fillText(`avg −${stat.avgGapPips.toFixed(1)}p`, PAD_L + CW - 2, avgGapNegY + 8);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = "#334155"; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(PAD_L, zeroY); ctx.lineTo(PAD_L + CW, zeroY); ctx.stroke();

    ctx.save();
    ctx.beginPath(); ctx.rect(PAD_L, GY0, CW, Math.max(0, zeroY - GY0)); ctx.clip();
    ctx.fillStyle = "rgba(14,203,129,0.10)"; ctx.beginPath(); fillArea(ctx, gPts, zeroY); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(PAD_L, zeroY, CW, Math.max(0, GY1 - zeroY)); ctx.clip();
    ctx.fillStyle = "rgba(246,70,93,0.10)"; ctx.beginPath(); fillArea(ctx, gPts, zeroY); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(PAD_L, GY0, CW, Math.max(0, zeroY - GY0)); ctx.clip();
    ctx.fillStyle = "rgba(14,203,129,0.38)"; ctx.beginPath(); fillArea(ctx, nPts, zeroY); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(PAD_L, zeroY, CW, Math.max(0, GY1 - zeroY)); ctx.clip();
    ctx.fillStyle = "rgba(246,70,93,0.38)"; ctx.beginPath(); fillArea(ctx, nPts, zeroY); ctx.fill();
    ctx.restore();

    for (const m of crossMarkers) {
      ctx.strokeStyle = m.pos ? "#0ecb81" : "#f6465d"; ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(m.x, GY0); ctx.lineTo(m.x, GY1); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = m.pos ? "#0ecb81" : "#f6465d"; ctx.font = "7.5px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText(m.pos ? "BUY↑" : "SELL↓", m.x + 2, GY0 + 11);
    }

    ctx.strokeStyle = lastGap >= 0 ? "#0ecb81" : "#f6465d"; ctx.lineWidth = 1.8; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.setLineDash([]);
    ctx.beginPath(); polyline(ctx, gPts); ctx.stroke();

    if (isSig) {
      // Clamp badge to stay within the chart area — SVG had overflow:visible but canvas clips
      const BADGE_W = 42;
      const badgeX = Math.min(lastX + 2, PAD_L + CW - BADGE_W);
      ctx.fillStyle = lastGap >= 0 ? "rgba(14,203,129,0.2)" : "rgba(246,70,93,0.2)";
      ctx.fillRect(badgeX, lastGapY - 8, BADGE_W, 14);
      ctx.strokeStyle = lastGap >= 0 ? "#0ecb81" : "#f6465d"; ctx.lineWidth = 0.5;
      ctx.strokeRect(badgeX, lastGapY - 8, BADGE_W, 14);
      ctx.fillStyle = lastGap >= 0 ? "#0ecb81" : "#f6465d"; ctx.font = "bold 8px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`${lastGap > 0 ? "+" : ""}${lastGap.toFixed(1)}p`, badgeX + BADGE_W / 2, lastGapY);
    }

    ctx.fillStyle = "#94a3b8"; ctx.font = "bold 8px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText("GAP (pips)", PAD_L + 4, GY0 + 12);
    ctx.fillStyle = velColor; ctx.font = "600 8px monospace";
    ctx.fillText(`${velIcon} ${Math.abs(velocity).toFixed(2)}p/s`, PAD_L + 74, GY0 + 12);

    if (isSig) {
      ctx.fillStyle = lastGap >= 0 ? "rgba(14,203,129,0.28)" : "rgba(246,70,93,0.28)";
      ctx.fillRect(PAD_L + CW - 56, GY0 + 1, 56, 13);
      ctx.strokeStyle = lastGap >= 0 ? "#0ecb81" : "#f6465d"; ctx.lineWidth = 0.5;
      ctx.strokeRect(PAD_L + CW - 56, GY0 + 1, 56, 13);
      ctx.fillStyle = lastGap >= 0 ? "#0ecb81" : "#f6465d"; ctx.font = "bold 8px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("▶ SIGNAL", PAD_L + CW - 28, GY0 + 8);
    }

    ctx.strokeStyle = "#1e293b"; ctx.lineWidth = 1; ctx.strokeRect(PAD_L, GY0, CW, GY1 - GY0);

    ctx.strokeStyle = "#334155"; ctx.lineWidth = 1;
    ctx.fillStyle = "#475569"; ctx.font = "7.5px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    for (const { x, label } of timeLabels) {
      ctx.beginPath(); ctx.moveTo(x, GY1); ctx.lineTo(x, GY1 + 4); ctx.stroke();
      ctx.fillText(label, x, GY1 + 13);
    }

    // ══ SECOND DIVIDER ═══════════════════════════════════════
    ctx.fillStyle = "#0f172a"; ctx.fillRect(0, G_OFF + GH, VW, DIV);

    // ══ HISTOGRAM ════════════════════════════════════════════
    ctx.fillStyle = "#64748b"; ctx.font = "600 7.5px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText("GAP DISTRIBUTION (pip frequency, last 60s)", PAD_L, H_OFF + 10);

    for (let i = 0; i < N_BINS; i++) {
      const count = bins[i] ?? 0;
      const barH = maxBin > 0 ? (count / maxBin) * (HY1 - HY0) : 0;
      const bx = PAD_L + i * binW;
      ctx.fillStyle = i >= Math.floor(minPipGap) ? "rgba(14,203,129,0.55)" : "rgba(100,116,139,0.28)";
      if (barH > 0) ctx.fillRect(bx + 1, HY1 - barH, Math.max(0, binW - 2), barH);
      if (i === 0 || i % 2 === 0) {
        ctx.fillStyle = "#475569"; ctx.font = "6.5px monospace"; ctx.textAlign = "center";
        ctx.fillText(String(i), bx + binW / 2, HY1 + 9);
      }
    }

    const threshBin = Math.floor(minPipGap);
    if (threshBin < N_BINS) {
      const tx = PAD_L + threshBin * binW;
      ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 0.9; ctx.setLineDash([2, 2]); ctx.globalAlpha = 0.65;
      ctx.beginPath(); ctx.moveTo(tx, H_OFF + 12); ctx.lineTo(tx, HY1); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 0.75;
      ctx.fillStyle = "#f59e0b"; ctx.font = "6.5px monospace"; ctx.textAlign = "left";
      ctx.fillText(`${minPipGap}p`, tx + 2, H_OFF + 11);
      ctx.globalAlpha = 1;
    }
  }, [chart, stat.measuredLagMs, minPipGap]);

  if (h.length < 2 || !chart) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground/50 text-xs">
        Collecting data… waiting for at least 2 samples
      </div>
    );
  }

  const { velocity, netOpp } = chart;

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={VW}
        height={CANVAS_H}
        className="w-full select-none"
        style={{ height: "auto" }}
        aria-label={`${stat.symbol} feed chart`}
      />


      {/* ══════════════════════════════════════════════════════
          STATS ROW
      ══════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-6 gap-1.5 px-0.5">
        {([
          { label: "Avg Gap",  val: `${stat.avgGapPips.toFixed(1)}p`,                        cls: "" },
          { label: "Max Gap",  val: `${stat.maxGapPips.toFixed(1)}p`,                        cls: "text-amber-400" },
          { label: "Net Opp",  val: `${netOpp.toFixed(1)}p`,                                  cls: netOpp > 0 ? "text-emerald-400" : "text-muted-foreground" },
          { label: "Spread",   val: `${stat.spreadPips.toFixed(2)}p`,                         cls: "text-muted-foreground" },
          { label: "Velocity", val: `${velocity >= 0 ? "+" : ""}${velocity.toFixed(2)}p/s`,  cls: velocity > 0.15 ? "text-buy" : velocity < -0.15 ? "text-sell" : "" },
          { label: "Lag",      val: stat.measuredLagMs > 0 ? `${(stat.measuredLagMs / 1000).toFixed(1)}s` : "—", cls: "" },
        ] as const).map(({ label, val, cls }) => (
          <div key={label} className="text-center bg-secondary/20 rounded px-1.5 py-1.5">
            <div className="text-muted-foreground/60 uppercase tracking-wider text-[8px] mb-0.5">{label}</div>
            <div className={cn("font-mono font-semibold text-[10px]", cls)}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  );
});

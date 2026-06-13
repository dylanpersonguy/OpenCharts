import type { DrawingLine } from "../../../pages/trading/constants";

// Client-side line-cross alerts: when the live mid price crosses a drawing that
// has `alertEnabled`, the chart fires an in-session toast + sound. (Server-side
// persistence / offline delivery is a follow-up — there is no trader alert
// backend yet.)

const REFIRE_COOLDOWN_SEC = 30;

/** Price of an alert-enabled line at `timeSec`, or null if it can't cross now. */
export function linePriceAt(d: DrawingLine, timeSec: number): number | null {
  if (!d.alertEnabled) return null;
  if (d.type === "horizontal") return d.price;
  if (d.type === "trendline") {
    if (d.time == null || d.time2 == null || d.price2 == null) return null;
    const dt = d.time2 - d.time;
    if (dt === 0) return null;
    const slope = (d.price2 - d.price) / dt;
    return d.price + slope * (timeSec - d.time);
  }
  return null;
}

/**
 * Drawings whose line the mid price just crossed (between `prevMid` and `mid`),
 * debounced per drawing via `firedAt` (mutated in place).
 */
export function detectCrossings(
  drawings: readonly DrawingLine[],
  prevMid: number,
  mid: number,
  nowSec: number,
  firedAt: Map<string, number>,
): DrawingLine[] {
  const out: DrawingLine[] = [];
  for (const d of drawings) {
    const lp = linePriceAt(d, nowSec);
    if (lp == null) continue;
    if (prevMid < lp === mid < lp) continue; // no straddle → no cross
    if (nowSec - (firedAt.get(d.id) ?? 0) < REFIRE_COOLDOWN_SEC) continue;
    firedAt.set(d.id, nowSec);
    out.push(d);
  }
  return out;
}

/** Short WebAudio beep for a fired alert (best-effort; silent if unavailable). */
export function playAlertBeep(): void {
  if (typeof AudioContext === "undefined") return;
  try {
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + 0.15);
    osc.onended = () => ac.close();
  } catch {
    /* audio unavailable */
  }
}

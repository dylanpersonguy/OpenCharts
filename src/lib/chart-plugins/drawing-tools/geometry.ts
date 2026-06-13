export interface Pt {
  x: number;
  y: number;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distance from point p to the line segment a→b. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  return dist(p, { x: a.x + t * abx, y: a.y + t * aby });
}

/** Constrain p to the nearest 45° increment around anchor (Shift-snap). */
export function snapAngle(anchor: Pt, p: Pt): Pt {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  const r = Math.hypot(dx, dy);
  if (r < 1) return p;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: anchor.x + r * Math.cos(angle), y: anchor.y + r * Math.sin(angle) };
}

/** True if p is inside the box spanned by two corners, expanded by tolerance. */
export function pointInBox(
  p: Pt,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tolerance: number,
): boolean {
  const minX = Math.min(x1, x2) - tolerance;
  const maxX = Math.max(x1, x2) + tolerance;
  const minY = Math.min(y1, y2) - tolerance;
  const maxY = Math.max(y1, y2) + tolerance;
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

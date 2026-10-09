/**
 * Decide whether a new candle array can be applied with `series.update()`
 * instead of a full `setData()`. Relies on structural sharing: unchanged bars
 * keep object identity between renders (see replay `appendAggregate`).
 */

interface TimedBar {
  readonly time: unknown;
}

export type SeriesDiff<T> =
  | { readonly kind: "none" }
  | { readonly kind: "reset" }
  | { readonly kind: "update"; readonly bars: readonly T[] };

export function diffSeries<T extends TimedBar>(prev: readonly T[], next: readonly T[]): SeriesDiff<T> {
  if (prev.length === 0 || next.length === 0) return { kind: "reset" };
  if (next.length !== prev.length && next.length !== prev.length + 1) return { kind: "reset" };
  if (next[0] !== prev[0]) return { kind: "reset" };
  // Everything before the previous last bar must be the very same objects.
  const stable = prev.length - 1;
  if (stable > 0 && next[stable - 1] !== prev[stable - 1]) return { kind: "reset" };
  const lastPrev = prev[stable] as T;
  const lastAtSameIndex = next[stable] as T;
  if (lastAtSameIndex.time !== lastPrev.time) return { kind: "reset" };
  const changed = next.slice(stable).filter((b, i) => i > 0 || b !== lastPrev);
  return changed.length === 0 ? { kind: "none" } : { kind: "update", bars: changed };
}

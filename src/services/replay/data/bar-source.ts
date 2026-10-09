import type { BarColumns, HistoryChunkInfo, HistoryManifest } from "./codec.ts";
import type { ChunkCache } from "./chunk-cache.ts";
import type { Bar } from "./types.ts";

/**
 * Synchronous access to a symbol's 15m history once its chunks are loaded.
 * Call `ensureRange` (async) before any of the sync readers for that range.
 */
export interface BarSource {
  readonly symbol: string;
  readonly dataStart: number;
  readonly dataEnd: number;
  /** Loads every chunk overlapping [fromSec, toSec]. */
  ensureRange(fromSec: number, toSec: number): Promise<void>;
  /** True when every chunk overlapping [fromSec, toSec] is loaded. */
  isLoaded(fromSec: number, toSec: number): boolean;
  /** Bars with fromExclusive < time <= toInclusive; throws if the range is not loaded. */
  barsBetween(fromExclusive: number, toInclusive: number): Bar[];
  /** Latest loaded bar with time <= t. */
  lastBarAtOrBefore(t: number): Bar | null;
  /** Earliest loaded bar with time >= t. */
  firstBarAtOrAfter(t: number): Bar | null;
  /** Open time of the first loaded bar strictly after t. */
  nextBarTime(t: number): number | null;
  /** Warms the chunk containing t and its neighbours (fire and forget). */
  prefetchAround(t: number): void;
}

/** Index of the first element in `times` strictly greater than `t`. */
function upperBound(times: Int32Array, t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first element in `times` greater than or equal to `t`. */
function lowerBound(times: Int32Array, t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function barAt(cols: BarColumns, i: number): Bar {
  return {
    time: cols.time[i]!,
    open: cols.open[i]!,
    high: cols.high[i]!,
    low: cols.low[i]!,
    close: cols.close[i]!,
    volume: cols.volume[i]!,
  };
}

/** Creates a bar source over the manifest's chunks for `symbol`. */
export function createBarSource(symbol: string, manifest: HistoryManifest, cache: ChunkCache): BarSource {
  const info = manifest.symbols[symbol];
  if (!info) throw new Error(`No replay history for ${symbol}`);
  const chunks: readonly HistoryChunkInfo[] = [...info.chunks].sort((a, b) => a.year - b.year);
  const loaded = new Map<number, BarColumns>();

  const overlapping = (from: number, to: number) => chunks.filter((c) => c.from <= to && c.to >= from);
  const loadedChunks = () => chunks.flatMap((c) => {
    const cols = loaded.get(c.year);
    return cols ? [cols] : [];
  });

  async function loadChunk(year: number): Promise<void> {
    if (loaded.has(year)) return;
    const cols = await cache.load(symbol, year);
    loaded.set(year, cols);
  }

  async function ensureRange(fromSec: number, toSec: number): Promise<void> {
    await Promise.all(overlapping(fromSec, toSec).map((c) => loadChunk(c.year)));
  }

  function isLoaded(fromSec: number, toSec: number): boolean {
    return overlapping(fromSec, toSec).every((c) => loaded.has(c.year));
  }

  function barsBetween(fromExclusive: number, toInclusive: number): Bar[] {
    const out: Bar[] = [];
    if (toInclusive <= fromExclusive) return out;
    for (const c of overlapping(fromExclusive + 1, toInclusive)) {
      const cols = loaded.get(c.year);
      if (!cols) throw new Error(`${symbol} ${c.year} chunk not loaded; call ensureRange first`);
      const end = upperBound(cols.time, toInclusive);
      for (let i = upperBound(cols.time, fromExclusive); i < end; i++) out.push(barAt(cols, i));
    }
    return out;
  }

  function lastBarAtOrBefore(t: number): Bar | null {
    const all = loadedChunks();
    for (let k = all.length - 1; k >= 0; k--) {
      const cols = all[k]!;
      const i = upperBound(cols.time, t) - 1;
      if (i >= 0) return barAt(cols, i);
    }
    return null;
  }

  function firstBarAtOrAfter(t: number): Bar | null {
    for (const cols of loadedChunks()) {
      const i = lowerBound(cols.time, t);
      if (i < cols.length) return barAt(cols, i);
    }
    return null;
  }

  function nextBarTime(t: number): number | null {
    return firstBarAtOrAfter(Math.floor(t) + 1)?.time ?? null;
  }

  function prefetchAround(t: number): void {
    const idx = chunks.findIndex((c) => c.to >= t);
    const center = idx === -1 ? chunks.length - 1 : idx;
    for (const c of chunks.slice(Math.max(0, center - 1), center + 2)) {
      loadChunk(c.year).catch(() => {
        // Prefetch is best effort; ensureRange surfaces the error when needed.
      });
    }
  }

  return {
    symbol,
    dataStart: info.from,
    dataEnd: info.to,
    ensureRange,
    isLoaded,
    barsBetween,
    lastBarAtOrBefore,
    firstBarAtOrAfter,
    nextBarTime,
    prefetchAround,
  };
}

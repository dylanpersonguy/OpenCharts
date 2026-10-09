/**
 * Binary chunk format for replay history (one file per symbol per UTC year).
 *
 * Layout (little-endian):
 *   0-3   magic "OCH1"
 *   4-5   version u16 (= 1)
 *   6-7   reserved
 *   8-11  bar count u32
 *   12-15 price scale u32 (prices stored as round(price * scale))
 *   then columns: time Int32[n] (unix seconds, bar open, UTC),
 *                 open/high/low/close Int32[n], volume Float32[n]
 *
 * This module has ZERO imports and uses only erasable TypeScript syntax so
 * `scripts/fetch-history.ts` can run it natively under Node.
 */

export interface RawBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarColumns {
  time: Int32Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float32Array;
  length: number;
}

export interface HistoryChunkInfo {
  year: number;
  file: string;
  count: number;
  from: number;
  to: number;
}

export type HistorySource = "binance" | "csv";
export type HistoryPriceType = "bid" | "last";

export const HISTORY_SOURCES: readonly HistorySource[] = ["binance", "csv"];
export const HISTORY_PRICE_TYPES: readonly HistoryPriceType[] = ["bid", "last"];

export interface HistorySymbolInfo {
  priceScale: number;
  source: HistorySource;
  priceType: HistoryPriceType;
  from: number;
  to: number;
  chunks: HistoryChunkInfo[];
}

export interface HistoryManifest {
  version: 1;
  generatedAt: string;
  baseTimeframe: "15m";
  symbols: Record<string, HistorySymbolInfo>;
}

export const CHUNK_MAGIC = "OCH1";
export const CHUNK_VERSION = 1;
export const CHUNK_HEADER_BYTES = 16;
const BYTES_PER_BAR = 24;

/** Total byte size of a chunk holding `count` bars. */
export function chunkByteLength(count: number): number {
  return CHUNK_HEADER_BYTES + count * BYTES_PER_BAR;
}

/** Serialises bars (assumed sanitized and sorted) into a binary chunk. */
export function encodeChunk(bars: readonly RawBar[], priceScale: number): Uint8Array {
  if (!Number.isInteger(priceScale) || priceScale <= 0) {
    throw new Error(`Invalid priceScale ${priceScale}`);
  }
  const n = bars.length;
  const bytes = new Uint8Array(chunkByteLength(n));
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 4; i++) view.setUint8(i, CHUNK_MAGIC.charCodeAt(i));
  view.setUint16(4, CHUNK_VERSION, true);
  view.setUint32(8, n, true);
  view.setUint32(12, priceScale, true);

  const col = (k: number) => CHUNK_HEADER_BYTES + k * n * 4;
  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    const at = i * 4;
    view.setInt32(col(0) + at, Math.floor(b.time), true);
    view.setInt32(col(1) + at, Math.round(b.open * priceScale), true);
    view.setInt32(col(2) + at, Math.round(b.high * priceScale), true);
    view.setInt32(col(3) + at, Math.round(b.low * priceScale), true);
    view.setInt32(col(4) + at, Math.round(b.close * priceScale), true);
    view.setFloat32(col(5) + at, b.volume, true);
  }
  return bytes;
}

/** Reads and validates a chunk header; returns bar count and price scale. */
export function readChunkHeader(buf: ArrayBuffer): { count: number; priceScale: number } {
  if (buf.byteLength < CHUNK_HEADER_BYTES) {
    throw new Error(`Chunk length ${buf.byteLength} is shorter than the header`);
  }
  const view = new DataView(buf);
  let magic = "";
  for (let i = 0; i < 4; i++) magic += String.fromCharCode(view.getUint8(i));
  if (magic !== CHUNK_MAGIC) throw new Error(`Bad chunk magic "${magic}"`);
  const version = view.getUint16(4, true);
  if (version !== CHUNK_VERSION) throw new Error(`Unsupported chunk version ${version}`);
  const count = view.getUint32(8, true);
  const priceScale = view.getUint32(12, true);
  if (priceScale === 0) throw new Error("Chunk priceScale is zero");
  if (buf.byteLength !== chunkByteLength(count)) {
    throw new Error(`Chunk length ${buf.byteLength} does not match ${count} bars`);
  }
  return { count, priceScale };
}

/** Decodes a binary chunk into columns; prices are divided back to floats. */
export function decodeChunk(buf: ArrayBuffer): BarColumns {
  const { count: n, priceScale } = readChunkHeader(buf);
  const view = new DataView(buf);
  const col = (k: number) => CHUNK_HEADER_BYTES + k * n * 4;
  const time = new Int32Array(n);
  const open = new Float64Array(n);
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  const close = new Float64Array(n);
  const volume = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const at = i * 4;
    time[i] = view.getInt32(col(0) + at, true);
    open[i] = view.getInt32(col(1) + at, true) / priceScale;
    high[i] = view.getInt32(col(2) + at, true) / priceScale;
    low[i] = view.getInt32(col(3) + at, true) / priceScale;
    close[i] = view.getInt32(col(4) + at, true) / priceScale;
    volume[i] = view.getFloat32(col(5) + at, true);
  }
  return { time, open, high, low, close, volume, length: n };
}

/** Converts decoded columns back into row objects. */
export function columnsToBars(cols: BarColumns): RawBar[] {
  return Array.from({ length: cols.length }, (_, i) => ({
    time: cols.time[i]!,
    open: cols.open[i]!,
    high: cols.high[i]!,
    low: cols.low[i]!,
    close: cols.close[i]!,
    volume: cols.volume[i]!,
  }));
}

/** True when every price is finite and positive and time is finite. */
function isValidBar(b: RawBar): boolean {
  return (
    Number.isFinite(b.time) &&
    [b.open, b.high, b.low, b.close].every((p) => Number.isFinite(p) && p > 0)
  );
}

/** Returns bars sorted by time, deduped (last wins), invalid dropped, H/L clamped. */
export function sanitizeBars(bars: readonly RawBar[]): RawBar[] {
  const byTime = new Map<number, RawBar>();
  for (const b of bars) {
    if (isValidBar(b)) byTime.set(b.time, b);
  }
  return [...byTime.values()]
    .sort((a, b) => a.time - b.time)
    .map((b) => ({
      time: b.time,
      open: b.open,
      high: Math.max(b.high, b.open, b.close),
      low: Math.min(b.low, b.open, b.close),
      close: b.close,
      volume: Number.isFinite(b.volume) && b.volume > 0 ? b.volume : 0,
    }));
}

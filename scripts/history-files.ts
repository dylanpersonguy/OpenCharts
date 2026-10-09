/**
 * Shared file helpers for the history scripts: chunk read/write and the
 * manifest rebuild. Run natively by Node (erasable TypeScript only).
 */
import { access, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  columnsToBars,
  decodeChunk,
  encodeChunk,
  type BarColumns,
  type HistoryManifest,
  type HistorySymbolInfo,
  type RawBar,
} from "../src/services/replay/data/codec.ts";

export const ROOT = resolve(import.meta.dirname, "..");
export const HISTORY_DIR = join(ROOT, "public", "history");

type SymbolMeta = Pick<HistorySymbolInfo, "priceScale" | "source" | "priceType">;

/** Storage settings per symbol; also decides what the manifest lists. */
export const HISTORY_SYMBOLS: Record<string, SymbolMeta> = {
  BTCUSD: { priceScale: 100, source: "binance", priceType: "last" },
  XAUUSD: { priceScale: 1000, source: "csv", priceType: "bid" },
};

export function chunkPath(symbol: string, year: number): string {
  return join(HISTORY_DIR, symbol, `${year}.bin`);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Writes via a temp file + rename so an interrupted run never leaves a torn file. */
export async function writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

async function readColumns(path: string): Promise<BarColumns> {
  const buf = await readFile(path);
  return decodeChunk(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

/** Bars of an existing chunk, or [] when the file does not exist. */
export async function readChunkBars(symbol: string, year: number): Promise<RawBar[]> {
  const path = chunkPath(symbol, year);
  return (await exists(path)) ? columnsToBars(await readColumns(path)) : [];
}

/** Encodes and writes one year chunk; returns its size in bytes. */
export async function writeChunk(symbol: string, year: number, bars: readonly RawBar[], priceScale: number): Promise<number> {
  await mkdir(join(HISTORY_DIR, symbol), { recursive: true });
  const bytes = encodeChunk(bars, priceScale);
  await writeAtomic(chunkPath(symbol, year), bytes);
  return bytes.byteLength;
}

async function symbolInfo(symbol: string, meta: SymbolMeta): Promise<HistorySymbolInfo | null> {
  const dir = join(HISTORY_DIR, symbol);
  if (!(await exists(dir))) return null;
  const files = (await readdir(dir)).filter((f) => /^\d{4}\.bin$/.test(f)).sort();
  const chunks: HistorySymbolInfo["chunks"] = [];
  for (const f of files) {
    const cols = await readColumns(join(dir, f));
    if (cols.length === 0) continue;
    chunks.push({
      year: Number(f.slice(0, 4)),
      file: `${symbol}/${f}`,
      count: cols.length,
      from: cols.time[0]!,
      to: cols.time[cols.length - 1]!,
    });
  }
  const first = chunks[0];
  const last = chunks[chunks.length - 1];
  if (!first || !last) return null;
  return { ...meta, from: first.from, to: last.to, chunks };
}

/** Rebuilds manifest.json from the chunk files on disk. */
export async function writeManifest(): Promise<HistoryManifest> {
  const symbols: HistoryManifest["symbols"] = {};
  for (const [symbol, meta] of Object.entries(HISTORY_SYMBOLS)) {
    const info = await symbolInfo(symbol, meta);
    if (info) symbols[symbol] = info;
  }
  const manifest: HistoryManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    baseTimeframe: "15m",
    symbols,
  };
  await mkdir(HISTORY_DIR, { recursive: true });
  await writeAtomic(join(HISTORY_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Logs a per-symbol summary of the manifest. */
export function logManifest(manifest: HistoryManifest): void {
  for (const [symbol, info] of Object.entries(manifest.symbols)) {
    const bars = info.chunks.reduce((n, c) => n + c.count, 0);
    const span = `${new Date(info.from * 1000).toISOString()} .. ${new Date(info.to * 1000).toISOString()}`;
    console.log(`manifest ${symbol}: ${info.chunks.length} chunks, ${bars} bars, ${span}`);
  }
}

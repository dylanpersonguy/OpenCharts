import { HISTORY_PRICE_TYPES, HISTORY_SOURCES, type HistoryManifest } from "./codec.ts";

type FetchLike = (url: string) => Promise<Response>;

/** Default URL prefix where `npm run fetch:history` writes its output. */
export const HISTORY_BASE_URL = `${import.meta.env.BASE_URL}history/`;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isChunk(v: unknown): boolean {
  return isObject(v) && isNum(v.year) && typeof v.file === "string" && isNum(v.count) && isNum(v.from) && isNum(v.to);
}

function isSymbolInfo(v: unknown): boolean {
  return (
    isObject(v) &&
    isNum(v.priceScale) &&
    (HISTORY_SOURCES as readonly unknown[]).includes(v.source) &&
    (HISTORY_PRICE_TYPES as readonly unknown[]).includes(v.priceType) &&
    isNum(v.from) &&
    isNum(v.to) &&
    Array.isArray(v.chunks) &&
    v.chunks.every(isChunk)
  );
}

/** Minimal shape check for a parsed manifest. */
export function isHistoryManifest(v: unknown): v is HistoryManifest {
  return (
    isObject(v) &&
    v.version === 1 &&
    isObject(v.symbols) &&
    Object.values(v.symbols).every(isSymbolInfo)
  );
}

/** Loads the history manifest; null when missing (404), unreachable or invalid. */
export async function loadManifest(
  fetchImpl: FetchLike = (url) => fetch(url),
  baseUrl: string = HISTORY_BASE_URL,
): Promise<HistoryManifest | null> {
  try {
    const res = await fetchImpl(`${baseUrl}manifest.json`);
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return isHistoryManifest(json) ? json : null;
  } catch {
    return null;
  }
}

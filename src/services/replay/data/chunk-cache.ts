import { decodeChunk, type BarColumns } from "./codec.ts";
import { HISTORY_BASE_URL } from "./manifest.ts";

type FetchLike = (url: string) => Promise<Response>;

export interface ChunkCache {
  /** Decoded bars for one symbol-year; concurrent calls share one request. */
  load(symbol: string, year: number): Promise<BarColumns>;
}

export interface ChunkCacheOptions {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  maxEntries?: number;
}

/** Fetches `{baseUrl}{symbol}/{year}.bin` and decodes it. */
async function fetchChunk(fetchImpl: FetchLike, url: string): Promise<BarColumns> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
  return decodeChunk(await res.arrayBuffer());
}

/** Promise-memoizing LRU cache of decoded history chunks. */
export function createChunkCache({
  fetchImpl = (url) => fetch(url),
  baseUrl = HISTORY_BASE_URL,
  maxEntries = 30,
}: ChunkCacheOptions = {}): ChunkCache {
  // Map iteration order doubles as recency order (oldest first).
  const entries = new Map<string, Promise<BarColumns>>();

  function evictOverflow(): void {
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) return;
      entries.delete(oldest);
    }
  }

  function load(symbol: string, year: number): Promise<BarColumns> {
    const key = `${symbol}/${year}`;
    const hit = entries.get(key);
    if (hit) {
      entries.delete(key);
      entries.set(key, hit);
      return hit;
    }
    const pending = fetchChunk(fetchImpl, `${baseUrl}${key}.bin`);
    entries.set(key, pending);
    pending.catch(() => {
      if (entries.get(key) === pending) entries.delete(key);
    });
    evictOverflow();
    return pending;
  }

  return { load };
}

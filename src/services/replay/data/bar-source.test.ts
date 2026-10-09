import { describe, it, expect, vi } from "vitest";
import { encodeChunk, decodeChunk, type HistoryManifest, type RawBar } from "./codec.ts";
import { createBarSource } from "./bar-source.ts";
import { createChunkCache, type ChunkCache } from "./chunk-cache.ts";
import { loadManifest } from "./manifest.ts";

const Y2024 = Date.UTC(2024, 0, 1) / 1000;

function makeBars(start: number, count: number): RawBar[] {
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * 900,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: i,
  }));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// 2023 chunk: last four bars of the year; 2024 chunk: first four bars.
const CHUNKS: Record<number, RawBar[]> = {
  2023: makeBars(Y2024 - 4 * 900, 4),
  2024: makeBars(Y2024, 4),
};

const MANIFEST: HistoryManifest = {
  version: 1,
  generatedAt: "2024-01-02T00:00:00.000Z",
  baseTimeframe: "15m",
  symbols: {
    BTCUSD: {
      priceScale: 100,
      source: "binance",
      priceType: "last",
      from: Y2024 - 4 * 900,
      to: Y2024 + 3 * 900,
      chunks: [2023, 2024].map((year) => ({
        year,
        file: `BTCUSD/${year}.bin`,
        count: 4,
        from: CHUNKS[year]![0]!.time,
        to: CHUNKS[year]![3]!.time,
      })),
    },
  },
};

function memoryCache(): ChunkCache & { load: ReturnType<typeof vi.fn> } {
  const load = vi.fn(async (_symbol: string, year: number) =>
    decodeChunk(toArrayBuffer(encodeChunk(CHUNKS[year] ?? [], 100))),
  );
  return { load };
}

describe("createBarSource", () => {
  it("exposes the data range", () => {
    const src = createBarSource("BTCUSD", MANIFEST, memoryCache());
    expect(src.dataStart).toBe(Y2024 - 3600);
    expect(src.dataEnd).toBe(Y2024 + 2700);
  });

  it("throws for an unknown symbol", () => {
    expect(() => createBarSource("ETHUSD", MANIFEST, memoryCache())).toThrow(/ETHUSD/);
  });

  it("loads only the chunks a range needs", async () => {
    const cache = memoryCache();
    const src = createBarSource("BTCUSD", MANIFEST, cache);
    expect(src.isLoaded(Y2024, Y2024 + 900)).toBe(false);
    await src.ensureRange(Y2024, Y2024 + 900);
    expect(cache.load).toHaveBeenCalledTimes(1);
    expect(cache.load).toHaveBeenCalledWith("BTCUSD", 2024);
    expect(src.isLoaded(Y2024, Y2024 + 900)).toBe(true);
    expect(src.isLoaded(Y2024 - 900, Y2024)).toBe(false);
  });

  it("returns bars across year chunks with exclusive/inclusive bounds", async () => {
    const src = createBarSource("BTCUSD", MANIFEST, memoryCache());
    await src.ensureRange(Y2024 - 3600, Y2024 + 3600);
    const bars = src.barsBetween(Y2024 - 1800, Y2024 + 900);
    expect(bars.map((b) => b.time)).toEqual([Y2024 - 900, Y2024, Y2024 + 900]);
    expect(bars[0]).toEqual({ time: Y2024 - 900, open: 103, high: 104, low: 102, close: 103.5, volume: 3 });
  });

  it("handles range edges", async () => {
    const src = createBarSource("BTCUSD", MANIFEST, memoryCache());
    await src.ensureRange(src.dataStart, src.dataEnd);
    expect(src.barsBetween(0, Y2024 - 3600)).toHaveLength(1);
    expect(src.barsBetween(Y2024 - 3600, Y2024 - 3600)).toEqual([]);
    expect(src.barsBetween(Y2024 + 2700, Y2024 + 99999)).toEqual([]);
    expect(src.barsBetween(0, Y2024 + 99999)).toHaveLength(8);
    expect(src.barsBetween(Y2024 - 3599, Y2024 - 2701)).toEqual([]);
  });

  it("throws when reading a range that is not loaded", () => {
    const src = createBarSource("BTCUSD", MANIFEST, memoryCache());
    expect(() => src.barsBetween(Y2024 - 1, Y2024)).toThrow(/not loaded/i);
  });

  it("finds neighbouring bars with binary search", async () => {
    const src = createBarSource("BTCUSD", MANIFEST, memoryCache());
    await src.ensureRange(src.dataStart, src.dataEnd);
    expect(src.lastBarAtOrBefore(Y2024 + 100)?.time).toBe(Y2024);
    expect(src.lastBarAtOrBefore(Y2024 - 1)?.time).toBe(Y2024 - 900);
    expect(src.lastBarAtOrBefore(Y2024 - 3601)).toBeNull();
    expect(src.firstBarAtOrAfter(Y2024 - 1)?.time).toBe(Y2024);
    expect(src.firstBarAtOrAfter(Y2024)?.time).toBe(Y2024);
    expect(src.firstBarAtOrAfter(Y2024 + 2701)).toBeNull();
    expect(src.nextBarTime(Y2024 - 900)).toBe(Y2024);
    expect(src.nextBarTime(Y2024 + 2700)).toBeNull();
  });

  it("prefetches neighbouring chunks", async () => {
    const cache = memoryCache();
    const src = createBarSource("BTCUSD", MANIFEST, cache);
    src.prefetchAround(Y2024 + 10);
    await vi.waitFor(() => expect(src.isLoaded(src.dataStart, src.dataEnd)).toBe(true));
    expect(cache.load).toHaveBeenCalledWith("BTCUSD", 2023);
    expect(cache.load).toHaveBeenCalledWith("BTCUSD", 2024);
  });
});

describe("createChunkCache", () => {
  const ok = (bars: RawBar[]) =>
    new Response(toArrayBuffer(encodeChunk(bars, 100)), { status: 200 });

  it("fetches, decodes and memoizes chunks", async () => {
    const fetchImpl = vi.fn(async () => ok(CHUNKS[2024]!));
    const cache = createChunkCache({ fetchImpl, baseUrl: "/h/" });
    const [a, b] = await Promise.all([cache.load("BTCUSD", 2024), cache.load("BTCUSD", 2024)]);
    expect(a).toBe(b);
    expect(a.length).toBe(4);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("/h/BTCUSD/2024.bin");
  });

  it("evicts least recently used entries", async () => {
    const fetchImpl = vi.fn(async () => ok(CHUNKS[2024]!));
    const cache = createChunkCache({ fetchImpl, baseUrl: "/h/", maxEntries: 2 });
    await cache.load("BTCUSD", 2021);
    await cache.load("BTCUSD", 2022);
    await cache.load("BTCUSD", 2021); // touch 2021 so 2022 is LRU
    await cache.load("BTCUSD", 2023); // evicts 2022
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await cache.load("BTCUSD", 2021);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await cache.load("BTCUSD", 2022);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("evicts rejected loads so they can be retried", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(ok(CHUNKS[2024]!));
    const cache = createChunkCache({ fetchImpl, baseUrl: "/h/" });
    await expect(cache.load("BTCUSD", 2024)).rejects.toThrow(/404/);
    await expect(cache.load("BTCUSD", 2024)).resolves.toMatchObject({ length: 4 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("loadManifest", () => {
  it("returns the parsed manifest", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(MANIFEST), { status: 200 }));
    await expect(loadManifest(fetchImpl, "/h/")).resolves.toEqual(MANIFEST);
    expect(fetchImpl).toHaveBeenCalledWith("/h/manifest.json");
  });

  it("returns null on 404", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    await expect(loadManifest(fetchImpl, "/h/")).resolves.toBeNull();
  });

  it("returns null on network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network");
    });
    await expect(loadManifest(fetchImpl, "/h/")).resolves.toBeNull();
  });

  it("accepts csv-sourced symbols and rejects unknown sources", async () => {
    const csv = { ...MANIFEST, symbols: { XAUUSD: { ...MANIFEST.symbols.BTCUSD!, source: "csv", priceType: "bid" } } };
    const ok = vi.fn(async () => new Response(JSON.stringify(csv), { status: 200 }));
    await expect(loadManifest(ok, "/h/")).resolves.toEqual(csv);
    const odd = { ...MANIFEST, symbols: { XAUUSD: { ...MANIFEST.symbols.BTCUSD!, source: "ftp" } } };
    const bad = vi.fn(async () => new Response(JSON.stringify(odd), { status: 200 }));
    await expect(loadManifest(bad, "/h/")).resolves.toBeNull();
  });

  it("returns null on invalid JSON or shape", async () => {
    const html = vi.fn(async () => new Response("<!doctype html>", { status: 200 }));
    await expect(loadManifest(html, "/h/")).resolves.toBeNull();
    const wrong = vi.fn(async () => new Response(JSON.stringify({ version: 2, symbols: {} }), { status: 200 }));
    await expect(loadManifest(wrong, "/h/")).resolves.toBeNull();
    const badChunk = { ...MANIFEST, symbols: { X: { ...MANIFEST.symbols.BTCUSD, chunks: [{ year: "a" }] } } };
    const bad = vi.fn(async () => new Response(JSON.stringify(badChunk), { status: 200 }));
    await expect(loadManifest(bad, "/h/")).resolves.toBeNull();
  });
});

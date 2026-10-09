import { describe, it, expect } from "vitest";
import { encodeChunk, decodeChunk, sanitizeBars, columnsToBars, type RawBar } from "./codec.ts";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const BARS: RawBar[] = [
  { time: 1700000000, open: 126000.01, high: 126100.5, low: 125900.99, close: 126050.25, volume: 12.5 },
  { time: 1700000900, open: 126050.25, high: 126060, low: 126000, close: 126010.1, volume: 0.25 },
];

describe("encodeChunk / decodeChunk", () => {
  it("round-trips bars with exact price precision", () => {
    const cols = decodeChunk(toArrayBuffer(encodeChunk(BARS, 100)));
    expect(cols.length).toBe(2);
    expect(Array.from(cols.time)).toEqual([1700000000, 1700000900]);
    expect(cols.open[0]).toBe(126000.01);
    expect(cols.high[0]).toBe(126100.5);
    expect(cols.low[0]).toBe(125900.99);
    expect(cols.close[1]).toBe(126010.1);
    expect(cols.volume[0]).toBe(12.5);
    expect(cols.volume[1]).toBe(0.25);
  });

  it("writes a 16-byte header plus 24 bytes per bar", () => {
    const bytes = encodeChunk(BARS, 100);
    expect(bytes.byteLength).toBe(16 + 24 * 2);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("OCH1");
    const view = new DataView(toArrayBuffer(bytes));
    expect(view.getUint16(4, true)).toBe(1);
    expect(view.getUint32(8, true)).toBe(2);
    expect(view.getUint32(12, true)).toBe(100);
  });

  it("round-trips gold prices at scale 1000", () => {
    const gold: RawBar[] = [{ time: 1, open: 2034.567, high: 2035.001, low: 2030.1, close: 2031.999, volume: 0 }];
    const cols = decodeChunk(toArrayBuffer(encodeChunk(gold, 1000)));
    expect(cols.open[0]).toBe(2034.567);
    expect(cols.close[0]).toBe(2031.999);
  });

  it("handles an empty chunk", () => {
    const bytes = encodeChunk([], 100);
    expect(bytes.byteLength).toBe(16);
    const cols = decodeChunk(toArrayBuffer(bytes));
    expect(cols.length).toBe(0);
    expect(cols.time.length).toBe(0);
  });

  it("rejects an invalid price scale", () => {
    expect(() => encodeChunk(BARS, 0)).toThrow();
    expect(() => encodeChunk(BARS, 1.5)).toThrow();
  });

  it("throws on bad magic", () => {
    const bytes = encodeChunk(BARS, 100);
    bytes[0] = 0x58;
    expect(() => decodeChunk(toArrayBuffer(bytes))).toThrow(/magic/i);
  });

  it("throws on unsupported version", () => {
    const bytes = encodeChunk(BARS, 100);
    new DataView(bytes.buffer, bytes.byteOffset).setUint16(4, 2, true);
    expect(() => decodeChunk(toArrayBuffer(bytes))).toThrow(/version/i);
  });

  it("throws on truncated data", () => {
    const bytes = encodeChunk(BARS, 100);
    expect(() => decodeChunk(toArrayBuffer(bytes.subarray(0, bytes.byteLength - 4)))).toThrow(/length/i);
    expect(() => decodeChunk(new ArrayBuffer(8))).toThrow();
  });
});

describe("sanitizeBars", () => {
  it("sorts by time and dedupes keeping the last occurrence", () => {
    const input: RawBar[] = [
      { time: 300, open: 3, high: 3, low: 3, close: 3, volume: 1 },
      { time: 100, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 300, open: 4, high: 4, low: 4, close: 4, volume: 2 },
    ];
    const out = sanitizeBars(input);
    expect(out.map((b) => b.time)).toEqual([100, 300]);
    expect(out[1]!.open).toBe(4);
    expect(input[0]!.time).toBe(300);
  });

  it("drops non-finite and non-positive prices", () => {
    const out = sanitizeBars([
      { time: 1, open: NaN, high: 1, low: 1, close: 1, volume: 1 },
      { time: 2, open: 1, high: 1, low: 0, close: 1, volume: 1 },
      { time: 3, open: 1, high: Infinity, low: 1, close: 1, volume: 1 },
      { time: Number.NaN, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 4, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    expect(out.map((b) => b.time)).toEqual([4]);
  });

  it("clamps high/low to contain open and close and zeroes bad volume", () => {
    const [bar] = sanitizeBars([{ time: 1, open: 10, high: 9, low: 11, close: 12, volume: NaN }]);
    expect(bar).toEqual({ time: 1, open: 10, high: 12, low: 10, close: 12, volume: 0 });
  });
});

describe("columnsToBars", () => {
  it("converts decoded columns back to bars", () => {
    const cols = decodeChunk(toArrayBuffer(encodeChunk(BARS, 100)));
    expect(columnsToBars(cols)).toEqual(BARS);
  });
});

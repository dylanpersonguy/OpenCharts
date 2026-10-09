import { describe, it, expect } from "vitest";
import { parseHistoryCsv, detectCsvFormat, aggregateTo15m, mergeBars, isHistdataStatusReport } from "./csv-import.ts";
import type { RawBar } from "./codec.ts";

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000;

function raw(time: number, open: number, high: number, low: number, close: number, volume = 0): RawBar {
  return { time, open, high, low, close, volume };
}

describe("detectCsvFormat", () => {
  it("recognises histdata Generic ASCII rows", () => {
    expect(detectCsvFormat("20240102 170000;2063.120;2064.010;2062.900;2063.450;0")).toBe("histdata");
  });

  it("recognises Dukascopy export headers", () => {
    expect(detectCsvFormat("Gmt time,Open,High,Low,Close,Volume")).toBe("dukascopy");
    expect(detectCsvFormat("﻿Local time,Open,High,Low,Close,Volume")).toBe("dukascopy");
  });

  it("returns null for anything else", () => {
    expect(detectCsvFormat("<html>")).toBeNull();
  });
});

describe("parseHistoryCsv: histdata", () => {
  it("converts fixed EST (UTC-5, no DST) to UTC", () => {
    const text = [
      "20240102 170000;2063.120;2064.010;2062.900;2063.450;0",
      "20240702 170100;2330.500;2331.000;2330.000;2330.250;12",
      "",
    ].join("\r\n");
    const rows = parseHistoryCsv(text, "DAT_ASCII_XAUUSD_M1_2024.csv");
    expect(rows).toEqual([
      raw(utc(2024, 1, 2, 22, 0), 2063.12, 2064.01, 2062.9, 2063.45, 0),
      // July: still +5h, histdata ignores daylight saving
      raw(utc(2024, 7, 2, 22, 1), 2330.5, 2331, 2330, 2330.25, 12),
    ]);
  });

  it("rolls over the UTC day and year", () => {
    const [row] = parseHistoryCsv("20231231 210000;2062;2063;2061;2062.5;0", "f.csv");
    expect(row!.time).toBe(utc(2024, 1, 1, 2, 0));
  });
});

describe("parseHistoryCsv: dukascopy", () => {
  it("parses Gmt time rows", () => {
    const text = "Gmt time,Open,High,Low,Close,Volume\n02.01.2024 00:00:00.000,2063.12,2064.01,2062.9,2063.45,0.0123\n";
    expect(parseHistoryCsv(text, "XAUUSD_Candlestick_1_M_BID.csv")).toEqual([
      raw(utc(2024, 1, 2), 2063.12, 2064.01, 2062.9, 2063.45, 0.0123),
    ]);
  });

  it("applies Local time GMT offsets", () => {
    const text = [
      "Local time,Open,High,Low,Close,Volume",
      "02.01.2024 02:00:00.000 GMT+0200,1,2,0.5,1.5,1",
      "01.07.2024 20:30:00.000 GMT-0430,1,2,0.5,1.5,1",
    ].join("\n");
    expect(parseHistoryCsv(text, "f.csv").map((r) => r.time)).toEqual([utc(2024, 1, 2, 0, 0), utc(2024, 7, 2, 1, 0)]);
  });

  it("rejects Local time rows without an offset", () => {
    const text = "Local time,Open,High,Low,Close,Volume\n02.01.2024 02:00:00.000,1,2,0.5,1.5,1";
    expect(() => parseHistoryCsv(text, "f.csv")).toThrow(/f\.csv:2/);
  });

  it("accepts ISO timestamps with optional offsets", () => {
    const text = [
      "Gmt time,Open,High,Low,Close,Volume",
      "2024-01-02T00:15:00Z,1,2,0.5,1.5,1",
      "2024-01-02 00:30:00,1,2,0.5,1.5,1",
      "2024-01-02T02:45:00.000+02:00,1,2,0.5,1.5,1",
    ].join("\n");
    expect(parseHistoryCsv(text, "f.csv").map((r) => r.time)).toEqual([
      utc(2024, 1, 2, 0, 15),
      utc(2024, 1, 2, 0, 30),
      utc(2024, 1, 2, 0, 45),
    ]);
  });
});

describe("parseHistoryCsv: errors", () => {
  it("reports the file and line of an unrecognised row", () => {
    const text = "20240102 170000;1;2;0.5;1.5;0\n20240102 170100;1;2;oops;1.5;0\n";
    expect(() => parseHistoryCsv(text, "bad.csv")).toThrow(/bad\.csv:2/);
  });

  it("rejects an unknown format", () => {
    expect(() => parseHistoryCsv("date;price\n", "x.txt")).toThrow(/x\.txt:1.*format/i);
  });

  it("rejects impossible dates", () => {
    expect(() => parseHistoryCsv("20240231 170000;1;2;0.5;1.5;0", "d.csv")).toThrow(/d\.csv:1/);
  });

  it("rejects mixed formats in one file", () => {
    const text = "Gmt time,Open,High,Low,Close,Volume\n20240102 170000;1;2;0.5;1.5;0";
    expect(() => parseHistoryCsv(text, "m.csv")).toThrow(/m\.csv:2/);
  });

  it("returns nothing for an empty file", () => {
    expect(parseHistoryCsv("\n\n", "e.csv")).toEqual([]);
  });
});

describe("aggregateTo15m", () => {
  it("combines 1m rows into UTC-aligned 15m bars across bucket edges", () => {
    const t0 = utc(2024, 1, 2, 0, 13);
    const rows = [
      raw(t0, 10, 11, 9, 10.5, 1), // 00:13 -> 00:00 bucket
      raw(t0 + 60, 10.5, 12, 10, 11, 2), // 00:14 -> 00:00 bucket
      raw(t0 + 120, 11, 11.5, 8, 9, 3), // 00:15 -> 00:15 bucket
      raw(t0 + 180, 9, 9.5, 8.5, 9.2, 4), // 00:16
    ];
    expect(aggregateTo15m(rows)).toEqual([
      raw(utc(2024, 1, 2, 0, 0), 10, 12, 9, 11, 3),
      raw(utc(2024, 1, 2, 0, 15), 11, 11.5, 8, 9.2, 7),
    ]);
  });

  it("sorts input and lets the later duplicate row win", () => {
    const t = utc(2024, 1, 2);
    const rows = [raw(t + 60, 2, 2, 2, 2, 1), raw(t, 1, 1, 1, 1, 1), raw(t + 60, 3, 3, 3, 3, 5)];
    expect(aggregateTo15m(rows)).toEqual([raw(t, 1, 3, 1, 3, 6)]);
  });

  it("passes 15m rows through unchanged", () => {
    const rows = [raw(utc(2024, 1, 2), 1, 2, 0.5, 1.5, 1), raw(utc(2024, 1, 2, 0, 15), 1.5, 2, 1, 1.2, 2)];
    expect(aggregateTo15m(rows)).toEqual(rows);
  });

  it("does not mutate its input", () => {
    const rows = Object.freeze([raw(5, 1, 1, 1, 1), raw(0, 1, 1, 1, 1)].map((r) => Object.freeze(r)));
    expect(() => aggregateTo15m(rows)).not.toThrow();
    expect(rows[0]!.time).toBe(5);
  });
});

describe("mergeBars", () => {
  it("unions by time with incoming bars winning, sorted", () => {
    const existing = [raw(0, 1, 1, 1, 1), raw(900, 2, 2, 2, 2), raw(1800, 3, 3, 3, 3)];
    const incoming = [raw(2700, 9, 9, 9, 9), raw(900, 7, 7, 7, 7)];
    const out = mergeBars(existing, incoming);
    expect(out.map((b) => [b.time, b.open])).toEqual([
      [0, 1],
      [900, 7],
      [1800, 3],
      [2700, 9],
    ]);
    expect(existing[1]!.open).toBe(2);
  });
});

describe("isHistdataStatusReport", () => {
  it("recognises the gap report histdata ships next to each data file", () => {
    const report =
      "HistData.com (c) 2012\r\nFile: DAT_ASCII_XAUUSD_M1_202601.csv Status Report\r\n\r\n" +
      "Gap of 3603s found between 20260105165959 and 20260105180008.\r\n";
    expect(isHistdataStatusReport(report)).toBe(true);
  });

  it("does not treat price data as a report", () => {
    expect(isHistdataStatusReport("20260101 180000;4323.698000;4332.848000;4323.698000;4328.198000;0\n")).toBe(false);
    expect(isHistdataStatusReport("Gmt time,Open,High,Low,Close,Volume\n")).toBe(false);
  });
});

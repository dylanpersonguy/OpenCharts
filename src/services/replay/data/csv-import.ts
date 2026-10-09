/**
 * Parses user-downloaded OHLC history files into UTC bars for replay chunks.
 *
 * Supported formats (auto-detected from the first non-empty line):
 *   - histdata.com "Generic ASCII" M1: `20240102 170000;O;H;L;C;V`, timestamps
 *     in fixed EST (UTC-5, no daylight saving).
 *   - Dukascopy historical export: header `Gmt time,Open,High,Low,Close,Volume`
 *     (or `Local time` with per-row `GMT+0200` offsets); rows use
 *     `DD.MM.YYYY HH:MM:SS.mmm` or ISO-8601 timestamps.
 *
 * Only type imports, so `scripts/import-history.ts` can run it natively under Node.
 */
import type { RawBar } from "./codec.ts";

export type CsvFormat = "histdata" | "dukascopy";

const BUCKET_SEC = 900;
const HISTDATA_OFFSET_MIN = -5 * 60;

const HISTDATA_ROW = /^(\d{4})(\d{2})(\d{2}) (\d{2})(\d{2})(\d{2});([^;]+);([^;]+);([^;]+);([^;]+);([^;]+)$/;
const DUKASCOPY_HEADER = /^(gmt time|local time)\s*,\s*open\s*,\s*high\s*,\s*low\s*,\s*close(\s*,\s*volume)?\s*$/i;
const DOTTED_TIME = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:\s*GMT([+-])(\d{2}):?(\d{2}))?$/;
const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(?:(Z)|([+-])(\d{2}):?(\d{2}))?$/;

/** Detects the file format from its first non-empty line; null when unknown. */
export function detectCsvFormat(firstLine: string): CsvFormat | null {
  const line = firstLine.replace(/^﻿/, "").trim();
  if (DUKASCOPY_HEADER.test(line)) return "dukascopy";
  if (HISTDATA_ROW.test(line)) return "histdata";
  return null;
}

/** True for the gap/status report histdata.com ships alongside each data file (not price data). */
export function isHistdataStatusReport(text: string): boolean {
  const head = text.replace(/^﻿/, "").slice(0, 200);
  return /^\s*HistData\.com/i.test(head) && /Status Report/i.test(head);
}

/** Unix seconds for a wall-clock time at `offsetMin` from UTC; null if the date is invalid. */
function toUtcSeconds(parts: readonly number[], offsetMin: number): number | null {
  const [y, mo, d, h, mi, s] = parts as [number, number, number, number, number, number];
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(ms);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null;
  return ms / 1000 - offsetMin * 60;
}

/** Strict finite-number parse; null on empty or malformed input. */
function num(text: string | undefined): number | null {
  const t = text?.trim() ?? "";
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Builds a bar from parsed fields; null if any price is malformed. */
function makeBar(time: number | null, fields: readonly (string | undefined)[]): RawBar | null {
  const [open, high, low, close] = fields.slice(0, 4).map(num);
  const volume = fields[4] === undefined ? 0 : num(fields[4]);
  if (time === null || open == null || high == null || low == null || close == null || volume === null) return null;
  return { time, open, high, low, close, volume };
}

function parseHistdataRow(line: string): RawBar | null {
  const m = HISTDATA_ROW.exec(line);
  if (!m) return null;
  const time = toUtcSeconds(m.slice(1, 7).map(Number), HISTDATA_OFFSET_MIN);
  return makeBar(time, m.slice(7, 12));
}

/** Parses a Dukascopy/ISO timestamp; `requireOffset` for "Local time" exports. */
function parseDukascopyTime(text: string, requireOffset: boolean): number | null {
  const dotted = DOTTED_TIME.exec(text);
  if (dotted) {
    const [, dd, mm, yyyy, h, mi, s, sign, oh, om] = dotted;
    if (requireOffset && !sign) return null;
    const offset = sign ? (sign === "-" ? -1 : 1) * (Number(oh) * 60 + Number(om)) : 0;
    return toUtcSeconds([yyyy, mm, dd, h, mi, s].map(Number), offset);
  }
  const iso = ISO_TIME.exec(text);
  if (iso) {
    const [, yyyy, mm, dd, h, mi, s, zulu, sign, oh, om] = iso;
    if (requireOffset && !zulu && !sign) return null;
    const offset = sign ? (sign === "-" ? -1 : 1) * (Number(oh) * 60 + Number(om)) : 0;
    return toUtcSeconds([yyyy, mm, dd, h, mi, s ?? "0"].map(Number), offset);
  }
  return null;
}

function parseDukascopyRow(line: string, requireOffset: boolean): RawBar | null {
  const fields = line.split(",");
  if (fields.length < 5 || fields.length > 6) return null;
  return makeBar(parseDukascopyTime(fields[0]!.trim(), requireOffset), fields.slice(1));
}

/**
 * Parses a whole history file into UTC rows (file order, any interval).
 * Throws `file:line: ...` on the first unrecognised row; never skips silently.
 */
export function parseHistoryCsv(text: string, fileName: string): RawBar[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const firstIdx = lines.findIndex((l) => l.trim() !== "");
  if (firstIdx === -1) return [];
  const format = detectCsvFormat(lines[firstIdx]!);
  if (!format) {
    throw new Error(
      `${fileName}:${firstIdx + 1}: unrecognised file format (expected histdata Generic ASCII or a Dukascopy CSV export)`,
    );
  }
  const localTime = format === "dukascopy" && /^\s*local time/i.test(lines[firstIdx]!);
  const startIdx = format === "dukascopy" ? firstIdx + 1 : firstIdx;
  const rows: RawBar[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    const bar = format === "histdata" ? parseHistdataRow(line) : parseDukascopyRow(line, localTime);
    if (!bar) throw new Error(`${fileName}:${i + 1}: unrecognised ${format} row "${line.slice(0, 80)}"`);
    rows.push(bar);
  }
  return rows;
}

/** Dedupes rows by time (later wins) and returns them sorted. */
function dedupeSorted(rows: readonly RawBar[]): RawBar[] {
  const byTime = new Map<number, RawBar>();
  for (const r of rows) byTime.set(r.time, r);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Aggregates 1m (or 15m) rows into UTC-aligned 15m bars. Never mutates input. */
export function aggregateTo15m(rows: readonly RawBar[]): RawBar[] {
  const out: RawBar[] = [];
  for (const r of dedupeSorted(rows)) {
    const bucket = Math.floor(r.time / BUCKET_SEC) * BUCKET_SEC;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      out[out.length - 1] = {
        time: bucket,
        open: last.open,
        high: Math.max(last.high, r.high),
        low: Math.min(last.low, r.low),
        close: r.close,
        volume: last.volume + r.volume,
      };
    } else {
      out.push({ ...r, time: bucket });
    }
  }
  return out;
}

/** Unions two bar sets by time; `incoming` wins on collisions. Result is sorted. */
export function mergeBars(existing: readonly RawBar[], incoming: readonly RawBar[]): RawBar[] {
  return dedupeSorted([...existing, ...incoming]);
}

/**
 * Imports user-downloaded OHLC files (histdata.com Generic ASCII M1 or a
 * Dukascopy CSV export) into replay chunks: public/history/{SYMBOL}/{YEAR}.bin
 * and rebuilds public/history/manifest.json.
 *
 * Usage: node scripts/import-history.ts --symbol XAUUSD [--dir history-import/XAUUSD]
 *
 * Reads every .csv/.txt (optionally .gz) file in the folder, aggregates to UTC
 * 15m bars and merges them into existing chunks; re-imported bars replace
 * existing ones at the same time.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { sanitizeBars, type RawBar } from "../src/services/replay/data/codec.ts";
import {
  aggregateTo15m,
  isHistdataStatusReport,
  mergeBars,
  parseHistoryCsv,
} from "../src/services/replay/data/csv-import.ts";
import { HISTORY_SYMBOLS, ROOT, exists, logManifest, readChunkBars, writeChunk, writeManifest } from "./history-files.ts";

const DATA_FILE = /\.(csv|txt)(\.gz)?$/i;

async function readText(path: string): Promise<string> {
  const buf = await readFile(path);
  return (path.toLowerCase().endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8");
}

/** Parses every data file in `dir` (sorted by name, later files win on duplicates). */
async function readImportRows(dir: string): Promise<RawBar[]> {
  if (!(await exists(dir))) throw new Error(`Import folder not found: ${dir}`);
  const files = (await readdir(dir)).filter((f) => DATA_FILE.test(f)).sort();
  if (files.length === 0) throw new Error(`No .csv/.txt files in ${dir}`);
  const rows: RawBar[] = [];
  for (const f of files) {
    const text = await readText(join(dir, f));
    if (isHistdataStatusReport(text)) {
      console.log(`${f}: histdata status report, skipped`);
      continue;
    }
    const parsed = parseHistoryCsv(text, f);
    console.log(`${f}: ${parsed.length} rows`);
    rows.push(...parsed);
  }
  return rows;
}

function groupByYear(bars: readonly RawBar[]): Map<number, RawBar[]> {
  const years = new Map<number, RawBar[]>();
  for (const b of bars) {
    const year = new Date(b.time * 1000).getUTCFullYear();
    const bucket = years.get(year);
    if (bucket) bucket.push(b);
    else years.set(year, [b]);
  }
  return years;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      symbol: { type: "string" },
      dir: { type: "string" },
    },
  });
  if (!values.symbol) throw new Error("Missing --symbol (e.g. --symbol XAUUSD)");
  const symbol = values.symbol.toUpperCase();
  const meta = HISTORY_SYMBOLS[symbol];
  if (!meta) throw new Error(`Unknown symbol ${symbol}; expected one of ${Object.keys(HISTORY_SYMBOLS).join(", ")}`);
  const dir = resolve(ROOT, values.dir ?? join("history-import", symbol));

  const bars = sanitizeBars(aggregateTo15m(await readImportRows(dir)));
  if (bars.length === 0) throw new Error(`No bars found in ${dir}`);

  for (const [year, incoming] of [...groupByYear(bars)].sort(([a], [b]) => a - b)) {
    const existing = await readChunkBars(symbol, year);
    const merged = sanitizeBars(mergeBars(existing, incoming));
    const size = await writeChunk(symbol, year, merged, meta.priceScale);
    console.log(
      `${symbol} ${year}: ${incoming.length} imported, ${existing.length} existing -> ${merged.length} bars (${(size / 1024).toFixed(0)} KiB)`,
    );
  }
  logManifest(await writeManifest());
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

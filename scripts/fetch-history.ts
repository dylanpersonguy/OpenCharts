/**
 * Downloads BTCUSD 15m replay history from Binance and writes yearly binary
 * chunks + a manifest: public/history/BTCUSD/{YEAR}.bin, public/history/manifest.json
 *
 * Usage: node scripts/fetch-history.ts [--symbol BTCUSD] [--from YYYY] [--to YYYY] [--force]
 *
 * Past years whose chunk already exists are skipped unless --force; the
 * current year is always refetched. XAUUSD is imported from user-downloaded
 * files instead (see scripts/import-history.ts).
 */
import { parseArgs } from "node:util";
import { sanitizeBars, type RawBar } from "../src/services/replay/data/codec.ts";
import { HISTORY_SYMBOLS, chunkPath, exists, logManifest, writeChunk, writeManifest } from "./history-files.ts";

const BAR_MS = 15 * 60 * 1000;
const BTC_START_MS = Date.UTC(2017, 7, 17);
const BINANCE_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET JSON with retries on 429/418/5xx/network errors, honoring Retry-After. */
async function getJson(url: string, attempts = 6): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let waitMs = 1000 * 2 ** attempt;
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      const retryable = res.status === 429 || res.status === 418 || res.status >= 500;
      lastError = new Error(`HTTP ${res.status} for ${url}`);
      if (!retryable) throw lastError;
      const retryAfter = Number(res.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) waitMs = retryAfter * 1000;
    } catch (err) {
      if (err === lastError) throw err;
      lastError = err;
    }
    console.warn(`  retry ${attempt + 1}/${attempts} in ${waitMs}ms: ${String(lastError)}`);
    await sleep(waitMs);
  }
  throw lastError;
}

/** One page of klines, trying each host in turn. */
async function binancePage(startMs: number, endMs: number): Promise<unknown[]> {
  let lastError: unknown;
  for (const host of BINANCE_HOSTS) {
    const url = `${host}/api/v3/klines?symbol=BTCUSDT&interval=15m&startTime=${startMs}&endTime=${endMs - 1}&limit=1000`;
    try {
      const json = await getJson(url);
      if (!Array.isArray(json)) throw new Error(`Unexpected klines payload from ${host}`);
      return json;
    } catch (err) {
      lastError = err;
      console.warn(`  ${host} failed: ${String(err)}`);
    }
  }
  throw lastError;
}

/** Converts a Binance kline row to a bar; null when malformed. */
function klineToBar(row: unknown): RawBar | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  return {
    time: Math.floor(Number(row[0]) / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
}

/** Fetches 15m bars with open time in [fromMs, toMs), paging forward. */
async function fetchBinance(fromMs: number, toMs: number): Promise<RawBar[]> {
  const bars: RawBar[] = [];
  let cursor = fromMs;
  while (cursor < toMs) {
    const page = await binancePage(cursor, toMs);
    const parsed = page.map(klineToBar).filter((b): b is RawBar => b !== null);
    const last = parsed[parsed.length - 1];
    if (!last) break;
    bars.push(...parsed);
    cursor = last.time * 1000 + BAR_MS;
    await sleep(150);
  }
  return bars;
}

async function fetchYear(year: number, force: boolean): Promise<void> {
  const nowMs = Date.now();
  const currentYear = new Date(nowMs).getUTCFullYear();
  if (year < currentYear && !force && (await exists(chunkPath("BTCUSD", year)))) {
    console.log(`BTCUSD ${year}: exists, skipping`);
    return;
  }
  const fromMs = Math.max(BTC_START_MS, Date.UTC(year, 0, 1));
  // Only completed bars: the bar must have closed before "now".
  const toMs = Math.min(Date.UTC(year + 1, 0, 1), Math.floor(nowMs / BAR_MS) * BAR_MS);
  if (fromMs >= toMs) return;

  console.log(`BTCUSD ${year}: fetching...`);
  const raw = await fetchBinance(fromMs, toMs);
  const bars = sanitizeBars(raw.filter((b) => b.time * 1000 >= fromMs && b.time * 1000 < toMs));
  if (bars.length === 0) {
    console.log(`BTCUSD ${year}: no data`);
    return;
  }
  const size = await writeChunk("BTCUSD", year, bars, HISTORY_SYMBOLS.BTCUSD!.priceScale);
  console.log(`BTCUSD ${year}: wrote ${bars.length} bars (${(size / 1024).toFixed(0)} KiB)`);
}

function parseYear(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1990 || year > 2100) throw new Error(`Invalid ${label} year: ${value}`);
  return year;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      symbol: { type: "string", default: "BTCUSD" },
      from: { type: "string" },
      to: { type: "string" },
      force: { type: "boolean", default: false },
    },
  });
  const symbol = String(values.symbol).toUpperCase();
  if (symbol !== "BTCUSD" && symbol !== "ALL") {
    throw new Error(`fetch:history only downloads BTCUSD; import ${symbol} with "npm run import:history -- --symbol ${symbol}"`);
  }
  const firstYear = Math.max(parseYear(values.from, "--from") ?? 0, new Date(BTC_START_MS).getUTCFullYear());
  const lastYear = parseYear(values.to, "--to") ?? new Date().getUTCFullYear();
  for (let year = firstYear; year <= lastYear; year++) {
    await fetchYear(year, values.force === true);
  }
  logManifest(await writeManifest());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

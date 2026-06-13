#!/usr/bin/env node
/**
 * Seed real historical OHLC for the OpenCharts demo feed.
 *
 * Pulls candles from Binance's public klines endpoint (no API key required)
 * and writes them to src/services/demo/data/<SYMBOL>_<tf>.json.
 *
 * The data is REAL market history — OpenCharts never ships synthetic candles.
 * The demo feed (services/demo/feed.ts) replays a tail slice of these real
 * bars as the "live" stream, time-shifted to the present at runtime.
 *
 * Usage: node scripts/fetch-demo-data.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "src", "services", "demo", "data");

// Display symbol -> Binance trading pair.
const SYMBOLS = {
  BTCUSD: "BTCUSDT",
  ETHUSD: "ETHUSDT",
  SOLUSD: "SOLUSDT",
  BNBUSD: "BNBUSDT",
  XRPUSD: "XRPUSDT",
  ADAUSD: "ADAUSDT",
};

// Terminal timeframe -> Binance interval (identical strings here).
const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];

const LIMIT = 1000;
const API = "https://api.binance.com/api/v3/klines";

/** Map a raw Binance kline row to the terminal's Candle shape (time in seconds). */
function toCandle(row) {
  return {
    time: Math.floor(row[0] / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
}

async function fetchPair(pair, interval) {
  const url = `${API}?symbol=${pair}&interval=${interval}&limit=${LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${pair} ${interval}: HTTP ${res.status}`);
  const rows = await res.json();
  return rows.map(toCandle);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = { symbols: Object.keys(SYMBOLS), timeframes: TIMEFRAMES, generatedAt: new Date().toISOString() };
  for (const [display, pair] of Object.entries(SYMBOLS)) {
    for (const tf of TIMEFRAMES) {
      const candles = await fetchPair(pair, tf);
      const file = join(OUT_DIR, `${display}_${tf}.json`);
      await writeFile(file, JSON.stringify(candles));
      console.log(`${display} ${tf}: ${candles.length} bars`);
    }
  }
  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

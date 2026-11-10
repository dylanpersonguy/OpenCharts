/**
 * Live smoke test for the Hyperliquid market-data source (read-only, public
 * endpoints only; nothing is signed or placed).
 *
 *   node scripts/hl-smoke-marketdata.mts      (Node >= 22.18 strips TS types)
 *   npx tsx scripts/hl-smoke-marketdata.mts   (if tsx is installed)
 */
import { createHyperliquidMarketData } from "../src/hyperliquid/marketData.ts";

const md = createHyperliquidMarketData();

const symbols = await md.getSymbols();
const byCategory = new Map<string, number>();
for (const s of symbols) byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + 1);
console.log(`symbols: ${symbols.length}`);
for (const [cat, n] of [...byCategory].sort((a, b) => b[1] - a[1])) console.log(`  ${cat}: ${n}`);

for (const name of ["xyz:EUR", "BTC"]) {
  const sym = symbols.find((s) => s.name === name);
  const market = md.registry.bySymbol(name);
  console.log(
    `\n${name} (${sym?.displayName}) tick=${sym?.tickSize} assetId=${market?.assetId} maxLev=${sym?.maxLeverage}`,
  );
  const candles = await md.getCandles({ symbol: name, timeframe: "1h", limit: 3 });
  for (const c of candles) {
    console.log(`  ${new Date(c.time * 1000).toISOString()} o=${c.open} h=${c.high} l=${c.low} c=${c.close} v=${c.volume}`);
  }
  const older = await md.getCandles({
    symbol: name,
    timeframe: "1h",
    toMs: (candles[0]?.time ?? 0) * 1000,
    limit: 2,
  });
  console.log(`  older page: ${older.length} bars, last ends before ${older.at(-1) ? new Date(older.at(-1)!.time * 1000).toISOString() : "n/a"}`);
  console.log(`  quote:`, await md.getQuote?.(name));
}

// Past the 5000-bar reach: must come back empty, not loop.
const ancient = await md.getCandles({ symbol: "BTC", timeframe: "1m", toMs: Date.UTC(2024, 0, 1), limit: 100 });
console.log(`\n1m bars before 2024 (beyond HL history cap): ${ancient.length}`);

// Live ticks for ~6s.
let ticks = 0;
let candlesSeen = 0;
md.subscribe((e) => {
  if (e.type === "tick") ticks++;
  else candlesSeen++;
});
md.onConnectionChange?.((s) => console.log(`connection: ${s}`));
md.setSymbolInterest(["BTC", "xyz:EUR"]);
await md.getCandles({ symbol: "BTC", timeframe: "1m", limit: 5 });
md.connect?.();
await new Promise((r) => setTimeout(r, 6000));
console.log(`live: ${ticks} ticks, ${candlesSeen} candle updates in 6s`);
md.disconnect?.();
process.exit(0);

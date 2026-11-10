/**
 * Builder revenue report from Hyperliquid's per-fill CSVs.
 *
 *   npm run builder:revenue -- [--builder 0x..] [--from YYYYMMDD] [--to YYYYMMDD]
 *                              [--out-dir ./builder-reports] [--no-write]
 *
 * Default window: last 7 complete UTC days. Days without fills (404) are skipped.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  aggregate,
  bucketsToCsv,
  dayRange,
  defaultRange,
  fail,
  fetchBuilderRange,
  flagStr,
  formatTable,
  parseArgs,
  parseDay,
  resolveBuilderAddress,
  resolveNetwork,
} from "./lib.ts";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const builder = resolveBuilderAddress(process.env, flagStr(args, "builder"));
  const network = resolveNetwork(process.env);
  const def = defaultRange();
  const fromStr = flagStr(args, "from");
  const toStr = flagStr(args, "to");
  const from = fromStr ? parseDay(fromStr) : def.from;
  const to = toStr ? parseDay(toStr) : def.to;
  const days = dayRange(from, to);
  const first = days[0];
  const last = days[days.length - 1];

  console.log(`builder ${builder} (${network}), ${first}..${last} (${days.length} days)`);
  const res = await fetchBuilderRange(builder, days, network, fetch, (d, p) =>
    console.log(`  ${d}: ${p ? `${p.rows.length} fills` : "no file (no fills)"}`),
  );
  if (res.columns.length) console.log(`CSV columns: ${res.columns.join(", ")}`);
  if (res.skipped) console.warn(`warning: ${res.skipped} rows skipped (unparsable time/fee)`);

  const agg = aggregate(res.rows);
  console.log("\n" + formatTable("day", agg.byDay, 400));
  console.log("\n" + formatTable("market", agg.byMarket));
  console.log("\n" + formatTable("side", agg.bySide));
  console.log(
    `\nTOTAL: ${agg.total.fills} fills, notional ${agg.total.notional.toFixed(2)} USD, builder fees ${agg.total.fee.toFixed(4)} USDC`,
  );

  if (!args.flags.has("no-write")) {
    const dir = flagStr(args, "out-dir") ?? "builder-reports";
    mkdirSync(dir, { recursive: true });
    const tag = `${first}-${last}`;
    const csv =
      bucketsToCsv("day", agg.byDay) + "\n" + bucketsToCsv("market", agg.byMarket) + "\n" + bucketsToCsv("side", agg.bySide);
    writeFileSync(join(dir, `revenue-${tag}.csv`), csv);
    writeFileSync(
      join(dir, `revenue-${tag}.json`),
      JSON.stringify({ builder, network, days: [first, last], missingDays: res.missingDays, ...agg }, null, 2),
    );
    console.log(`wrote ${dir}/revenue-${tag}.{csv,json}`);
  }
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));

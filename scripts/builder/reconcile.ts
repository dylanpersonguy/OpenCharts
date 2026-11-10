/**
 * Compare CSV totals against `builderRewards` from the referral info endpoint.
 *
 *   npm run builder:reconcile -- --from YYYYMMDD [--to YYYYMMDD] [--builder 0x..] [--threshold 0.01]
 *
 * ASSUMPTION (verify once on mainnet): `builderRewards` is the CUMULATIVE
 * builder revenue since the address first earned fees. So `--from` should be
 * the first day with fills, otherwise drift will (correctly) be flagged.
 * The CSV for the current UTC day is not published yet, so the default `--to`
 * is yesterday and small drift from today's accruals is expected.
 * Exit code 2 when drift > threshold (default 1%).
 */
import {
  computeDrift,
  dayRange,
  defaultRange,
  fail,
  fetchBuilderRange,
  flagStr,
  makeInfoClient,
  parseArgs,
  parseDay,
  resolveBuilderAddress,
  resolveNetwork,
} from "./lib.ts";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const builder = resolveBuilderAddress(process.env, flagStr(args, "builder"));
  const network = resolveNetwork(process.env);
  const fromStr = flagStr(args, "from");
  if (!fromStr) fail("--from YYYYMMDD is required (first day the builder earned fees)");
  const from = parseDay(fromStr);
  const toStr = flagStr(args, "to");
  const to = toStr ? parseDay(toStr) : defaultRange().to;
  const threshold = Number(flagStr(args, "threshold") ?? "0.01");

  const res = await fetchBuilderRange(builder, dayRange(from, to), network);
  const csvTotal = res.rows.reduce((s, r) => s + r.fee, 0);

  const info = await makeInfoClient(network);
  const ref = await info.referral({ user: builder });
  const apiTotal = Number(ref.builderRewards);

  const d = computeDrift(csvTotal, apiTotal, threshold);
  console.log(`CSV total (${res.rows.length} fills, ${res.missingDays.length} empty days): ${csvTotal.toFixed(4)} USDC`);
  console.log(`API builderRewards:                ${apiTotal.toFixed(4)} USDC`);
  console.log(`unclaimedRewards / claimedRewards: ${ref.unclaimedRewards} / ${ref.claimedRewards}`);
  console.log(`diff ${d.diff.toFixed(4)} (${(d.ratio * 100).toFixed(2)}%)`);
  if (d.flagged) {
    console.error(`DRIFT above ${(threshold * 100).toFixed(2)}%: check --from, today's accruals, and the builderRewards assumption`);
    process.exit(2);
  }
  console.log("OK: within threshold");
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));

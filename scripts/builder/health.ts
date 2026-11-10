/**
 * Builder wallet health check; exits non-zero on failure (cron / CI friendly).
 *
 *   npm run builder:health -- [--builder 0x..] [--test-user 0x..]
 *
 * Checks: perps account value >= 100 USDC (warn < 150), standard account
 * abstraction, compiled fee config (f <= 100) and, when a test user is given
 * (--test-user or HL_TEST_USER), that `maxBuilderFee` covers the configured fee.
 */
import { getBuilderFeeTenthsBp } from "../../src/hyperliquid/config.ts";
import {
  assertLowercaseAddress,
  checkAbstraction,
  checkAccountValue,
  checkApproval,
  checkFeeConfig,
  fail,
  flagStr,
  healthExitCode,
  makeInfoClient,
  parseArgs,
  resolveBuilderAddress,
  resolveNetwork,
  type Check,
} from "./lib.ts";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const builder = resolveBuilderAddress(process.env, flagStr(args, "builder"));
  const network = resolveNetwork(process.env);
  const info = await makeInfoClient(network);
  const checks: Check[] = [];

  // Check the RAW value so an out-of-range misconfig is reported rather than silently clamped.
  const rawFee = process.env.VITE_HL_BUILDER_FEE;
  const fee = getBuilderFeeTenthsBp({ VITE_HL_BUILDER_FEE: rawFee });
  checks.push(checkFeeConfig(rawFee === undefined || rawFee === "" ? fee : Number(rawFee)));

  const ch = await info.clearinghouseState({ user: builder });
  checks.push(checkAccountValue(Number(ch.marginSummary.accountValue)));
  checks.push(checkAbstraction(await info.userAbstraction({ user: builder })));

  const testUser = flagStr(args, "test-user") ?? process.env.HL_TEST_USER;
  if (testUser) {
    const user = assertLowercaseAddress(testUser.toLowerCase(), "test user");
    checks.push(checkApproval(await info.maxBuilderFee({ user, builder }), fee, user));
  } else {
    checks.push({ name: "maxBuilderFee for test user", level: "warn", detail: "skipped (no --test-user / HL_TEST_USER)" });
  }

  console.log(`builder ${builder} (${network})`);
  for (const c of checks) console.log(`[${c.level.toUpperCase().padEnd(4)}] ${c.name}: ${c.detail}`);
  process.exit(healthExitCode(checks));
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));

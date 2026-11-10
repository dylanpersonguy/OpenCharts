/**
 * Claim referral/builder rewards for the builder wallet.
 *
 *   HL_BUILDER_PRIVATE_KEY=0x... npm run builder:claim            # dry run
 *   HL_BUILDER_PRIVATE_KEY=0x... npm run builder:claim -- --execute
 *
 * The key is read from the environment only, is never logged, and the script
 * refuses to run without it. Use a dedicated key (see docs/OPERATIONS.md).
 */
import { privateKeyToAccount } from "viem/accounts";
import { fail, makeInfoClient, parseArgs, redact, resolveNetwork } from "./lib.ts";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const execute = args.flags.has("execute");
  const network = resolveNetwork(process.env);
  const key = process.env.HL_BUILDER_PRIVATE_KEY?.trim();
  if (!key) fail("HL_BUILDER_PRIVATE_KEY is not set; refusing to run");
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) fail("HL_BUILDER_PRIVATE_KEY is not a 0x-prefixed 32-byte hex key");
  const account = privateKeyToAccount(key as `0x${string}`);
  const configured = process.env.HL_BUILDER_ADDRESS?.trim() || process.env.VITE_HL_BUILDER_ADDRESS?.trim();
  if (configured && configured.toLowerCase() !== account.address.toLowerCase()) {
    fail(`key address ${account.address} does not match configured builder address ${configured}`);
  }

  const info = await makeInfoClient(network);
  const snapshot = async () => {
    const [ref, ch] = await Promise.all([
      info.referral({ user: account.address }),
      info.clearinghouseState({ user: account.address }),
    ]);
    return {
      unclaimed: ref.unclaimedRewards,
      claimed: ref.claimedRewards,
      builder: ref.builderRewards,
      value: ch.marginSummary.accountValue,
    };
  };

  const before = await snapshot();
  console.log(`builder ${account.address} (${network})`);
  console.log(
    `before: unclaimed=${before.unclaimed} claimed=${before.claimed} builderRewards=${before.builder} perpsValue=${before.value}`,
  );
  if (Number(before.unclaimed) <= 0) {
    console.log("nothing to claim");
    return;
  }
  if (!execute) {
    console.log("DRY RUN: pass --execute to send the claimRewards action");
    return;
  }

  const { ExchangeClient, HttpTransport } = await import("@nktkas/hyperliquid");
  const ex = new ExchangeClient({ transport: new HttpTransport({ isTestnet: network === "testnet" }), wallet: account });
  await ex.claimRewards();
  const after = await snapshot();
  console.log(
    `after:  unclaimed=${after.unclaimed} claimed=${after.claimed} builderRewards=${after.builder} perpsValue=${after.value}`,
  );
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));

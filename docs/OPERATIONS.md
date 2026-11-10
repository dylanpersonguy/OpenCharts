# Operations: builder wallet, revenue and incidents

Everything here concerns the **builder wallet**: the address in `VITE_HL_BUILDER_ADDRESS` that Hyperliquid (HL) credits with platform fees. Scripts live in `scripts/builder/` and run with `tsx`.

| command | purpose |
|---|---|
| `npm run builder:health` | wallet and config checks, non-zero exit on failure |
| `npm run builder:revenue` | per-day / per-market / per-side revenue from HL's per-fill CSVs |
| `npm run builder:reconcile` | compare CSV totals with `builderRewards` from the info API |
| `npm run builder:claim` | claim rewards (dry run unless `--execute`) |

Pass script flags after `--`, e.g. `npm run builder:revenue -- --from 20261101 --to 20261107`.

## 1. Builder wallet setup

1. **Create a dedicated key.** Never reuse a personal or trading wallet. Generate it offline, ideally on a hardware wallet. The only time the private key must be online is when you run `builder:claim`.
2. **Fund it with at least 100 USDC of perps account value.** HL requires a builder to hold at least 100 USDC in its perps account to receive fees. Deposit via the Hyperliquid app (Arbitrum USDC). Keep a buffer: `builder:health` warns below 150 and fails below 100.
3. **Use standard account mode.** Do not enable unified account or portfolio margin on this address. `builder:health` checks the `userAbstraction` info request and fails unless the mode is `disabled` or `default` (both are standard).
4. **Set the address** in the front-end build (`VITE_HL_BUILDER_ADDRESS`) and for scripts (`HL_BUILDER_ADDRESS`). Use lowercase in anything you type by hand: the stats bucket is case sensitive and the scripts reject mixed case.
5. **Test on testnet first**: `VITE_HL_NETWORK=testnet` and `HL_NETWORK=testnet`, then run `builder:health`.
6. **Do not let the balance drift down.** Claimed rewards can be withdrawn, but never withdraw below 100 USDC of account value or fees stop accruing.

### Environment variables

See `.env.example` for the full list. Scripts read:

| variable | needed by | notes |
|---|---|---|
| `HL_NETWORK` | all | `mainnet` (default) or `testnet`; falls back to `VITE_HL_NETWORK` |
| `HL_BUILDER_ADDRESS` | all | falls back to `VITE_HL_BUILDER_ADDRESS` |
| `VITE_HL_BUILDER_FEE` | health | validated: integer 0..100 |
| `HL_TEST_USER` | health | an address that approved the builder; checks `maxBuilderFee` |
| `HL_BUILDER_PRIVATE_KEY` | claim only | secret. Never logged; errors are redacted. Refuses to run if missing or if it does not match the builder address |

## 2. Revenue reporting

`builder:revenue` downloads `https://stats-data.hyperliquid.xyz/Mainnet/builder_fills/{lowercase_address}/{YYYYMMDD}.csv.lz4` for each UTC day, decodes the LZ4 frame, and aggregates by day, market and side. It prints tables and writes `builder-reports/revenue-<from>-<to>.{csv,json}`. Days with no fills return 404 and are skipped. The default window is the last 7 complete UTC days (today's file is not published yet).

Columns observed in the files (verified 2026-11):

```
time,user,coin,side,px,sz,crossed,special_trade_type,tif,is_trigger,counterparty,closed_pnl,twap_id,builder_fee
```

`builder_fee` is in USDC. HL does not document this schema, so the parser resolves columns by name, prints the discovered columns on every run, and fails loudly if no builder-fee-like column exists. If HL renames columns, the failure message lists what it found. `side` is HL's raw value (`Bid`/`Ask`).

`builder:reconcile --from <first fill day>` compares the CSV total with `referral.builderRewards`. It assumes `builderRewards` is cumulative since the address first earned fees (strongly suggested by live data, where a one-week CSV total is a tiny fraction of the cumulative figure), so `--from` must be the first day with fills. Drift above 1% exits with code 2. Small drift is expected if you run it right after midnight UTC, before the previous day's file is published.

## 3. Claiming

```
HL_BUILDER_PRIVATE_KEY=0x... npm run builder:claim              # dry run: prints balances only
HL_BUILDER_PRIVATE_KEY=0x... npm run builder:claim -- --execute  # signs claimRewards
```

It prints `unclaimedRewards`, `claimedRewards`, `builderRewards` and perps account value before and after. The `claimRewards` action is an L1 action signed with the builder key.

**Cadence:** weekly is plenty. More often costs nothing but adds key exposure. Always run `builder:health` afterwards so you confirm the wallet is still above 100 USDC.

Do not put the private key in CI for routine runs. If you do automate claims, use a dedicated environment with required reviewers and a key that holds nothing beyond the 100 USDC minimum.

## 4. Monitoring and cron

Suggested schedule (UTC):

| job | when | alert on |
|---|---|---|
| `builder:health` | every 30 min | non-zero exit |
| `builder:revenue` | daily 01:00 | missing days when you expect volume |
| `builder:reconcile --from <first day>` | daily 02:00 | exit code 2 |

crontab:

```
*/30 * * * * cd /srv/openbroker && HL_BUILDER_ADDRESS=0x... HL_TEST_USER=0x... VITE_HL_BUILDER_FEE=50 npm run -s builder:health || /usr/local/bin/notify "builder health failed"
0 1 * * *   cd /srv/openbroker && HL_BUILDER_ADDRESS=0x... npm run -s builder:revenue
```

A sample GitHub Actions workflow (not activated; copy to `.github/workflows/builder-health.yml` to use). It needs no secrets other than values you consider non-sensitive; addresses are public.

```yaml
name: builder-health
on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch:
jobs:
  health:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run builder:health
        env:
          HL_NETWORK: mainnet
          HL_BUILDER_ADDRESS: ${{ vars.HL_BUILDER_ADDRESS }}
          HL_TEST_USER: ${{ vars.HL_TEST_USER }}
          VITE_HL_BUILDER_FEE: ${{ vars.VITE_HL_BUILDER_FEE }}
  revenue:
    runs-on: ubuntu-latest
    if: github.event_name == 'workflow_dispatch'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run builder:revenue
        env:
          HL_BUILDER_ADDRESS: ${{ vars.HL_BUILDER_ADDRESS }}
      - uses: actions/upload-artifact@v4
        with:
          name: builder-revenue
          path: builder-reports/
```

Never add `HL_BUILDER_PRIVATE_KEY` to this workflow.

## 5. Kill switch and dynamic fee

Set `VITE_FEE_CONFIG_URL` at build time to a JSON file you control:

```json
{ "enabled": true, "feeTenthsBp": 50, "message": "Platform fee reduced this week" }
```

- `enabled: false` makes `getBuilderParam()` return nothing, so orders go out with no builder fee.
- `feeTenthsBp` overrides the compiled fee, clamped to 100.
- `message` is shown as a banner (`useFeeConfigStore`).
- The app polls every 60 seconds (`startFeeConfigPolling` in `src/hyperliquid/feeConfig.ts`).

**Failure policy is fail-open.** If the file cannot be fetched, the app keeps the last good value, or the compiled default if it never succeeded. So the kill switch only works while the config host is reachable and a tab is polling; a user who already has the app open picks it up within about a minute. If you need an unconditional off, rebuild and redeploy with `VITE_HL_BUILDER_FEE=0`.

## 6. Incident runbook

### Turn fees off now
1. Set `"enabled": false` in the remote config (fast, ~1 min for open tabs).
2. If the config host is down or you need certainty: rebuild and deploy with `VITE_HL_BUILDER_FEE=0` (or empty `VITE_HL_BUILDER_ADDRESS`).
3. Confirm with a small test order; fills in the next CSV should show no `builder_fee`.

### Orders fail with a builder-fee error
Symptom: orders rejected with text like "Builder fee has not been approved." (matched by `isBuilderFeeApprovalError`; the exact wording is community-observed and not in HL's docs, so the matcher is deliberately loose. Confirm on testnet.)
Causes and fixes:
- The user never approved us, or approved less than the current fee. Re-run the approval flow (`approveBuilderFee`) for the current fee.
- You **raised** the fee. Every existing user's approval is for the old maximum, so their orders fail until they re-approve. Lowering never breaks anyone. When raising: announce it, and make the trading flow catch `isBuilderFeeApprovalError` and route to the approval prompt. Roll back by lowering `feeTenthsBp` in the remote config if the error rate spikes.
- Check an individual user: `npm run builder:health -- --test-user 0x...`.

### Fees stopped accruing
Run `builder:health`. Usual causes: perps account value fell below 100 USDC, the wallet was switched to unified or portfolio-margin mode, or the address in the build is wrong. Re-deposit or switch back, then confirm with the next day's CSV.

### Hyperliquid outage
Orders will fail regardless of fees; nothing to do on our side except surface HL's status. After recovery run `builder:health`, and later `builder:reconcile`, since reporting files can lag.

### Key suspected compromised
Move any claimed funds to a new key immediately (claim first if you still control it), ship a build with the new address, and expect users to re-approve the new builder. Treat the old address as burned.

### Reconcile drift
Check `--from` (must be the first day with fills), that the range ends before today, and that no days failed to download (the script lists empty days). If drift persists with a correct range, the `builderRewards` semantics may have changed; compare against the claim before/after numbers.

## 7. Key handling checklist

- Dedicated key, hardware wallet if possible, never in `.env` files or in the front-end bundle (`VITE_*` is public).
- `builder:claim` reads the key only from the environment, never prints it, and redacts 32-byte hex in errors.
- Rotate if it ever touches a shared machine or a CI log.

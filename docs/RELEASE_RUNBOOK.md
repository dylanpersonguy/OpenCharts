# Release runbook: going live on Hyperliquid mainnet

This is the ordered sequence for turning the Hyperliquid broker on for real users. Each stage has an exit criterion; do not start the next stage until it is met. Everything before stage 3 uses **no real fees and a single dedicated account**.

Related documents: [TESTNET_CHECKLIST.md](./TESTNET_CHECKLIST.md) (Phase 0 evidence), [COMPLIANCE_CHECKLIST.md](./COMPLIANCE_CHECKLIST.md), [SECURITY_MODEL.md](./SECURITY_MODEL.md), [OPERATIONS.md](./OPERATIONS.md) (builder wallet, scripts, incident runbook), [FEES.md](./FEES.md).

## Roles

- **Release owner**: runs this document, owns the go/no-go call.
- **Builder-key custodian**: the only person (or hardware wallet) holding `HL_BUILDER_PRIVATE_KEY`.
- **Counsel / compliance contact**: signs off the compliance gate.
- **On-call**: watches monitoring for the first 72 hours.

## Pre-launch gate (all must be checked)

Record the commit SHA being released next to this list.

**Quality**
- [ ] CI is green on the release commit: typecheck, lint (`--max-warnings=0`), vitest, build, bundle size, package shape.
- [ ] `npm run e2e:hl` is green (the mocked-network suite; workflow `.github/workflows/e2e.yml`). No `test.fixme` / `test.fail` is left that hides a launch-relevant bug: list any that remain and justify each.

**Phase 0 (testnet)**
- [ ] Every row of the sign-off table in [TESTNET_CHECKLIST.md](./TESTNET_CHECKLIST.md) is PASS, or FAIL with an accepted, documented mitigation. In particular: W1 (both wallets), T3, T4, X1 (builder fee on HIP-3), X2 (error text matched), X4 (agent cannot withdraw).
- [ ] The latest `hl-testnet-verify` JSON report is attached to the release ticket, run on the release commit.

**Compliance** ([COMPLIANCE_CHECKLIST.md](./COMPLIANCE_CHECKLIST.md) section 2)
- [ ] Counsel has reviewed terms, risk disclosure and marketing; `TERMS_REVIEWED_BY_COUNSEL` is set and `TERMS_VERSION` bumped.
- [ ] Edge geo-blocking is deployed and tested from outside the allowed regions; `VITE_GEO_CHECK_URL` and `VITE_GEO_FAIL_MODE` decisions recorded.
- [ ] Wallet-screening decision recorded (`VITE_SCREEN_URL` or an explicit "none" with reasons).
- [ ] CSP / security headers verified with a response-header check on the production host.

**Security** ([SECURITY_MODEL.md](./SECURITY_MODEL.md))
- [ ] Open findings in section 4 and residual risks in section 2 are accepted in writing by the release owner.
- [ ] No secret is present in any `VITE_*` variable, the build output, or CI logs (`grep` the `dist/` folder for `0x` + 64 hex).
- [ ] Incident contact and `SECURITY.md` are current.

**Operations**
- [ ] Builder wallet is a dedicated key (hardware or offline), standard account mode, funded (see stage 3).
- [ ] The remote fee-config file is hosted on infrastructure you control and tested (`enabled:false` and `enabled:true` both exercised on staging).
- [ ] Monitoring jobs from [OPERATIONS.md](./OPERATIONS.md) section 4 are scheduled and alert to a person.

## Stage 1: testnet sign-off

1. Complete [TESTNET_CHECKLIST.md](./TESTNET_CHECKLIST.md) with the **production-intended** `HL_BUILDER_FEE` and a fresh throwaway key.
2. Fix every FAIL in code, re-run the failing items, and re-run the whole script on the final commit.
3. Update the assumptions that the results changed (`ERROR_RULES`, `isBuilderFeeApprovalError`, `docs/FEES.md`, comments marked "verify on testnet").

**Exit:** all rows signed off; report attached.

## Stage 2: mainnet smoke test with an $11 trade

Purpose: confirm what testnet cannot: the real builder fee on real markets (including a HIP-3 market, answering X1 for production), real error strings and a real fill reaching the builder wallet.

1. **Dedicated account.** A new wallet that holds nothing else. Deposit about **$25 USDC** (Arbitrum, above the 5 USDC bridge minimum; remember the credit delay). This is the only real money at risk in this stage, and the amount is deliberate.
2. **Build** a staging deployment (not the public domain) with mainnet settings: `VITE_HL_NETWORK=mainnet`, the production `VITE_HL_BUILDER_ADDRESS`, the production fee, geo gate and terms enabled. Fee-config URL set.
3. **Walk the real flow** in the real UI with that account: connect, set up trading (two signatures, read both wallet prompts: the fee in the prompt must equal the disclosure), then place **one market order of about $11** (above the $10 minimum) on a core market, close it, then repeat on one HIP-3 market. Use a size that makes a fee visible but a loss negligible.
4. **Verify the money trail** after each trade:
   - the fill in Hyperliquid's own trade history shows both the exchange fee and the builder fee;
   - after the next UTC midnight plus an hour: `npm run builder:revenue` shows the fills, `npm run builder:reconcile` has drift under 1%;
   - `npm run builder:health -- --test-user <smoke account>` passes (approval seen).
5. **Withdraw** the remaining balance back to the owner address (confirms the withdraw path and the 1 USDC fee statement).
6. **Revoke** the smoke account's agent in Hyperliquid's API-wallet settings.

**Exit:** both fills carried the expected builder fee; CSV and `builderRewards` agree; withdrawal succeeded; no unexpected error text. Any mismatch is a stop: switch the staging fee off (kill switch below), fix, repeat.

## Stage 3: builder wallet funding and health check

Follow [OPERATIONS.md](./OPERATIONS.md) section 1.

1. Generate the builder key offline (hardware wallet preferred). The private key must only ever be online for `builder:claim`.
2. **Fund the perps account with at least 100 USDC (target 150)**: HL only pays builder fees to a builder with 100+ USDC of perps account value. Do not enable unified account or portfolio margin on this address.
3. Run `npm run builder:health` against the production address. Required: exit code 0 (no FAIL). Resolve every WARN or record why it is acceptable.
4. Confirm the address in the build equals the funded address (`VITE_HL_BUILDER_ADDRESS`, lowercase). A wrong address means fees go nowhere.

**Exit:** `builder:health` passes on mainnet; the custodian has confirmed the key backup procedure.

## Stage 4: enable the fee and open to users

1. Deploy the production build with the fee enabled (`VITE_HL_BUILDER_FEE` as decided, remote config `enabled: true`). Start with a **soft launch**: limited audience, no marketing push.
2. Verify on the production domain with the smoke account: setup dialog fee text, ticket disclosure, one tiny order.
3. Announce. Keep the fee unchanged for the first weeks: **raising it later forces every user to re-approve** and orders fail until they do (see [FEES.md](./FEES.md) and the "Orders fail with a builder-fee error" runbook). Lowering is always safe.

**Exit:** first real user orders show `builder_fee` in the next CSV; no spike in order errors.

## Stage 5: monitoring (first 72 hours, then ongoing)

| Signal | Source | Expected | Action if not |
|---|---|---|---|
| Builder wallet health | `builder:health` every 30 minutes | exit 0 | page on-call; see "Fees stopped accruing" |
| Daily revenue | `builder:revenue` 01:00 UTC | non-zero on active days | check approvals and kill-switch state |
| Reconciliation | `builder:reconcile` 02:00 UTC | exit 0 (drift < 1%) | see "Reconcile drift" |
| Order error rate | browser error tracking / support inbox | builder-fee rejections near zero | kill switch or lower fee; see below |
| Geo/compliance gate | spot check from a blocked region weekly | block page shown | fix edge rule immediately |
| Builder balance | `builder:health` account value | above 150 USDC | top up before it falls under 100 |
| Hyperliquid status | HL status channels | normal | expect failures regardless of our code |

Claim rewards at most weekly, and only with the custodian present (`npm run builder:claim`, dry run first); run `builder:health` right after.

## Rollback: the kill switch

Use these in order; stop at the first one that is enough.

1. **Remote kill switch (about 1 minute for open tabs).** Set `"enabled": false` (optionally a `message`) in the fee-config JSON. Orders then go out with no builder fee. This only works while the config host is reachable and a tab is polling (fail-open policy).
2. **Lower the fee** (`feeTenthsBp` in the remote config). Always safe: existing approvals cover any lower fee.
3. **Rebuild and redeploy** with `VITE_HL_BUILDER_FEE=0` or an empty `VITE_HL_BUILDER_ADDRESS`. Unconditional, takes a deploy.
4. **Take the whole app down** (host-level maintenance page) if the problem is not fee-related (compliance, security incident). Follow the incident process in [SECURITY_MODEL.md](./SECURITY_MODEL.md) section 6.
5. **Key compromise:** follow "Key suspected compromised" in [OPERATIONS.md](./OPERATIONS.md): claim and move funds if you still control the key, ship the new address, expect re-approval.

After any rollback: confirm with one small order that no `builder` is sent (the e2e kill-switch test shows what to expect), confirm in the next CSV that `builder_fee` stopped, write down the cause, and re-run the relevant part of [TESTNET_CHECKLIST.md](./TESTNET_CHECKLIST.md) before turning things back on.

## Release record

| Field | Value |
|---|---|
| Release commit SHA | |
| Release owner | |
| Testnet report file | |
| Smoke trade IDs (core / HIP-3) | |
| `builder:health` result (date) | |
| Counsel sign-off (date) | |
| Go-live time (UTC) | |

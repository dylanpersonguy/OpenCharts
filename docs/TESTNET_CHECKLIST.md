# Testnet verification checklist (Phase 0)

Everything the broker layer assumes about Hyperliquid (HL) that has **not yet been confirmed against a live exchange**. Each item says how to test it, what a pass looks like, and which code to change if it fails. Nothing here is a launch decision by itself: the sign-off table at the bottom feeds the go-live gate in [RELEASE_RUNBOOK.md](./RELEASE_RUNBOOK.md).

**Rules for every test on this page**

- Testnet only. Never use a mainnet key, mainnet funds or a mainnet endpoint. Use a **throwaway** wallet created for this purpose and discard it afterwards.
- Never paste a private key into an issue, chat, log or this document. Pasting the JSON report from the script is safe: it contains no keys (all `0x` strings of 64+ hex chars are redacted before writing).
- Record results in the sign-off table with the date, the person, and the report file name.

## 0. Setup

1. **Throwaway wallet.** Create a new account in MetaMask or Rabby (a separate browser profile is best). Add Arbitrum Sepolia if the wallet does not have it (chain id 421614, `0x66eee`).
2. **Fund it with testnet USDC.** Use the Hyperliquid testnet faucet (`https://app.hyperliquid-testnet.xyz/drip`, 1,000 mock USDC; HL has changed the eligibility rules over time, so check the page for the current conditions). Alternative: bridge Arbitrum Sepolia USDC with the app's Deposit button (item W4). You need roughly **$100**.
3. **Builder wallet.** A separate address you control (it only needs to exist; it receives testnet fees). Note its lowercase address.
4. **Environment** (shell only, never a committed file):

   ```
   export HL_NETWORK=testnet
   export HL_BUILDER_ADDRESS=0x...            # your testnet builder address
   export HL_BUILDER_FEE=100                  # tenths of a bp; use the value you intend to ship
   export HL_TEST_PRIVATE_KEY=0x...           # THROWAWAY testnet key (main wallet)
   ```

5. **Run the script** (automates the items tagged `script`):

   ```
   npx tsx scripts/hl-testnet-verify.mts --report testnet-report.json
   ```

   It refuses to start unless `HL_NETWORK=testnet`, refuses any non-testnet endpoint, blocks every host except `api.hyperliquid-testnet.xyz` at the fetch layer, and cancels/closes everything it opened in a `finally` block. Try `--dry-run` first (no key; checks refusals, signing wiring and public read-only calls). Flags: `--notional <usd>` (default 12), `--skip-hip3`, `--dexes a,b`, `--all-dexes`, `--keep-funds`.
6. **Manual items** (tagged `manual`) use the app: `VITE_ADAPTER=hyperliquid VITE_HL_NETWORK=testnet VITE_HL_BUILDER_ADDRESS=0x... npm run dev`.
7. Paste the `findings` and failing `steps` of the report back to whoever maintains the assumptions; the keys referenced below (for example `findings.modifyKeepsBuilderFee`) are in that file.

## 1. Wallet and onboarding

### W1. Chain switch and `eth_signTypedData_v4` with chainId 421614 (approveAgent, approveBuilderFee, withdraw3) in MetaMask and Rabby

- **Test (manual, both wallets):** start the wallet on Ethereum mainnet. Connect, press Continue in the setup dialog. Then use Deposit/Withdraw to request a withdrawal of a few USDC.
- **Expect:** the wallet asks to switch to Arbitrum Sepolia once; each of the three signatures succeeds without an "invalid chainId" or "chainId must match" error; HL accepts them; no ETH is spent. If the user rejects the switch, the dialog shows a clear message and nothing is half-applied.
- **If it fails:** `src/hyperliquid/wallet/setup.ts` `ensureWalletChain` (switch/add-chain fallback), `src/hyperliquid/wallet/clients.ts` `signatureChain` / `createBrowserSigner` (domain chainId vs wallet chain) and the withdraw path in `src/hyperliquid/wallet/funds.ts` `withdrawUsdc` (it must go through the same chain handling). Rabby in particular may require the domain chainId to equal its active chain exactly; the fallback in `ensureWalletChain` ("use whatever chain the wallet is on") is what HL accepts.
- **Partially covered by:** script step 2/3 (Node wallet enforces the same chain rule) and the Playwright suite. Real wallets still need a human.

### W2. Agent renewal replaces the old agent

- **Test (script):** step `2b` approves a second agent with the same base name and lists `extraAgents`. **Manual:** press "Renew trading key" in the wallet menu when due (or shorten `DEFAULT_AGENT_TTL_MS` locally) and look at the Hyperliquid API-wallet list.
- **Expect:** the old agent is gone (`findings.renewalReplacesOld === true`), so agents do not accumulate toward HL's per-account limit.
- **If it fails (old still listed):** `src/hyperliquid/agentKey.ts` `buildAgentName` / `AGENT_BASE_NAME` and `src/hyperliquid/wallet/setup.ts` `approveAgentStep`. The name embeds `valid_until <ms>`; if HL treats the full string as the name, renewals pile up. Options: a stable name without the suffix plus a separate expiry policy, or revoking the previous agent explicitly (approve it with a zero address / name per HL docs) before saving the new one.

### W3. `extraAgents` `validUntil`

- **Test (script):** step `2` compares `extraAgents[].validUntil` with the requested expiry; manual: inspect the report's `findings.extraAgentsEntry`.
- **Expect:** an entry with our address, the `OpenBroker valid_until <ms>` name and `validUntil` equal to the requested millisecond timestamp (within a minute), `null` meaning "no expiry".
- **If it fails:** `src/hyperliquid/wallet/resolve.ts` `resolveSessionStatus` (the `match` that decides whether a stored agent is still valid) and `src/hyperliquid/agentKey.ts` `computeValidUntil` / `needsRotation`. If HL reports seconds or omits the field, adapt the comparison; a wrong match here silently logs users out of trading or lets an expired agent look valid.

### W4. Bridge deposit of at least 5 USDC on Arbitrum Sepolia, and the credit delay

- **Test (manual):** with a wallet holding Arbitrum Sepolia ETH and testnet USDC, use Deposit with 5 USDC, then 4 USDC. Time how long until the HL balance shows it.
- **Expect:** 5 USDC is credited (record the delay, typically under a minute or two on testnet); the app refuses 4 USDC client-side (below the minimum, which HL does not credit). While waiting, the UI explains that funds may take a few minutes.
- **If it fails:** `src/hyperliquid/wallet/funds.ts` `MIN_DEPOSIT_USDC`, `validateDeposit`, `depositUsdc`, `BRIDGE_ADDRESS` / `USDC_ADDRESS` (testnet addresses) and the waiting-state copy in `src/hyperliquid/onboarding/DepositPanel.tsx`. A wrong bridge or USDC address on testnet means lost funds on mainnet too: check both.
- **Safety:** use the app's own 4 USDC refusal; do not bypass it to "prove" the loss.

### W5. Withdraw fee and minimum

- **Test (manual):** withdraw 2 USDC then 10 USDC to the same Arbitrum Sepolia address.
- **Expect:** HL deducts the fee the UI claims (`WITHDRAW_FEE_USDC`, currently 1) and the minimum matches `validateWithdraw`; the net amount shown to the user is correct.
- **If it fails:** `src/hyperliquid/wallet/funds.ts` `WITHDRAW_FEE_USDC`, `validateWithdraw`, `withdrawUsdc` and the displayed net amount in `DepositPanel.tsx`.

### W6. `sendAsset` USDC to a HIP-3 dex (for example `xyz`)

- **Test (script, step `4h`):** if the first HIP-3 order fails for lack of collateral, the script calls `sendAsset` USDC to the dex and retries (`findings.sendAssetToDex`). **Manual:** Deposit panel, "Move funds to a market group" (Core perps to `xyz`).
- **Expect:** the transfer succeeds, the dex's `clearinghouseState` shows the balance and the HIP-3 order can be placed. Record whether a standard (non-unified) account needs this step at all (see W7).
- **If it fails:** `src/hyperliquid/wallet/funds.ts` `moveUsdc` (token string `USDC:<tokenId>` format, source/destination dex names) and the HIP-3 hints in `DepositPanel.tsx`.

### W7. `userAbstraction` on testnet

- **Test (script, step `pre`):** logs `info userAbstraction` for the account (`findings.userAbstraction`). **Manual:** repeat with an account switched to unified account and to portfolio margin in the HL UI.
- **Expect:** a stable set of values (`default` / `disabled` = standard, plus the unified and portfolio-margin values). Record exact strings.
- **If it fails or differs:** `src/hyperliquid/wallet/clients.ts` `HlInfoApi` (the call must exist on testnet), `src/hyperliquid/wallet/funds.ts` `getAccountSummary` and `scripts/builder/lib.ts` `checkAbstraction` (builder wallet must be standard).

### W8. Error wording for builder-limit and volume errors during setup

- **Test (manual):** approve a builder fee from an account that (a) already has the maximum number of builder approvals, (b) has never deposited or traded (volume/balance requirements), (c) has no HL account yet.
- **Expect:** the exact HL error strings; record them. Today's mapping is guesswork.
- **If it differs:** `src/hyperliquid/wallet/errors.ts` `humanizeError` (the `builder fee approvals limit`, `insufficient ... volume/balance`, `must deposit before` patterns).

## 2. Trading

### T1. Agent-signed actions affect the master account

- **Test (script, steps `4`, `4h`, `5`, `6`):** orders are signed by the agent key only; fills and positions are then read for the MAIN address.
- **Expect:** the position, fills and `builderFee` appear under the main address with no `vaultAddress` in the action.
- **If it fails:** `src/hyperliquid/exchange.ts` (`createSdkExchange`; the header comment documents the assumption) and `src/hyperliquid/trading.ts` `ready()` (which key signs).

### T2. The $10 minimum applies to non-reduce-only orders only

- **Test (script):** step `8a` places a ~$5 order (raw exchange text recorded in `findings.minOrderValueErrorRaw`); step `5` reduces a position by about $6 with a reduce-only order (`findings.reduceOnlyBelowMinAccepted`).
- **Expect:** the $5 order is rejected with a minimum-value message; the $6 reduce-only is accepted.
- **If it fails:** `src/hyperliquid/orders.ts` `MIN_ORDER_NOTIONAL_USD`, `planOrder` (the notional check), `closeWire` / `positionTpslWire` (must stay exempt), and **`ERROR_RULES`** in the same file: check `findings.minOrderValueRuleMatches`. If false, add the real wording to the minimum-value rule.

### T3. `modify`: builder fee semantics and oid change

- **Test (script, step `6`):** places a far-from-market Gtc order WITH the builder, modifies it to a marketable price, and checks the resulting fill (`findings.modifyKeepsBuilderFee`, `findings.modifyChangesOid`).
- **Expect (to keep the current design):** the modified order's fill still carries `builderFee`, and the oid either stays or `trading.ts` follows it.
- **If the builder is dropped:** `src/hyperliquid/trading.ts` `modifyOrder` currently sends `modify` without a builder (SDK schema). Switch to cancel-and-replace when the order could take, or accept and document free fills (`docs/FEES.md`). **If the oid changes:** `modifyOrder` re-resolves by cloid; verify the UI keeps pointing at the right order.

### T4. positionTpsl: size `0` versus the full position size

- **Test (script, step `7` and `5`):** places TP and SL with `grouping: "positionTpsl"` and prints the resting trigger orders' `sz` and `isPositionTpsl`; after a partial close it prints the sizes again (`findings.positionTpslOrderShape`, `findings.positionTpslSizeIsFull`, `findings.positionTpslAfterPartialClose`).
- **Expect:** the order is accepted with the full position size, and the displayed size follows the position (or stays the original size, which must then be handled when the position shrinks).
- **If it fails:** `src/hyperliquid/orders.ts` `positionTpslWire` (size string) and `src/hyperliquid/trading.ts` `modifyPosition`; also `accountState.ts` `protectionFor`, which maps these orders back onto the position.

### T5. Default leverage heuristics

- **Test (script, step `4`):** logs `getLeverage("BTC")` after the first order; manual: a fresh account on a HIP-3 market.
- **Expect:** a new account starts at cross with leverage equal to the market maximum (this is what "a value other than the maximum means the user chose it" relies on); after our default it is 3x cross for BTC and isolated for isolated-only markets.
- **If it fails:** `src/hyperliquid/trading.ts` `ensureLeverage` (the `current.value !== m.maxLeverage` heuristic) and `src/hyperliquid/orders.ts` `defaultLeverageFor`. A wrong default silently overrides a user's own leverage or leaves 40x on.

### T6. Unified account and portfolio-margin equity

- **Test (manual):** connect an account in unified mode, then portfolio margin; compare the app's equity, balance and free margin with HL's own UI. Include an account with spot USDC only.
- **Expect:** the numbers match HL within rounding. In unified mode, balances live in spot; `clearinghouseState` alone may show zero.
- **If it fails:** `src/hyperliquid/accountState.ts` `summarizeStates` / `getAccount` (add spot balance and abstraction-aware equity) and `src/hyperliquid/wallet/funds.ts` `getAccountSummary`.

### T7. `closedPnl` is gross of fees

- **Test (script, steps `4`/`5`):** the report records each closing fill's `closedPnl`, `fee` and `builderFee`; compare with HL's trade history.
- **Expect:** `closedPnl` excludes fees (so net = closedPnl - fee - builderFee).
- **If it fails:** `src/hyperliquid/accountState.ts` `mapClosedPositions` (realized PnL and `commission`/`platformFee` fields).

### T8. `allMids{dex}` key prefixes

- **Test (script, step `1`):** prints sample keys of `allMids({dex})` and sets `findings.allMidsKeysPrefixed.<dex>`.
- **Expect:** HIP-3 keys are prefixed `dex:` (for example `xyz:EUR`) and core keys are bare (`BTC`); no `@index` keys for perps.
- **If it fails:** `src/hyperliquid/accountState.ts` `midsByCoin` and `src/hyperliquid/marketData.ts` `onMids`: mids would not match `HlMarket.coin` and prices would be missing.

### T9. `frontendOpenOrders` per dex

- **Test (script, step `7`):** `dumpOpenOrders` queries each dex separately.
- **Expect:** orders on a HIP-3 dex appear only when queried with `dex`, and the core query does not include them.
- **If it fails:** `src/hyperliquid/accountState.ts` `openOrders` (per-dex fan-out) and the `cancelAllOrders` / TP-SL protection logic that depends on it.

### T10. WebSocket `open` hook (reconnect resync)

- **Test (manual):** with the app open on a funded account, kill the network for 30 seconds (devtools offline), restore it, and watch for positions/orders updating without a reload.
- **Expect:** after the reconnect, state is re-synced once (not on the first open).
- **If it fails:** `src/hyperliquid/exchange.ts` `createSdkStreams` (`transport.socket.addEventListener("open", ...)`; the SDK's socket may be replaced on reconnect so the listener is lost) and `trading.ts` `startLive` (`offReconnect`).

## 3. Operations

### O1. `claimRewards` also claims builder fees

- **Test (manual, testnet):** after the script has generated builder fees, run `HL_NETWORK=testnet HL_BUILDER_PRIVATE_KEY=... npm run builder:claim` (dry run), then with `--execute`.
- **Expect:** `unclaimedRewards` includes the builder's fee revenue, drops to ~0 after the claim and the balance rises by that amount.
- **If it fails:** `scripts/builder/claim.ts` and the "Claiming" section of `docs/OPERATIONS.md` (revenue may need another action).

### O2. `builder_fills` reconcile semantics (`builderRewards` is cumulative)

- **Test (manual):** `npm run builder:revenue` and `npm run builder:reconcile -- --from <first fill day>` after the script's fills land (the day file appears after UTC midnight).
- **Expect:** CSV total equals `referral.builderRewards` (cumulative since the first fee) within the 1% tolerance; the CSV schema is the documented one (`builder_fee` column, USDC).
- **If it fails:** `scripts/builder/reconcile.ts` / `scripts/builder/lib.ts` `computeDrift`, `parseBuilderFills`. Check whether testnet files live under `Testnet/` in the stats bucket (`builderFillsUrl`).

## 4. Market data

### M1. Closed-market behaviour

- **Test (manual, weekend and a US-closed hour):** open an HIP-3 stock/forex/commodity market, watch candles, `bbo` and `allMids`.
- **Expect:** the market keeps trading (24/7); prices may be stale or jump; the notice in `HlMarketNotice` appears at the right times; no empty chart, no error toasts.
- **If it fails:** `src/hyperliquid/marketData.ts` (empty `bbo` sides, zero mids, stale last candle handling) and `src/hyperliquid/ui/marketHours.ts` (schedules are approximate and UTC-only).

## 5. Found while building the verification tooling

### X1. Does the builder fee apply to HIP-3 markets?

- **Test (script, step `4h`):** market order on a HIP-3 market (a non-crypto one if testnet has any) with the builder, then read the fill.
- **Expect (our assumption):** the fill has `builderFee > 0` equal to notional x f / 100000. `findings.builderFeeAppliesToHip3` is `true`.
- **If false/absent:** `docs/FEES.md` and the order ticket disclosure (`feeCopy.ts`, `HlOrderPanel.tsx`) must stop promising a fee on HIP-3; consider disabling the builder param for HIP-3 (`orders.ts` `builderField` per market). If testnet has no tradable HIP-3 market the result is `null`: repeat on mainnet in the smoke test (RELEASE_RUNBOOK step 2) with a $11 trade.

### X2. Exact error text when the builder fee is not approved (and when it is approved below what we send)

- **Test (script, step `8b`):** a second fresh account without approval places an order carrying the builder; then with a lower approval (`findings.builderNotApprovedErrorRaw`, `findings.builderFeeAboveApprovedErrorRaw`).
- **Expect:** `findings.isBuilderFeeApprovalErrorMatches === true` and `findings.isBuilderFeeApprovalErrorMatchesAboveMax === true`.
- **If it fails:** `src/hyperliquid/feeConfig.ts` `isBuilderFeeApprovalError` (add the exact wording) and `src/hyperliquid/orders.ts` `ERROR_RULES` (humanized text). **Known issue found by the e2e suite:** the gateway humanizes the message BEFORE `adapter.ts` runs `isBuilderFeeApprovalError`, and the humanized text ("The trading fee hasn't been approved yet...") is not matched by it, so the "Fee settings changed" dialog does not open. Fix both together and re-run this step.

### X3. Builder fee is charged on closing fills too

- **Test (script, step `5`).** **Expect:** the closing fill carries `builderFee` (fees on open and close, as the disclosure says). **If not:** `orders.ts` `planClose` / `closeWire` builder placement and the disclosure copy.

### X4. An agent key cannot withdraw

- **Test (script, step `9`):** `withdraw3` signed by the agent. **Expect:** refused (`findings.agentCanWithdraw === false`); record the text in `findings.agentWithdrawErrorRaw`. **If it is accepted: stop, this is a security finding.** Revoke the key, then review `docs/SECURITY_MODEL.md`.

### X5. Testnet registry size and info rate limits

- **Test (script, dry run):** testnet lists about 280 HIP-3 dexes. `createMarketRegistry` fetches `meta` per dex (weight 20 each, about 5.5k against a 1,200/minute budget), which returns HTTP 429 for minutes.
- **Expect:** real mainnet has about 10 dexes, so this is a testnet-only problem, but anyone demoing on testnet hits it. **If it matters:** `src/hyperliquid/symbols.ts` `createMarketRegistry` (limit/lazy-load dexes on testnet; the script restricts dexes with `--dexes`).

### X6. Non-crypto HIP-3 markets exist on testnet

- **Test (script, step `1`):** `findings.testnetHasNonCryptoHip3` and the market list. Informational: decides whether forex/stock trading can be rehearsed on testnet at all.

## 6. Sign-off

Fill in one row per item. "Result" is PASS, FAIL (with a link to the fix) or N/A (with a reason). A FAIL blocks the release gate until fixed and re-tested.

| Item | Area | Verified by | Date | Result | Notes / report keys / fix link |
|---|---|---|---|---|---|
| W1 | chain switch + typed data, MetaMask and Rabby | | | | |
| W2 | agent renewal replaces old | | | | |
| W3 | extraAgents validUntil | | | | |
| W4 | deposit >= 5 USDC + credit delay | | | | |
| W5 | withdraw fee and minimum | | | | |
| W6 | sendAsset USDC to xyz dex | | | | |
| W7 | userAbstraction values | | | | |
| W8 | builder-limit / volume error wording | | | | |
| T1 | agent-signed actions hit master account | | | | |
| T2 | $10 minimum non-reduce-only only | | | | |
| T3 | modify: builder fee + oid | | | | |
| T4 | positionTpsl size handling | | | | |
| T5 | leverage default heuristics | | | | |
| T6 | unified / portfolio-margin equity | | | | |
| T7 | closedPnl gross of fees | | | | |
| T8 | allMids{dex} key prefixes | | | | |
| T9 | frontendOpenOrders per dex | | | | |
| T10 | websocket open hook / reconnect | | | | |
| O1 | claimRewards claims builder fees | | | | |
| O2 | builder_fills reconcile semantics | | | | |
| M1 | closed-market behaviour | | | | |
| X1 | builder fee applies to HIP-3 | | | | |
| X2 | builder-approval error text matched | | | | |
| X3 | builder fee on closing fills | | | | |
| X4 | agent cannot withdraw | | | | |
| X5 | testnet registry rate limit | | | | |
| X6 | non-crypto HIP-3 on testnet | | | | |

Final sign-off: ______________________  Date: ____________  Report files attached: ______________________

**Fixed.** `applyFeeConfig` clamps any remote fee to the compiled-in default (`compiledDefaultFee()`): remote config can only lower or disable. `message` is sanitized to <=200 chars of single-line plain text (`sanitizeFeeMessage`); render it as a React text node only. An oversized message no longer invalidates the document (kill switch stays effective). |||||||| Key | Where it lives | What it can do |
|---|---|---|
| **Main wallet** (MetaMask etc.) | In the user's wallet; never reaches this app | Everything: deposits, withdrawals, approving agents and builder fees |
| **Agent (API wallet) key** | Generated in the browser (`agentKey.ts`), AES-GCM encrypted, stored in IndexedDB; the decrypted `LocalAccount` is held in memory in `hlSession.agent` | Sign **L1 trading actions** for the main account: place / modify / cancel orders, set leverage |
| **Builder wallet** | Operator-controlled, offline (see `docs/OPERATIONS.md`) | Receives fees. Never in the browser |

### Agent keys cannot withdraw or approve fees

- Verified (HL docs, Builder Codes page): *"This action [ApproveBuilderFee] must be signed by the user's main wallet, not an agent/API wallet."*
- Verified (HL docs, Nonces and API wallets): *"API wallets are only used to sign"* on behalf of the master account.
- Verified in the pinned SDK (`@nktkas/hyperliquid` 0.33.3): `withdraw3`, `usdSend`, `approveAgent` are **user-signed actions** (EIP-712 typed data signed by the main wallet via `signUserSignedAction`), while orders and cancels are L1 actions that an agent may sign.
- **Assumed, not provable from the SDK or the pages we fetched:** that HL's servers reject a *user-signed* action signed by an agent. HL documents agents as trading-only, and this is the model every HL integrator relies on, but we found no sentence in the docs we could fetch stating "agents cannot withdraw" verbatim. Confirm on testnet with `scripts/hl-testnet-*` (attempt `withdraw3` signed by an agent; expect rejection) before launch.

## 2. Threat model

### In scope

1. **XSS / malicious script in the app origin** (compromised dependency, compromised CDN, injected third-party widget, malicious HL-provided string rendered as HTML).
2. **Compromised build or hosting** (attacker ships modified JS).
3. **Malicious or compromised remote config** (`VITE_FEE_CONFIG_URL`, geo, screening endpoints).
4. **Malicious market deployers** (HIP-3) and stale/odd oracle data.
5. **User device compromise.**
6. **Fee abuse**: charging more than the user approved.

### What an XSS attacker can do

Same-origin code can call the app's own signing path, so it can **place or cancel orders and change leverage as the user until the agent is revoked or expires** (default 30 days). Encrypting the key in IndexedDB does *not* stop this: the non-extractable wrap key sits in the same origin and can be used to decrypt, and the live `LocalAccount` is in memory. What encryption does buy: a dump of `localStorage`, a backup/forensic copy of the profile files, or a leaked exported blob does not reveal a raw key; the wrap key cannot be exported.

What the attacker **cannot** do with the agent alone: withdraw, transfer USDC, approve new agents or fee rates (all need a main-wallet signature, and the attacker cannot make the wallet sign silently). They *can* try to trick the user into a malicious wallet prompt (phishing UI inside our origin), which is the larger risk. Users must read what the wallet shows (action type and amounts).

Worst realistic loss from agent abuse: adverse trades (e.g. opening large positions in illiquid markets and trading against themselves from another account) that drain account value through slippage/fees. Hence: low default leverage UI, size limits in the trading gateway, short agent TTL.

### Mitigations in this repo

| Control | Where |
|---|---|
| Strict CSP (`script-src 'self'`, no inline script, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`, `frame-ancestors 'none'`) | `src/hyperliquid/compliance/csp.ts`, injected as `<meta>` in production by `vite.config.ts`, plus `public/_headers` / `dist/_headers` |
| `connect-src` allow-list: only HL REST/WS (mainnet+testnet), Arbitrum public RPCs, plus env-configured URLs added at build time | same |
| No `dangerouslySetInnerHTML`; React text rendering escapes HL strings, market names, error text | audited (see §4) |
| Key never logged; `redactSecrets` strips 64+ hex-char strings from error text before UI | `orders.ts:490`, `exchange.ts:133-155` |
| Fee approval is exactly the fee charged, never above the HL cap of 0.1% | `config.ts` `clampBuilderFee`, `wallet/setup.ts` `approveBuilderStep` |
| Expiring agent (`valid_until` name suffix, 30 days default, rotation 3 days before); AES-GCM blob bound to `network:address` via AAD | `agentKey.ts` |
| Referrer-Policy `no-referrer`, `nosniff`, `X-Frame-Options: DENY`, Permissions-Policy lock-down, HSTS, COOP `same-origin-allow-popups` | `csp.ts` `SECURITY_HEADERS` |
| CI check that production HTML has the CSP meta and no inline `<script>` | `.github/workflows/ci.yml` |

### Residual risks (accepted or open)

- **Supply chain.** A malicious update to any bundled dependency runs with full origin privileges. CSP does not stop code that is *in* the bundle. See §5.
- **Hosting compromise** is total (the attacker serves a different bundle). Use 2FA/SSO on the host and DNS, protected branches, required reviews, and consider Subresource Integrity / IPFS-style immutable deploys later.
- **Client-side compliance controls are advisory** (see `COMPLIANCE_CHECKLIST.md`).
- **`style-src 'unsafe-inline'`** is required today (lightweight-charts injects a `<style>` element). It cannot execute script; it could enable CSS-based data probing, but there are no secrets in the DOM.
- **Wallet phishing from within the origin** after XSS (see above).
- **Oracle / HIP-3 risk** is a market risk, not a security control. Disclosed via `MarketRiskBadge` and the terms dialog.

## 3. Revocation (for users)

1. **Disconnect in the app** wipes the local agent key (`disconnectWallet` -> `revokeAgent`). This does **not** deregister the agent on HL.
2. To make a leaked agent key useless: on Hyperliquid, approve a **new agent with the same name** (OpenBroker does this on "renew"; HL replaces the previous agent of that name), or let it **expire** (`valid_until`). HL documents that an agent is deregistered when a new one with the same name is approved, when it expires, or when the registering account has no funds. The Hyperliquid app's API-wallet page also lists authorised wallets. *We have not verified an explicit "revoke" action in HL's API docs; verify the current UI and document the exact click path for your support page.*
3. **Revoke the builder fee approval** from the main wallet via HL (the builder-codes page states users can revoke at any time; setting max fee to 0).
4. Cancel open orders and close positions from the Hyperliquid app if you suspect abuse.
5. Move funds to a fresh wallet if the *main* wallet may be compromised.

## 4. Audit findings (code review, read-only for files outside compliance/)

Severity: H high, M medium, L low, I informational.

| # | Sev | Where | Finding | Status |
|---|---|---|---|---|
| 1 | **H** | `src/components/TradingViewWidgets.tsx:158,216,277,343`, used by `src/pages/trading/BottomPanel.tsx:454` (inside the terminal) | Loads third-party script from `s3.tradingview.com` into the same origin that holds the agent key. A compromise of that host is equivalent to XSS. | Mitigated by the production CSP (blocked by default). **Recommend removing the widget from the Hyperliquid build.** Demo-only escape hatch: `VITE_CSP_ALLOW_TRADINGVIEW=1`. |
| 2 | M | `agentKey.ts:111` (`dbp ??= openDb()`) | A rejected `openDb()` promise is cached forever; IndexedDB failures (blocked storage, Firefox private mode) then break every later vault call until reload. | Open. Reset `dbp` on rejection. |
| 3 | M | `agentKey.ts:226` (`persist`) + `wallet/setup.ts:117-123` | `persist()` runs *after* HL accepted `approveAgent`. If IndexedDB is unavailable, persist throws after the on-chain approval: user sees an error, an orphan approved agent exists, and `getDefaultVault` (`agentKey.ts:135`) has no in-memory fallback when `indexedDB` exists but is unusable (only when it is `undefined`). | Open. Catch vault failure, fall back to `createMemoryVault()` (key lives for the session) and tell the user. |
| 4 | L | `agentKey.ts:235-257` (`loadAgent`, catch at 252) | Any error (including a transient IndexedDB read error) deletes the stored agent. Safe (user re-approves) but can surprise. | Open, minor. Only delete on decrypt/mismatch errors. |
| 5 | L | `agentKey.ts:179-187` | AES-GCM with random 96-bit IV per encryption (unique with overwhelming probability for this volume) and a non-extractable 256-bit key: correct. No AAD binds the blob to `network:address`; an attacker able to write IndexedDB could swap blobs, but already has same-origin code execution. | Informational. Optionally pass `additionalData: agentId`. |
| 6 | L | `agentKey.ts:19` | Default agent TTL 90 days is long relative to the XSS blast radius. | Recommend 7-30 days. |
| 7 | L | `orders.ts:490` | `redactSecrets` only matches `0x`-prefixed hex of 64+ chars; bare 64-hex strings would not be redacted. SDK errors do not normally contain keys. | Open, trivial (`/(?:0x)?[0-9a-fA-F]{64,}/`). |
| 8 | L | `marketData.ts:132`, `ws.ts:105,193` | `console.error(..., err)` logs raw error objects. They come from market-data handlers, not the signing path; no key material is reachable there. | Informational. |
| 9 | L | `wallet/setup.ts:61` | If the wallet cannot switch to Arbitrum (non-rejection error), signing proceeds on the wallet's current chain. HL accepts any chain id in the typed-data domain for user-signed actions (as the code comment notes), so no fund risk, but users see a different network in the prompt. | Informational. |
| 10 | M | `feeConfig.ts` / `config.ts:getBuilderFeeTenthsBp` | The remote fee config may set any fee 0..100 and `enabled`. A compromised config host can raise the fee to HL's 0.1% cap for users whose approval allows it, and drives the `maxFeeRate` of **new** approvals. Never above the HL cap or above what a user approved (HL enforces the user's max). | Recommend capping the remote fee at the compiled-in `VITE_HL_BUILDER_FEE`, serving the config over HTTPS from a host you control, and keeping `message` rendered as plain text only (it is `max(280)`). No UI renders `message` yet; keep it text-only. |
| 11 | I | XSS surface | `rg dangerouslySetInnerHTML|innerHTML` in `src/`: only `TradingViewWidgets.tsx:20` (`innerHTML = ""`, clearing). HL strings (market names, errors, dex names) are rendered as React text. EIP-6963 wallet icons are used as `<img src>` (data: URIs per spec; CSP `img-src 'self' data:` blocks other schemes). | OK. |
| 12 | I | `src/services/store.tsx:30-75`, `services/api/request.ts:49` | Legacy demo-backend auth tokens (`access_token`, `refresh_token`) in `localStorage`. Not part of the HL path but same origin; disable the legacy API client in the HL build. | Open. |
| 13 | I | `wallet/connect.ts:19` | Stores only the last wallet name in `localStorage`. No keys or addresses. | OK. |
| 14 | I | `wallet/funds.ts:69` | viem `http()` with the chain's default RPC: `https://arb1.arbitrum.io/rpc` (mainnet), `https://sepolia-rollup.arbitrum.io/rpc` (testnet). Public, rate-limited, and sees user IP and address. Both origins are in `connect-src`. | Verified in `node_modules/viem`. If you move to a private RPC, add it via `VITE_CSP_EXTRA_CONNECT`. |
| 15 | OK | `wallet/setup.ts:145` | `maxFeeRate` is `getMaxFeeRateString()` = configured fee, clamped to <= 100 tenths-bp (0.1%) in `config.ts:53`. Never above configured. | Verified. |
| 16 | OK | `exchange.ts:133-155` | `describeError` redacts and truncates (160/200 chars) HL and transport errors before they reach UI. | Verified. |

### Origins contacted (from `rg` over `src/`, plus the production build)

`api.hyperliquid.xyz` / `api-testnet` (REST via SDK `HttpTransport`, `info.ts` fetch, WS via `WebSocketTransport`), `arb1.arbitrum.io`, `sepolia-rollup.arbitrum.io`, env URLs (geo, screen, fee config, `VITE_API_URL`), `s3.tradingview.com` (legacy widget, blocked by CSP), Binance (only when `VITE_ADAPTER=binance`, an example adapter: add its origins via `VITE_CSP_EXTRA_CONNECT`). The built bundle at the time of review did not yet include the Hyperliquid modules (not wired into `Root.tsx`), so re-run the grep after integration:

```
rg -o "https?://[a-zA-Z0-9._-]+|wss?://[a-zA-Z0-9._-]+" --no-filename dist/assets/*.js | sort -u
rg -P "<script(?![^>]*src=)" dist/index.html   # must print nothing
```

## 5. Supply chain

`npm audit --omit=dev` (2026-11-10): was **1 high**, `zod <4.6.6` (GHSA-mrhx-c7xc-m3w5, memory exhaustion on oversized constrained collections). **Resolved** by upgrading to `zod@^4.6.7`. We use only `z.object`/strings/numbers/booleans on small documents (`feeConfig.ts`, `compliance/geo.ts`, `compliance/screen.ts`, `services/schemas.ts`), so the upgrade is non-breaking here: verified with `tsc`, the full vitest suite and `vite build` on the upgraded tree; audit now reports 0 vulnerabilities. `viem`/`abitype` accept zod 4 as a peer.

Sensitive direct dependencies (they run with key-level privilege). Recommendations: pin exact versions (remove `^`) for these, commit the lockfile, use `npm ci`, enable Dependabot/Renovate with manual review, and review diffs of these on every bump.

| Dependency | Why sensitive |
|---|---|
| `@nktkas/hyperliquid` | Builds and signs every action, builds requests to HL |
| `viem` | Key generation (`generatePrivateKey`), signing, RPC client |
| `react`, `react-dom` | Everything renders through them |
| `zod` | Parses remote config |
| `lightweight-charts`, `@radix-ui/*`, `lucide-react`, `zustand`, `@tanstack/react-query` | Run in origin; lower risk but same privilege |

Also: `npm ci --ignore-scripts` in CI where feasible, GitHub Actions pinned to commit SHAs (currently tag-pinned `@v4`), 2FA on npm/GitHub accounts, signed commits/tags for releases.

## 6. Incident response

1. **Detect**: user reports of unexpected orders; builder-wallet revenue anomalies (`npm run builder:revenue`, `builder:reconcile`); CSP violation reports (add `report-uri`/`report-to` if you run a collector); dependency advisories.
2. **Contain (minutes)**: set the remote kill switch (`enabled:false` in the fee config), or replace the deployed bundle with a static "maintenance" page; rotate hosting credentials; revert to the last good release; purge CDN.
3. **Tell users**: banner/status page: revoke the agent (section 3), cancel orders, check positions. Make clear that **funds cannot be withdrawn by the agent key**, but orders can be placed.
4. **Rotate**: bump `TERMS_VERSION` if disclosures change; change the agent base name in `agentKey.ts` (`AGENT_BASE_NAME`) so clients must approve a fresh agent; rotate any API keys (screening vendor) held at the edge.
5. **Builder wallet**: if the builder key may be exposed, claim and move funds, create a new builder address, ship a release with the new `VITE_HL_BUILDER_ADDRESS` (users re-approve).
6. **Post-mortem**: timeline, root cause, user impact, fixes; consider disclosure obligations with counsel.

Report vulnerabilities per `SECURITY.md`.

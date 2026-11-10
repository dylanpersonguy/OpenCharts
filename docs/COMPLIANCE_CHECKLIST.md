# Compliance launch checklist

**I am not a lawyer and this is not legal advice.** This is a list of questions and practical items to take to qualified counsel in each relevant jurisdiction before you launch. Nothing here is a conclusion about what is or is not legal. The in-app terms text (`src/hyperliquid/compliance/termsCopy.ts`) is a **template that has not been reviewed by counsel**.

## 0. What the code does, and does not, do

| Feature | Where | Strength |
|---|---|---|
| Geo check against `VITE_GEO_CHECK_URL`, plus `VITE_BLOCKED_COUNTRIES` | `compliance/ComplianceGate.tsx`, `geo.ts` | **Advisory only.** Runs in the visitor's browser. A VPN, devtools, a modified bundle, or calling Hyperliquid's API directly bypasses it. |
| Wallet screening via `VITE_SCREEN_URL` | `compliance/screen.ts` | **Advisory only**, same reason. |
| Versioned terms and risk acknowledgement | `TermsDialog.tsx`, `TERMS_VERSION` | Evidence of notice, stored only in the user's browser (`localStorage`). We do not keep a server-side record. |
| HIP-3 market risk badge | `MarketRiskBadge.tsx` | Disclosure. |

**Real enforcement needs the edge.** Block restricted regions at the CDN/edge before any HTML or JS is served (samples: `docs/deploy/cloudflare-geo-worker.js`, `docs/deploy/vercel-middleware.ts`), and decide with counsel whether you must also block at DNS/registrar level, in app-store listings, and in marketing. Even edge blocking is a reasonable-measures control, not a guarantee, because of VPNs and because users can reach Hyperliquid directly. Ask counsel what level of effort is expected.

### Configuration

| Env var | Meaning | Default |
|---|---|---|
| `VITE_GEO_CHECK_URL` | Endpoint returning `{allowed:boolean,country?:string,reason?:string}`. Same-origin (`/geo`) is simplest. | unset = **no gate** (dev-only console warning) |
| `VITE_GEO_FAIL_MODE` | `closed` or `open` when the endpoint is unreachable / times out (4 s) / returns bad data | `closed` |
| `VITE_BLOCKED_COUNTRIES` | ISO-2 list applied to the endpoint's `country` (needs `VITE_GEO_CHECK_URL`; ignored with a console error otherwise) | empty |
| `VITE_SCREEN_URL` | `GET <url>?address=0x..` -> `{allowed:boolean}`; keep vendor API keys on the server behind it | unset = no-op |
| `VITE_SCREEN_FAIL_MODE` | as above for screening | `closed` |
| `VITE_CSP_EXTRA_CONNECT` | extra `connect-src` origins (space/comma separated) | empty |

**Fail-mode tradeoff.** `closed` means a geo-service outage (or an ad blocker that blocks the URL) locks every user out, including allowed ones: bad availability, but no accidental access by a restricted user. `open` keeps the app up during outages but turns every outage, and every blocked request, into a bypass. For a regulated product we default to `closed` whenever a geo URL is configured. Use `open` only if edge blocking is the real control and the client check is merely a courtesy page.

Geo/screen/fee-config URLs must be reachable under the CSP. The production build adds their origins to `connect-src` automatically (meta tag and `dist/_headers`). If you deploy the static `public/_headers` as-is, add them yourself.

### Integrator wiring (outside this folder)

- `<ComplianceGate>` wraps the app and **already watches `hlSession.address`** and calls `screenAddress` on connect; no wallet-file change is needed.
- Call `isAddressBlocked(address)` (exported) in the trading gateway's order path as a synchronous belt-and-braces guard.
- Call `registerMarketLookup((s) => registry.bySymbol(s))` once so `useMarketRiskNotice` knows leverage and isolated-only; without it the notice is derived from the symbol only.
- Add `<MarketRiskBadge market={m}/>` next to HIP-3 symbols and show `useMarketRiskNotice(symbol)` text in the order ticket.

## 1. Questions for counsel

### 1.1 Is this a regulated activity, and which?
- Does routing orders to a third-party venue with a per-trade builder fee amount to brokerage, "arranging deals", introducing broker, execution-only intermediation, or operating a trading facility in any jurisdiction we target or reach?
- Does a non-custodial, front-end-only design change that analysis? Does the fee model (we are paid per trade, not per user) matter?
- Is a licence, registration, or exemption needed to receive builder-code revenue?
- Is the operator entity, its location and its directors relevant (where is it established, where are users)?

### 1.2 Jurisdictions commonly flagged for derivatives marketing and brokerage (ask about each; do not assume)
- **United States**: CFTC/NFA (retail leveraged commodity, FX and swaps rules, IB registration), SEC (security-based swaps; the "stock" perps are derivatives on securities), state rules; sanctions (OFAC). Hyperliquid's own terms restrict US persons; confirm the current text.
- **United Kingdom**: FCA financial promotions regime, restrictions on marketing crypto-derivatives and CFDs to retail, ban on crypto-derivatives for retail, risk warnings, "appropriate" tests.
- **European Union / EEA**: MiCA, MiFID II (are perps on equities/FX/commodities financial instruments?), ESMA product-intervention measures on CFDs, national marketing rules, leverage caps.
- **Others to check**: Canada (provincial), Australia (ASIC product intervention), Singapore (MAS), Hong Kong (SFC), Japan (FSA), Korea, India, UAE/Bahrain (VARA etc.), Switzerland, Turkey, and Hyperliquid's and your own sanctioned/embargoed lists (e.g. Cuba, Iran, North Korea, Syria, Crimea/Donetsk/Luhansk regions). Who decides the blocked-country list, and how often is it reviewed?
- For each: is marketing allowed even if access is blocked? Does the site itself count as "marketing"? Do we need to geo-fence the marketing site, social posts and affiliates?

### 1.3 Hyperliquid's own restrictions (verify at source, do not rely on this document)
- Read Hyperliquid's current Terms of Use and any restricted-jurisdiction list. Do they bind users of third-party front-ends? Do they restrict the front-end operator?
- Builder-code terms: any prohibition on charging fees, requirements to disclose them, rules on markets (HIP-3 deployers may set their own restrictions).
- Are we permitted to describe the service as "powered by"/"for" Hyperliquid? See trademark below.
- Known protocol facts used in the product (verified 2026-11 on HL docs): builder fee cap on perps 0.1%; builder needs >= 100 USDC perps account value; `ApproveBuilderFee` must be signed by the main wallet.

### 1.4 Consumer protection and disclosures
- Is the risk acknowledgement sufficient (leverage/liquidation, non-custodial, fee, HIP-3 third-party risk, restricted persons, no advice)? Does any jurisdiction require specific wording, risk percentages ("X% of retail accounts lose money"), cooling-off, or appropriateness/knowledge tests?
- Is a click-through enforceable, and should we log acceptance server-side (timestamp, version, IP-derived country)? That would be personal data; see privacy.
- Do the terms of service, privacy policy, and risk disclosure need to be separate documents, linked from the dialog and footer? (Currently they are not; add links before launch.)
- Governing law, dispute resolution, limitation of liability, indemnities, minimum age (18+?).

### 1.5 Fee disclosure
- Is "X% of trade value per side, on top of Hyperliquid fees" the right form? The number is read from the live config (`getBuilderParam`/`getBuilderFeeTenthsBp`) in the terms dialog, the setup dialog (`feeDisclosure`) and the order ticket; check they cannot disagree.
- Must we show total cost estimates, round-trip cost, or a fee schedule before the first trade (`fees.ts` has estimators)?
- Remote fee changes (`VITE_FEE_CONFIG_URL`): does raising a fee after acceptance require fresh consent? (The product already forces a new builder approval signature.) Should `TERMS_VERSION` be bumped on any fee increase?
- Are rebates, referral codes, or tiered discounts allowed or required to be disclosed?

### 1.6 Marketing claims
- No promises of profit, "risk-free", "guaranteed", "AI signals", "copy trading" claims, or testimonials without review.
- "Non-custodial" and "we never hold your funds": accurate? (The builder wallet holds fee revenue and >= 100 USDC of our own funds only.)
- "Stocks / Forex / Commodities perps": is it acceptable to describe them with those words, or do they imply securities/regulated instruments? Do we need "synthetic exposure, not ownership" language? Do we need to avoid index/brand names (S&P, Nikkei, company names, trademarks of issuers) in market labels?
- Social media/influencer/affiliate rules, including disclosures of material connections.
- Are performance numbers, volumes or "TVL"-style stats permissible?

### 1.7 Sanctions and AML
- What screening is expected of a non-custodial front-end that never touches funds? Wallet screening at connect (`VITE_SCREEN_URL`), at order time, or both? Which list provider, and who is liable for false negatives/positives?
- Do we need a sanctions/AML policy, a designated compliance officer, a risk assessment, suspicious activity reporting? Do we have any obligations as a fee recipient?
- Retaining screening decisions: what to log, for how long, without collecting excess personal data?
- The builder wallet receives revenue from Hyperliquid: any source-of-funds, tax, or banking-relationship issues when converting?

### 1.8 Record keeping
- What must be kept (acceptance of terms, screening results, fee statements, complaints, marketing materials, geo-block configuration changes) and for how long?
- `docs/OPERATIONS.md` scripts produce per-day/per-market revenue CSV/JSON; store them with tamper-evidence (immutable storage, hash in a ticket).
- Keep an auditable change log of `TERMS_VERSION`, blocked-country list, fee changes, and the dates each was live.

### 1.9 Data privacy
- **Current position: the app collects no personal data of its own.** No accounts, no analytics, no cookies. Wallet addresses are public identifiers but still personal data in some regimes (GDPR). Third parties see user IPs: Hyperliquid (REST/WS), Arbitrum public RPC (`arb1.arbitrum.io`), your geo/screening/fee-config hosts, your CDN and host logs.
- If `VITE_SCREEN_URL` is used, the wallet address (and IP) is sent to your edge function and a vendor: needs privacy-policy disclosure and a data-processing agreement.
- **Any analytics, error reporting (Sentry etc.), session replay, or marketing pixels must not be added without a consent mechanism and a CSP change.** The CSP intentionally blocks them today.
- Local storage used: terms acceptance (`openbroker.terms.accepted`), last wallet name, preferences, encrypted agent key (IndexedDB). Disclose it; check whether consent is needed for non-essential storage (cookie/ePrivacy rules).
- Rights requests (access/erasure) are trivial if nothing is stored server-side; keep it that way, or document it.

### 1.10 Trademarks and branding
- "Hyperliquid" is a third party's name. May we use it in the product name, domain, logo, app-store listing and ads? Use plain nominative references ("trade on Hyperliquid") with a non-affiliation disclaimer ("Not affiliated with or endorsed by Hyperliquid") unless there is permission. Avoid look-alike names and logos.
- Check names of HIP-3 deployers and underlying brands (tickers, stock logos) before showing logos or marketing them.
- Clear "OpenBroker"/"OpenCharts" naming and licences (MIT code; brand marks are separate).

## 2. Practical pre-launch checklist

- [ ] Counsel review of terms, privacy policy, risk disclosure, marketing site; replace template text; set `TERMS_REVIEWED_BY_COUNSEL` and bump `TERMS_VERSION`.
- [ ] Decide and document the blocked-jurisdiction list and who owns updating it.
- [ ] Edge geo-blocking deployed and tested from outside allowed regions (`docs/deploy/`); `VITE_GEO_CHECK_URL` set; `VITE_GEO_FAIL_MODE` decision recorded.
- [ ] Wallet screening decision made; if used, vendor contract/DPA and `VITE_SCREEN_URL` behind your own endpoint.
- [ ] Confirm Hyperliquid ToS and restricted lists as of launch date; subscribe to changes.
- [ ] Terms/privacy/risk links in the footer and in the dialog; non-affiliation disclaimer.
- [ ] Fee shown consistently (terms dialog, setup dialog, order ticket); remote fee-config host controlled by you.
- [ ] Marketing and social copy reviewed; no profit promises.
- [ ] CSP/headers deployed on the host (`public/_headers`, `docs/deploy/vercel.json`) and verified with a response-header check; TradingView widget removed or consciously allowed.
- [ ] Incident-response contact and `SECURITY.md` contact current (`docs/SECURITY_MODEL.md` section 6).
- [ ] Record-keeping process (what, where, how long) written down.
- [ ] Review again at every material change: new markets/categories, new jurisdictions, fee changes, new third-party services.

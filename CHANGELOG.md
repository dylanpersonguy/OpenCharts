# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — while the
major version is `0`, minor releases may contain breaking changes.

## [Unreleased]

## [0.3.0] — 2026-09-21

OpenCharts is now installable: `npm install @dylanpersonguy/opencharts`. This
release makes it embeddable without forking — bring your own backend through an
adapter, put the panels in your own layout, and drop it into a page it will not
disturb.

### Added

- **Published as a package**: `@dylanpersonguy/opencharts`, with separate
  entries for the core (`.`), the bundled demo backend (`/demo`), the adapter
  conformance suite (`/conformance`) and a precompiled stylesheet
  (`/style.css`). ESM with type declarations; React 18.2+ is the only peer
  dependency and every other dependency stays external so hosts dedupe them.
  The name `opencharts` on npm belongs to an unrelated project.
- **`<OpenChartsProvider>` is the complete runtime.** It opens the stream, loads
  instruments and accounts, and supplies the query cache, tooltips, market-data
  bridge, notifications and an error boundary. An adapter that fails to load
  shows its error with a retry button instead of a blank screen.
- **`onNotification()`** streams fills, rejections and warnings so a host can
  route them into its own UI; `showNotifications={false}` turns the built-in
  ones off.

- **The adapter contract** (`src/adapter/`). Implement `OpenChartsAdapter` —
  `marketData` required, `trading` and `storage` optional — pass it to
  `<OpenChartsProvider>`, and the terminal runs against your backend. Nothing
  in the project needs to be forked or patched to integrate it.
- **A conformance suite** (`runAdapterConformance`) covering the parts of the
  contract that fail quietly: bar ordering, second-precision timestamps, the
  exclusive `toMs` paging window, unsubscribe actually unsubscribing, and
  rejections arriving as rejected promises. Trading checks are opt-in because
  they submit orders.
- **Composable panels.** `<Chart />`, `<OrderTicket />`, `<Positions />`,
  `<Orders />`, `<Watchlist />` and `<DepthLadder />` can be mounted
  individually inside `<TerminalProvider>`, so an application can put the chart
  in its own layout instead of taking the whole terminal. `<Terminal />` is the
  default arrangement, and `examples/embedded-chart/` shows a custom one.
- **A live example adapter** for Binance's public API in
  `examples/binance-adapter/`, composed with the paper engine so live prices
  can be traded risk-free. Run it with `VITE_ADAPTER=binance npm run dev`.

### Changed

- `services/api.ts` and `services/ws.ts` are now a thin mapping onto the
  installed adapter rather than being wired directly to the demo backend. The
  demo is expressed through the same public contract a third party implements.
- Session replay is built on `marketData.getCandles`, so it works with any
  adapter instead of requiring one of its own.
- The 740-line trading page no longer owns the terminal's state. Shared state
  moved to `<TerminalProvider>`; the page keeps only layout — panel sizes, tab
  selection, visibility — and its markup is unchanged.
- Drawings, chart templates and journal entries route through the adapter's
  optional `storage` driver, defaulting to `localStorage`. Device-local
  preferences deliberately stay local.

### Fixed

- **Notifications were never displayed.** A toast container was removed in an
  earlier cleanup, so all 77 notification calls — including every order
  rejection and its reason — were dropped silently, and a trader clicking Buy
  on an invalid order saw nothing happen. A new accessible viewport renders
  them: errors are announced assertively and stay longer, and repeated
  identical messages collapse into one.
- **The stylesheet leaked into host pages.** It shipped Tailwind's global
  reset, element styles for inputs and tables, `html, body { overflow: hidden }`
  — which froze scrolling on any page that embedded the terminal — and theme
  variables on `:root` named like shadcn/ui's, which overwrote a shadcn host's
  theme. Every rule is now scoped under `.opencharts` at build time, and the
  library build fails if a selector escapes.
- **The runtime only worked inside this repository.** The query client,
  tooltips, market-data bridge and boot sequence lived in the demo's
  `main.tsx`, so `<OpenChartsProvider><Terminal /></OpenChartsProvider>` in any
  other app crashed or showed frozen prices. They now live in the provider.
- Trading calls rejected with a synchronous throw in places, which skipped
  callers' `.catch()` handlers. Everything returns a rejected promise now.

### Removed

- **Bundled analytics.** PostHog was a leftover from the original platform. Its
  key is baked in at build time, so in a published library it could never
  activate — it was only dead weight in every host's bundle. OpenCharts now
  ships no telemetry.
- Five unused dependencies (`react-router-dom` and four Radix packages), and
  the build tools that were listed as runtime dependencies.

## [0.2.0] — 2026-09-17

The first tagged release. It follows a full audit of the codebase: the
typecheck and lint gates were repaired, the paper-trading engine was rebuilt,
and the features that had been sitting dormant were either finished or removed.

### Added

- **Session replay.** Play back the charted symbol's 1-minute history with
  play / pause / stop, speeds from 0.5× to 10×, and a scrubber to seek. Bars
  are revealed progressively and trades closed during the window appear as
  markers.
- **Trade journal.** Entries persist to `localStorage`, scoped per account and
  filterable by symbol. The tab is no longer hidden.
- **Resting orders.** Limit and stop orders now rest as `PENDING` and trigger
  when a tick crosses them — limits fill at their price or better, stops fill
  at the market that triggered them.
- **Order validation** covering size, price, side, stop placement, protective
  levels and free margin, with the reason surfaced to the trader.
- **Test suite**, from 25 tests to 166: the paper engine, indicators, replay,
  journal, live P&L, storage, ids, the event bus, and the order ticket and
  positions table at the component level.
- **ESLint 9** with a flat config including the React Compiler rule set, wired
  to the existing `lint` script.
- **First-load payload budget** (`npm run check:size`), enforced in CI.
- Contributor scaffolding: CI, a live demo deploy, issue and PR templates,
  `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` and `NOTICE`.

### Changed

- **Candle data loads lazily** per symbol and timeframe. The first-load payload
  dropped from 4.94 MB to ~700 KB.
- **The `api` facade is typed exactly** against the demo implementation, so
  calling a method it does not provide is a compile error rather than a silent
  `null` at runtime.
- **The tick replay** starts at the most recent close and reverses at each end
  of the series, so the opening price matches the chart instead of jumping.
- **Depth-ladder sizes** are derived deterministically from each price level
  and no longer reshuffle on every render.
- **All Web Storage access** goes through a wrapper that degrades instead of
  throwing in private mode, when site data is blocked, or on quota exhaustion.
- Pinch-zoom is no longer blocked by the viewport meta tag.

### Fixed

- **A limit order filled at whatever price the user typed** — a `BUY LIMIT` at
  $1 opened a position at $1.
- **Partial closes did not release margin**, leaving it reserved for units no
  longer held.
- **Take-profit and stop-loss now fill correctly on a gap**: a take-profit is a
  resting limit and gets its price; a stop-loss becomes a market order and
  takes the tick.
- **Indicators crashed the terminal** on a zero, negative, fractional or
  missing period by indexing off the front of the candle array.
- **RSI reported 100 on a flat series** instead of a neutral 50, and **VWAP
  produced `NaN`** for a zero-volume series.
- **The app threw at module load over plain HTTP**, where `crypto.randomUUID`
  is undefined, and **white-screened on a corrupt stored user record**.
- **A throwing event-bus subscriber froze the whole feed**; the same flaw in
  the toast dispatcher silenced order-rejection messages.
- **Order failures were swallowed** on the chart context menu and mobile panel,
  making a rejected order look identical to a fill.
- **Scroll-back history probing walked backwards forever** past the end of the
  data.
- **Live P&L froze at zero** for a freshly filled position until the next poll.
- The chart's scroll-back pagination passed a time range that the data layer
  silently ignored.
- Tick precision for instruments with sub-0.0001 tick sizes.
- Timezone handling: dates are derived from the local calendar rather than UTC,
  which had put the replay picker on a day with no data.

### Removed

- **Fabricated market analysis.** A "trade signals" panel rendered
  STRONG BUY / STRONG SELL recommendations derived from a hash of the symbol
  name, and a sentiment gauge invented a buy/sell split the same way. Both were
  unmounted but present in the tree; they are gone, along with four other
  unmounted panels.
- **Fake news attribution.** Placeholder headlines were credited to Reuters,
  Bloomberg, FT, CNBC and Nikkei. They now carry a "Sample" source and the tab
  is labelled as sample data.
- **The AI trader**, a stub of a closed-source feature with nothing behind it.
- 72 unused query hooks, 64 MB of unreferenced marketing images, and three
  dependencies nothing imported.

[Unreleased]: https://github.com/dylanpersonguy/OpenCharts/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/dylanpersonguy/OpenCharts/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/dylanpersonguy/OpenCharts/releases/tag/v0.2.0

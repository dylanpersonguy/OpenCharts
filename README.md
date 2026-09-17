<div align="center">

# 📈 OpenCharts

**An open-source trading terminal that runs entirely in your browser — no backend to run, no signup, no API keys.**

Advanced charting · full drawing-tool suite · 8 indicators · session replay · watchlist · depth-of-market · order ticket · built-in paper-trading engine, seeded with **real** market history.

[![CI](https://github.com/dylanpersonguy/OpenCharts/actions/workflows/ci.yml/badge.svg)](https://github.com/dylanpersonguy/OpenCharts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)

**[▶ Live demo](https://dylanpersonguy.github.io/OpenCharts/)** · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)

![OpenCharts trading terminal](docs/screenshot.png)

</div>

---

## Table of contents

- [What is OpenCharts?](#what-is-opencharts)
- [Features](#features)
- [Quick start](#quick-start)
- [What's real and what's simulated](#whats-real-and-whats-simulated)
- [How it works](#how-it-works)
- [Built on Lightweight Charts](#built-on-lightweight-charts)
- [Project structure](#project-structure)
- [Building on OpenCharts](#building-on-opencharts)
- [Refreshing the bundled market data](#refreshing-the-bundled-market-data)
- [Integrating OpenCharts](#integrating-opencharts)
- [Adding instruments](#adding-instruments)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Tech stack](#tech-stack)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)
- [Acknowledgements](#acknowledgements)
- [License](#license)

---

## What is OpenCharts?

OpenCharts is a self-contained **trading terminal UI**. Open it and you land
straight in the terminal: a candlestick chart with a TradingView-style drawing
toolbar, indicators, a watchlist, a depth-of-market ladder and an order ticket —
all wired to an **in-browser paper-trading engine** funded with $100,000.

There is **no server to run**. The session is seeded with *genuine* historical
OHLC pulled from Binance's public klines endpoint at build time, and a tick
stream is replayed forward from the present, so the chart and prices move like a
live feed while you place and manage paper trades.

It's useful as:

- A **standalone charting / paper-trading app** you can host on any static host.
- A **reference terminal UI** you can point at your own market-data and trading
  backend — the data layer is isolated behind two modules
  (see [Bring your own data](#bring-your-own-data--backend)).
- A **learning sandbox** for charting, technical drawing and order management.

The codebase was extracted from a closed-source prop-trading platform, so a few
panels are gated off or stubbed rather than removed — those are called out
explicitly below rather than advertised as features.

**This is a community project.** The goal is a genuinely open trading terminal
interface — beautiful charts, a deep drawing toolkit, and enough customizability
that you can bend it into your own terminal instead of fighting it. It is
deliberately small, dependency-light and backend-agnostic so that anyone can
clone it, understand it in an afternoon and extend it. Contributions of every
size are welcome, from a new indicator or drawing tool to an exchange adapter,
a theme, a bug report or a docs fix — see
[Building on OpenCharts](#building-on-opencharts) and
[Contributing](#contributing).

## Features

### 📊 Charting
- Candlestick chart powered by [`lightweight-charts`](https://github.com/tradingview/lightweight-charts) v4 with custom plugins.
- Timeframes **1m → 1w** (1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w), up to 1000 bars per
  timeframe (fewer where the exchange has less history, e.g. 461 weekly bars).
- Volume histogram, OHLC legend, live bid/ask price lines, crosshair and bar countdown.
- Toggleable chart plugins: crosshair highlight, session highlighting, session
  breaks, bands indicator, OHLCV tooltip and delta (multi-touch) tooltip.
- Chart settings dialog, right-click context menu, per-symbol preferences and
  saveable **chart templates** — all persisted to `localStorage`.

### 📐 Indicators
SMA, EMA, RSI, MACD, Bollinger Bands, ATR, Stochastic and VWAP, added from the
toolbar and removable individually or in bulk from the chart context menu.

### ✏️ Drawing tools
- Draggable, hideable tool rail grouped into **Lines** (trend line, ray, extended
  line, horizontal, vertical, parallel channel), **Fibonacci** (retracement,
  extension), **Shapes** (rectangle, ellipse, triangle, arrow), **Trade**
  (long position, short position, measure) and **Text**.
- Position tools show risk, R:R and position size against live account equity;
  trend lines show Δprice / Δ% / bar count while being drawn or selected.
- Per-object styling (color, width, line style, labels) with a TradingView-style
  text editor, magnet mode (off / weak / strong snapping to OHLC), Shift for 45°
  angle snapping and multi-select, and keyboard shortcuts (`Alt+H`, `Alt+T`,
  `Alt+F`, `Alt+R`, `Alt+M`).
- An **object tree** panel to select, toggle and delete drawings.
- **Line-cross alerts**: enable an alert on a horizontal line or trend line and
  the chart fires an in-session toast + sound when the mid price crosses it
  (in-session only — nothing is persisted or delivered offline).
- Drawings persist per symbol in `localStorage` and survive reloads.

### 📋 Watchlist · DOM · order ticket
- **Watchlist** with live prices across all bundled instruments.
- **Depth-of-market ladder** around the live mid price.
- **Order ticket**: market / limit / stop tickets with volume presets,
  take-profit and stop-loss, one-click trade mode and an order confirmation
  dialog. See [what's simulated](#whats-real-and-whats-simulated) for how
  limit/stop tickets currently behave.
- **Positions / Orders / Trade History** tabs with modify, close, partial close
  and close-all, plus **Calendar** (TradingView embed) and **News** tabs.
- Drag stop-loss / take-profit levels directly on the chart.
- Trade execution sound (mutable), connection indicator, market-closed banner
  and a dedicated mobile trading panel for narrow screens.

### ⏯️ Session replay
- Replay the charted symbol's 1-minute history with play / pause / stop, speeds
  from 0.5× to 10×, and a scrubber to seek anywhere in the session.
- Bars are revealed progressively as the cursor advances, and trades you closed
  during the replayed window appear as markers.
- Entirely client-driven — the clock runs in the browser off the bundled data.

### 📓 Trade journal
- Log entries per trade with notes, tags, an emotion and a rating, filterable by
  symbol and scoped to the account. Entries persist in `localStorage`.

### 💵 Built-in paper trading
- $100,000 starting balance, 100× leverage, no commission or swap.
- **Market, limit and stop orders** with a real lifecycle: market fills at the
  current price, limit and stop orders rest as `PENDING` and trigger when a tick
  crosses them (limits get price improvement, stops take the slippage).
- Orders are validated before they reach the book — size, price, stop placement
  and free margin — and rejections explain themselves.
- Positions are **marked to market on every tick** with running P&L.
- Stop-loss / take-profit are evaluated automatically and close positions when hit.
- Account equity, balance, used and free margin update in real time.

### 🛰️ Real market data, no backend
- Bundled OHLC is **real** historical data fetched at build time — no random walks.
- A replay feed streams those closes forward from "now" so the terminal feels live.
- Everything runs client-side — deploy it as a static site.

## Quick start

> Requires **Node 20+**.

```bash
npm install
npm run dev
```

Open the printed local URL (e.g. `http://localhost:5173`). The app boots straight
into a session with a funded paper account — pick a symbol from the watchlist,
set a size in the order ticket, and go long or short.

To build for production:

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```

## What's real and what's simulated

OpenCharts is a paper terminal, and being precise about this matters more than
marketing copy:

| Piece | Status |
| --- | --- |
| OHLC history (6 crypto pairs × 8 timeframes) | **Real** Binance klines, bundled as JSON |
| Tick feed | **Real** 1m closes, replayed every 600 ms starting at the latest close and reversing at each end of the series (no price jumps) |
| Bar timestamps | **Shifted** so the last real bar lands on the current period |
| Bid/ask spread | **Derived** — synthesized around the replayed close |
| DOM ladder sizes | **Synthetic** — derived deterministically from each price level, so a level's size is stable while price hovers |
| Order fills, positions, P&L, margin | Real arithmetic against the in-browser engine |
| Limit / stop orders | **Rest as PENDING** until a tick crosses their trigger, then fill — limits at their price or better, stops at the market that triggered them |
| Order modify / cancel | Real, and restricted to pending orders |
| Order validation | Real — quantity, price, side, stop placement, protective-level side and free margin are all checked, with the reason surfaced in a toast |
| News tab | **Placeholder headlines**, labelled "Sample data" in the UI and attributed to no real outlet |
| Economic calendar tab & technical-analysis gauge | TradingView embed widgets — real data, loaded from TradingView's CDN. The calendar has a toggle to a **sample** table, labelled as such |
| Trade journal | **Working** — entries persist to `localStorage`, scoped per account |
| Session replay | **Working** — plays the bundled 1m history for the charted symbol with play/pause/speed/seek |
| Trade calculator | Present in the code but never mounted |
| Account state (balance, positions, orders) | In-memory — **resets on reload** |
| Drawings, chart prefs, templates, sound mute | Persisted in `localStorage` |

## How it works

The UI is **backend-agnostic**. It talks to an internal `api` / `wsClient` pair,
and those resolve against whichever `OpenChartsAdapter` is installed. The
bundled demo backend is simply the adapter that ships by default:

```
                ┌─────────────────────────────────────────────┐
                │                Terminal UI                    │
                │  ChartPanel · OrderPanel · DOM · Watchlist     │
                └───────────────┬───────────────┬──────────────┘
                                │ api.*          │ wsClient.subscribe()
                ┌───────────────▼───────┐ ┌──────▼───────────────┐
                │   services/api.ts      │ │   services/ws.ts      │
                │  (REST-shaped facade)  │ │  (streaming client)   │
                └───────────────┬───────┘ └──────┬───────────────┘
                                │                 │
                ┌───────────────▼─────────────────▼───────────────┐
                │                services/demo/                    │
                │  api.ts      demo method table (+ benign fallback)│
                │  engine.ts   paper trading (positions, P&L, SL/TP)│
                │  feed.ts     replays real ticks → bus → store     │
                │  candles.ts  serves bundled OHLC (shifted to now) │
                │  bus.ts      in-process pub/sub                   │
                │  instruments.ts / data/  real OHLC + symbol specs │
                └──────────────────────────────────────────────────┘
```

- **`services/demo/engine.ts`** — the paper-trading engine and single source of
  truth for the account, positions and orders. It marks positions to market and
  publishes the same position / order / equity events the UI already consumed.
- **`services/demo/feed.ts`** — replays the bundled 1-minute closes for every
  symbol as a forward-moving tick stream, every 600 ms, and drives
  `engine.mark()`.
- **`services/demo/candles.ts`** — serves the bundled history, time-shifted so
  the most recent bar aligns to "now" (OHLC values stay real; only the timeline
  is normalized).
- **`services/api.ts`** — wraps the demo method table in a `Proxy` whose fallback
  resolves any unimplemented method to `null`, so leftover calls from the
  platform this was extracted from never throw.
- **`services/ws.ts`** — exposes the same `connect` / `subscribe` /
  `subscribeAccounts` / `onStateChange` surface as the original reconnecting
  WebSocket client, backed by the in-process bus.

Because the data layer sits behind a stable interface, **no UI component had to
change** to run without a server.

## Built on Lightweight Charts

OpenCharts is **built on top of TradingView's
[Lightweight Charts™](https://github.com/tradingview/lightweight-charts)**
(`lightweight-charts` `^4.2.0`, resolved to 4.2.3 in the lockfile, which in turn
pulls in `fancy-canvas`, MIT). The chart canvas, series, panes, price scales,
crosshair and time axis are all
Lightweight Charts. OpenCharts is the terminal *around* it: the drawing engine
(`src/lib/chart-plugins/drawing-tools/`), the indicator layer, the series
primitives, and the panels, order flow and paper engine that surround the chart.

Several plugins under `src/lib/chart-plugins/` (`plugin-base.ts`, `tooltip/`,
`delta-tooltip/`, `session-highlighting/`, `session-breaks/`,
`bands-indicator/`, `highlight-bar-crosshair/`, `helpers/`) are adapted from the
`plugin-examples` shipped in the Lightweight Charts repository, and carry that
project's license.

### Licensing — read this before you fork or deploy

- **Lightweight Charts is open source under the
  [Apache License 2.0](https://github.com/tradingview/lightweight-charts/blob/master/LICENSE)** —
  free for commercial use, but Apache 2.0 comes with conditions.
- **Attribution is required.** TradingView's terms state that you must add the
  attribution notice from their `NOTICE` file and a link to
  <https://www.tradingview.com/> on the page of your site or app that users see.
  The notice reads:

  ```
  TradingView Lightweight Charts™
  Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/
  ```

- **OpenCharts satisfies this via the chart's built-in attribution logo.** The
  `attributionLogo` layout option defaults to `true` and this project never
  overrides it, so the TradingView link renders on the chart pane. **Do not set
  `attributionLogo: false` unless you place the notice and link somewhere else
  users can see.** The option is set (or, here, left alone) where the chart is
  created in [`src/pages/trading/ChartPanel.tsx`](src/pages/trading/ChartPanel.tsx).
- **Keep the notice when you redistribute.** Apache 2.0 requires that you pass
  along the license and notice with any copy or derivative — that includes the
  adapted plugin code in `src/lib/chart-plugins/`.
- **OpenCharts' own code is MIT** (see [LICENSE](LICENSE)). MIT and Apache 2.0
  are compatible, so a build that combines them is fine — you just have to honor
  Apache 2.0's attribution and notice terms for the chart portion.

None of this is legal advice; if you are shipping commercially, read the license
yourself.

## Project structure

```
src/
├─ App.tsx                  # boots the demo session, renders the terminal
├─ main.tsx                 # React entry, providers, MarketDataBridge, chunk-reload guard
├─ pages/
│  ├─ TradingPage.tsx       # the full terminal layout (~700 lines)
│  ├─ AiTraderPage.tsx      # stub — the AI trader is gated off
│  └─ trading/              # chart, toolbars, order panel, DOM, watchlist,
│                           #   drawing rail, object tree, replay HUD/scrubber,
│                           #   news overlay, indicators, challenge levels
├─ lib/
│  ├─ chart-plugins/        # lightweight-charts plugins used by the chart
│  │  ├─ drawing-tools/      #   manager, renderers, hit-testing, geometry, alerts
│  │  ├─ delta-tooltip/ tooltip/ highlight-bar-crosshair/
│  │  └─ session-breaks/ session-highlighting/ bands-indicator/
│  ├─ indicators.ts         # SMA/EMA/RSI/MACD/BOLL/ATR/STOCH/VWAP
│  ├─ livePnl.ts            # live P&L / price math shared by the tables
│  ├─ posthog.ts            # optional analytics (no-op without an API key)
│  └─ utils.ts
├─ components/              # dialogs, mobile panel, TradingView embeds, ui primitives
├─ hooks/                   # drawings, chart prefs, trader prefs, trade sound…
├─ adapter/                # the public integration surface
│  ├─ types.ts             #   the OpenChartsAdapter contract
│  ├─ provider.tsx         #   <OpenChartsProvider adapter={...}>
│  ├─ demo.ts              #   the bundled backend, as a reference adapter
│  └─ conformance.ts       #   a test suite adapter authors can run
├─ services/
│  ├─ api.ts                # internal facade, resolves against the adapter
│  ├─ ws.ts                 # adapter events → the terminal's channels
│  ├─ api/                  # legacy HTTP clients from the original platform;
│  │                        #   chart-templates.ts is localStorage-backed and live
│  ├─ queries.ts            # TanStack Query hooks
│  ├─ store.tsx             # zustand stores (auth + trading state)
│  ├─ schemas.ts            # zod schemas / shared types
│  └─ demo/                 # engine, feed, candles, bus, instruments, bundled data
├─ __tests__/               # Vitest unit tests
└─ styles/
scripts/
└─ fetch-demo-data.mjs      # refresh the bundled real OHLC
```

## Building on OpenCharts

Everything below is a real extension point in the code, not a roadmap. `npm run
typecheck` and `npm run test` are the two gates; TypeScript runs in `strict` mode
with `noUncheckedIndexedAccess` and `noUnusedLocals`, and `@/` resolves to
`src/`.

### Add an indicator

1. Write the pure calculation in [`src/lib/indicators.ts`](src/lib/indicators.ts)
   (they take candles and return `{ time, value }[]` — copy `sma` or `rsi`).
2. Add the type to the `IndicatorType` union and an entry to
   `INDICATOR_REGISTRY` (`label`, `pane: "overlay" | "below"`, `defaultParams`,
   `color`). The toolbar menu renders straight from the registry.
3. Render it in [`src/pages/trading/useIndicators.ts`](src/pages/trading/useIndicators.ts),
   which creates and disposes the Lightweight Charts series per active indicator.

### Add a drawing tool

The drawing engine is custom and lives in
[`src/lib/chart-plugins/drawing-tools/`](src/lib/chart-plugins/drawing-tools/).
A new tool touches five places:

| File | What you add |
| --- | --- |
| `pages/trading/constants.ts` | the tool name in the `DrawingTool` union and any new fields on `DrawingLine` |
| `drawing-tools/manager.ts` | a branch in `buildNew()` that turns anchor points into a `DrawingLine`, plus the single-click list in the pointer handler if it is a one-click tool |
| `drawing-tools/renderers.ts` | a `case` in the render switch that paints it |
| `drawing-tools/hit-test.ts` | a `case` so it can be selected and dragged |
| `pages/trading/DrawingToolRail.tsx` | the rail button, icon and group |

`geometry.ts` holds the shared math, `types.ts` the resolved (pixel-space)
shapes. Drawings are plain JSON, so anything you add persists automatically.

### Add a chart plugin

Extend `PluginBase` from
[`src/lib/chart-plugins/plugin-base.ts`](src/lib/chart-plugins/plugin-base.ts)
(the Lightweight Charts `ISeriesPrimitive` contract: pane views + renderers),
attach it where the other primitives are attached in `ChartPanel.tsx`, then add
it to the plugin list in `ChartToolbar.tsx` so it gets a toggle. The existing
six plugins are the reference implementations.

### Indicators are pure and covered

`lib/indicators.ts` holds plain functions over candle arrays, with
[49 tests](src/__tests__/indicators.test.ts) pinning the maths (including the
degenerate cases: flat series, zero-range windows, zero-volume bars and invalid
periods). Add an indicator there and the guards apply automatically.

### Quality gates

All four are expected to pass before a PR, and all four pass on `main`:

```bash
npm run typecheck   # tsc --noEmit, strict, zero errors
npm run lint        # ESLint 9 flat config, zero errors *and* zero warnings
npm run test        # Vitest — 166 tests
npm run build       # production bundle
npm run check:size  # first-load payload budget
```

GitHub Actions runs all five on every pull request (`.github/workflows/ci.yml`),
with lint under `--max-warnings=0`. The size gate exists because the first-load
payload was 4.94 MB before the candle data was made lazy — see
[`scripts/check-bundle-size.mjs`](scripts/check-bundle-size.mjs).

The paper engine is the part worth breaking carefully — its order lifecycle,
margin maths and rounding are covered in
[`src/__tests__/engine.test.ts`](src/__tests__/engine.test.ts).

### Where state lives

- **Zustand** (`services/store.tsx`) — auth and trading state (symbols, accounts,
  selected symbol, live ticks).
- **TanStack Query** (`services/queries.ts`) — everything fetched through `api`,
  keyed by `queryKeys`.
- **The demo bus** (`services/demo/bus.ts`) — `market-data`, `positions`,
  `orders` and `account` events; `components/MarketDataBridge.tsx` is the single
  place they land in React.
- **`localStorage`** — drawings (`oc_drawings_<SYMBOL>`), chart templates
  (`oc_chart_templates`), chart and trader preferences (`trader_prefs`, scoped
  per user id) and the sound mute flag (`tradeSoundMuted`). Chart preference
  changes broadcast a `chart-preferences-updated` window event rather than
  going through a store.

### Gotchas worth knowing

- **`api` is typed exactly.** [`services/api.ts`](src/services/api.ts) exposes
  the demo table's real signatures, so calling a method it does not implement is
  a compile error rather than a silent `null`. The `Proxy` underneath is only a
  runtime net for dynamic access, and warns in development when it fires.
- **Candle data loads lazily.** `services/demo/candles.ts` imports each
  `<SYMBOL>_<tf>.json` on demand, so `getHistory` is async and the feed primes
  the 1m series before it starts ticking.
- **Never touch `localStorage` directly** — use
  [`lib/safe-storage.ts`](src/lib/safe-storage.ts). Raw access throws in private
  mode, when site data is blocked, and on quota exhaustion.
- **`REPLAY_ENABLED`** in `pages/trading/constants.ts` still gates the replay
  HUD and scrubber, should you want them off.
- **Dates are local, not UTC.** Use `toLocalDateString()` from `lib/utils.ts`;
  `toISOString().slice(0, 10)` is a different day for most of the world and put
  the replay picker on a day with no data.
- **React runs in `StrictMode`**, so chart effects mount twice in development —
  every series, primitive and subscription needs a working cleanup path.
- **The demo engine is in-memory.** Anything you want to survive a reload has to
  be written to `localStorage` (or a backend you wire up yourself).

## Refreshing the bundled market data

The demo OHLC lives in `src/services/demo/data/` as JSON, fetched from the public
**Binance klines** endpoint (no API key required):

```bash
node scripts/fetch-demo-data.mjs
```

This re-pulls up to 1000 bars per symbol per timeframe and rewrites the bundled files
plus `data/manifest.json`. The candles are genuine market history — OpenCharts
never ships synthetic OHLC.

## Integrating OpenCharts

**You do not fork OpenCharts to use your own data.** Implement one interface,
hand it to the provider, and the whole terminal — chart, order ticket, positions,
replay — runs against your backend.

```tsx
import { OpenChartsProvider, type OpenChartsAdapter } from "opencharts/adapter";

const adapter: OpenChartsAdapter = {
  name: "my-broker",
  marketData: {
    getSymbols: () => myApi.instruments(),
    getCandles: ({ symbol, timeframe, limit, fromMs, toMs }) =>
      myApi.candles(symbol, timeframe, { limit, fromMs, toMs }),
    subscribe: (handler) =>
      myFeed.on("quote", (q) =>
        handler({ type: "tick", symbol: q.symbol, bid: q.bid, ask: q.ask }),
      ),
  },
};

<OpenChartsProvider adapter={adapter}>
  <TradingPage />
</OpenChartsProvider>;
```

That is the minimum: **`marketData` is the only required part.** Add `trading`
to enable the order ticket and positions, and `storage` to keep a trader's
drawings, templates and journal with their account instead of their browser.

### The contract

Defined in [`src/adapter/types.ts`](src/adapter/types.ts):

| Group | Required | What it covers |
| --- | --- | --- |
| `marketData` | **yes** | `getSymbols`, `getCandles`, `subscribe`, and optionally `getQuote`, `connect`/`disconnect`, `onConnectionChange`, `setSymbolInterest` |
| `trading` | no | accounts, positions, orders, closed trades, place/modify/cancel, and a `subscribe` for fills and account updates |
| `storage` | no | a three-method key/value driver for drawings, chart templates and journal entries |

Without `trading`, the terminal runs as a read-only chart and trading calls
fail with a clear message rather than silently doing nothing.

### Rules the terminal relies on

- **Candle times are seconds, not milliseconds**, and bars come back oldest
  first.
- **`toMs` is exclusive.** The chart pages backwards with `fromMs`/`toMs`; an
  adapter that ignores the window makes scroll-back loop, and one that treats
  `toMs` as inclusive duplicates a bar per page.
- **Every method returns a promise and rejects on failure** — never throw
  synchronously. Rejection messages are shown to the trader as-is, so write
  them for a human.
- **`subscribe` returns an unsubscribe function**, and must stop delivering
  once it is called.

### Verify your adapter

A conformance suite ships with the project and checks the things that fail
quietly:

```ts
import { runAdapterConformance } from "opencharts/adapter/conformance";

runAdapterConformance("my-broker", () => createMyAdapter(), { symbol: "BTCUSD" });
```

Trading checks submit and close orders, so they are opt-in
(`allowTrading: true`) — **run them against a paper or sandbox gateway only.**

### A worked example

[`examples/binance-adapter/`](examples/binance-adapter/) is a complete live
adapter for Binance's public API in a single file: REST klines, book-ticker
websocket streams, reconnect with backoff, composed with the bundled paper
engine so you can trade live prices risk-free.

```bash
VITE_ADAPTER=binance npm run dev
```

It is the same terminal in the screenshot above, with nothing patched — only a
different adapter installed.

## Adding instruments

Demo instruments are defined in `src/services/demo/instruments.ts` (currently
BTCUSD, ETHUSD, SOLUSD, BNBUSD, XRPUSD and ADAUSD). To add one:

1. Add a `Symbol` entry (name, tick size, contract size, etc.).
2. Add its trading pair to the `SYMBOLS` map in `scripts/fetch-demo-data.mjs`.
3. Run `node scripts/fetch-demo-data.mjs` to fetch and bundle its history.

## Configuration

Everything works with no configuration. Optional environment variables:

| Variable | Effect |
| --- | --- |
| `VITE_POSTHOG_API_KEY` | Enables PostHog analytics. **Unset (the default) means analytics are never initialized and nothing leaves the browser.** |
| `VITE_POSTHOG_HOST` | PostHog host, defaults to `https://us.i.posthog.com` |
| `VITE_API_URL` | Base URL used by the legacy HTTP client in `src/services/api/` |

Note that the Calendar tab and the technical-analysis gauge load TradingView's
embed scripts from TradingView's CDN — they need no key, but they are third-party
network requests. Drop those components if you want a strictly offline build.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run dev:ci` | Dev server bound to `0.0.0.0:5173` |
| `npm run build` | Production build to `dist/` |
| `npm run check:size` | Fail if the first-load payload exceeds its budget (run after `build`) |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | Type-check the project with `tsc` |
| `npm run test` | Run the Vitest unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | ESLint 9 (flat config in `eslint.config.js`) |
| `node scripts/fetch-demo-data.mjs` | Refresh bundled real OHLC |

## Tech stack

- **React 19** + **TypeScript 5.7** + **Vite 6**
- **lightweight-charts 4** (+ custom plugins) for the chart
- **Zustand** for state, **TanStack Query** for caching
- **Tailwind CSS 3** + **Radix UI** primitives + **lucide-react** icons
- **Zod** in `services/schemas.ts` as the shared type source (types are inferred
  from the schemas; nothing is parsed at runtime)
- **Vitest** + **Testing Library** for tests
- Optional **posthog-js** analytics, off unless a key is set

`react-router-dom` is present only to supply a `BrowserRouter` wrapper — there
are no routes. Lint, typecheck and tests run on ESLint 9 (flat config, including
the React Compiler rule set), TypeScript 5.7 and Vitest.

## Known limitations

- **Account state is ephemeral** — positions, orders and balance reset on reload.
  Drawings, chart preferences and templates persist via `localStorage`.
- **Timeline is normalized** — bundled history is shifted so the latest bar is
  "now", and the tick replay loops when it reaches the end of the 1m series.
  OHLC values are real; the timestamps are remapped to feel live.
- **The DOM ladder is synthetic** — real mid price, simulated depth. There is no
  order book in the bundled data, so sizes are derived from the price level.
- **One position per fill.** The engine is hedging-style: a buy and a sell on the
  same symbol coexist rather than netting off.
- **Crypto-only demo symbols** out of the box (the data source is Binance). Wire
  your own adapter for FX, futures or equities.
- **No news or sentiment integration.** The News tab shows labelled sample
  items. Components that fabricated market analysis — a sentiment gauge and
  "STRONG BUY" trade signals derived from a hash of the symbol name — were
  deleted rather than left for someone to wire up.
- **Replay covers roughly the last 16 hours.** The session buffer is the bundled
  1m history for the charted symbol, so picking an earlier date reports an empty
  session rather than inventing data.
- **The trade calculator is still unmounted**, and challenge/risk-rule price
  levels stay inert because the demo account reports no risk limits.
- **Coverage is logic-first.** The paper engine, indicators, replay, journal,
  storage, ids, live P&L and the event bus are covered, plus the order ticket
  and positions table at the component level. The chart itself is verified by
  driving the running app, not by unit tests. Playwright is a declared dev
  dependency but no end-to-end specs are checked in.
- The production `build` runs Vite only; run `npm run typecheck` separately for
  full type checking.

## Contributing

OpenCharts is a community project and it is open to anyone who wants to make it
better — there is no core team you need permission from. Issues, pull requests,
questions and design opinions are all welcome, and small first contributions are
genuinely useful.

Good places to start:

- **Indicators and drawing tools** — the two most self-contained additions; see
  [Building on OpenCharts](#building-on-opencharts).
- **A real resting-order book** in the demo engine, so limit and stop orders
  actually work.
- **Persistence for the paper account**, so a session survives a reload.
- **Data adapters** for other exchanges or brokers, behind the existing
  `api` / `wsClient` interfaces.
- **Themes and layout customization** — the chart palette lives in
  `pages/trading/constants.ts` and the design tokens in `tailwind.config.js`.
- **Finishing or removing the dormant panels** listed under
  [Known limitations](#known-limitations).
- **Tests, docs and bug reports** — coverage is thin and every report helps.

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers setup, the four CI gates, the layout
of the codebase and what makes a reviewable PR. Please also read the
[Code of Conduct](CODE_OF_CONDUCT.md), and report security issues privately via
[`SECURITY.md`](SECURITY.md) rather than in a public issue.

The one architectural rule: keep changes behind the `api` / `wsClient`
interfaces so the terminal stays backend-agnostic.

## Acknowledgements

OpenCharts stands on TradingView's open-source
[Lightweight Charts™](https://github.com/tradingview/lightweight-charts), which
renders every chart here, and on the plugin examples shipped in that repository.
Thank you to TradingView for releasing it under a permissive license.

## License

OpenCharts is released under the **MIT License** — see [LICENSE](LICENSE).

It bundles TradingView's Lightweight Charts™, which is licensed under the
**Apache License 2.0** and requires that you keep its attribution notice and a
link to <https://www.tradingview.com/> visible to your users. That notice lives
in [NOTICE](NOTICE) — keep it with any copy you redistribute. See
[Built on Lightweight Charts](#built-on-lightweight-charts) for what that means
in practice before you deploy or redistribute a fork.

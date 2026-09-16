<div align="center">

# 📈 OpenCharts

**An open-source trading terminal that runs entirely in your browser — no backend to run, no signup, no API keys.**

Advanced charting · full drawing-tool suite · 8 indicators · watchlist · depth-of-market · order ticket · built-in paper-trading engine, seeded with **real** market history.

![OpenCharts trading terminal](docs/screenshot.png)

</div>

---

## Table of contents

- [What is OpenCharts?](#what-is-opencharts)
- [Features](#features)
- [Quick start](#quick-start)
- [What's real and what's simulated](#whats-real-and-whats-simulated)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Refreshing the bundled market data](#refreshing-the-bundled-market-data)
- [Bring your own data / backend](#bring-your-own-data--backend)
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

### 💵 Built-in paper trading
- $100,000 starting balance, 100× leverage, no commission or swap.
- Orders fill against an in-browser engine at the latest replayed price.
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
| Tick feed | **Real** 1m closes, replayed on a 600 ms loop and looped when exhausted |
| Bar timestamps | **Shifted** so the last real bar lands on the current period |
| Bid/ask spread | **Derived** — synthesized around the replayed close |
| DOM ladder sizes | **Synthetic** — random sizes around the real mid price |
| Order fills, positions, P&L, margin | Real arithmetic against the in-browser engine |
| Limit / stop orders | Accepted by the ticket but **fill immediately** — there is no resting-order book |
| Order modify / cancel-all | **No-ops** in the demo engine |
| News tab | **Placeholder headlines**, not a live feed |
| Economic calendar tab & technical-analysis gauge | TradingView embed widgets — real data, loaded from TradingView's CDN |
| Trade journal, trade calculator, AI trader, session replay | **Present in the code but not reachable** — journal and replay are flagged off pending QA, the AI trader is a stub, the calculator is never mounted |
| Account state (balance, positions, orders) | In-memory — **resets on reload** |
| Drawings, chart prefs, templates, sound mute | Persisted in `localStorage` |

## How it works

The UI is **backend-agnostic**. It talks to two service modules — a REST-shaped
`api` and a streaming `wsClient` — and never cares where the data comes from. In
this repo both are implemented by a small in-browser **demo layer**:

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
├─ services/
│  ├─ api.ts                # REST-shaped facade (demo-backed)
│  ├─ ws.ts                 # streaming client (demo-backed)
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

## Refreshing the bundled market data

The demo OHLC lives in `src/services/demo/data/` as JSON, fetched from the public
**Binance klines** endpoint (no API key required):

```bash
node scripts/fetch-demo-data.mjs
```

This re-pulls up to 1000 bars per symbol per timeframe and rewrites the bundled files
plus `data/manifest.json`. The candles are genuine market history — OpenCharts
never ships synthetic OHLC.

## Bring your own data / backend

To connect OpenCharts to real (or your own simulated) data, implement two files
against your APIs — the rest of the app is untouched:

1. **`src/services/api.ts`** — the request/response methods the UI calls
   (`getSymbols`, `getCandles`, `placeOrder`, `getPositions`, `closePosition`, …).
   `src/services/demo/api.ts` is the complete list of what the terminal actually
   reaches for; the expected shapes are in `src/services/schemas.ts`.
2. **`src/services/ws.ts`** — a client exposing
   `connect` / `subscribe(channel, handler)` / `subscribeAccounts` / `onStateChange`.
   Publish `MarketTick`, `CandleUpdate`, `Position*`, `Order*` and `EquityUpdated`
   events on the `market-data` / `positions` / `orders` / `account` channels.

`src/components/MarketDataBridge.tsx` shows exactly which events the UI consumes.

Two leftovers from the original platform help if you go this route:
`src/services/api/request.ts` is a working HTTP client with token refresh, and
the Vite dev server already proxies `/api` and `/ws` to `http://localhost:3000`.

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
| `npm run preview` | Preview the production build |
| `npm run typecheck` | Type-check the project with `tsc` |
| `npm run test` | Run the Vitest unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Runs `eslint src/` — ESLint is **not** currently a declared dependency, so install it first |
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

`package.json` also declares `framer-motion`, `html-to-image`,
`@tanstack/react-virtual` and `react-router-dom`; the first three are unused and
React Router only supplies a `BrowserRouter` wrapper — there are no routes.

## Known limitations

- **No resting orders.** The demo engine fills every ticket immediately; limit
  and stop prices are accepted but not worked. `modifyOrder` and
  `cancelAllOrders` are no-ops.
- **Account state is ephemeral** — positions, orders and balance reset on reload.
  Drawings, chart preferences and templates persist via `localStorage`.
- **Timeline is normalized** — bundled history is shifted so the latest bar is
  "now", and the tick replay loops when it reaches the end of the 1m series.
  OHLC values are real; the timestamps are remapped to feel live.
- **The DOM ladder is synthetic** — real mid price, random sizes. There is no
  order book in the bundled data.
- **Crypto-only demo symbols** out of the box (the data source is Binance). Wire
  your own adapter for FX, futures or equities.
- **Dormant code from the original platform** ships in the repo: session replay
  (`REPLAY_ENABLED = false`), the trade journal (hidden pending QA), the trade
  calculator (never mounted), the AI trader (stubbed), challenge/risk-rule price
  levels (inert because the demo account reports no risk limits), unused
  marketing assets under `public/`, and four dependencies nothing imports.
- **Thin test coverage** — the Vitest suite covers `lib/utils` and the button
  component only. Playwright is a declared dev dependency but no end-to-end
  specs are checked in.
- The production `build` runs Vite only; run `npm run typecheck` separately for
  full type checking.

## Contributing

Issues and pull requests are welcome. High-value contributions right now: a real
resting-order book in the demo engine, persistence for the paper account, data
adapters for other exchanges/brokers, more indicators, and finishing or removing
the dormant panels listed above.

## Acknowledgements

The chart engine and several plugins build on TradingView's open-source
[`lightweight-charts`](https://github.com/tradingview/lightweight-charts) library.

## License

MIT — see [LICENSE](LICENSE).

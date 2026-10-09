# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

OpenCharts is a browser-only trading terminal (React 19 + Vite + TypeScript) built on TradingView's `lightweight-charts` v4. There is no backend: an in-browser demo layer (`src/services/demo/`) supplies real bundled Binance OHLC and a paper-trading engine. Routes: `/` live terminal, `/replay` FXReplay-style bar-replay backtester (sessions list), `/replay/:id` replay terminal, `/replay/:id/stats`. `README.md` is detailed — consult it for feature-level detail.

## Commands

```bash
npm run dev            # Vite dev server on :5173 (proxies /api and /ws to localhost:3000, unused by the demo)
npm run build          # Vite build only — does NOT type-check
npm run typecheck      # tsc --noEmit (strict, noUncheckedIndexedAccess, noUnusedLocals/Parameters)
npm run test           # vitest run (jsdom, globals, setup in src/__tests__/setup.ts)
npx vitest run src/__tests__/utils.test.ts    # single test file
npx vitest run -t "name of test"              # single test by name
node scripts/fetch-demo-data.mjs              # refresh bundled OHLC in src/services/demo/data/
npm run fetch:history                         # download BTCUSD 15m replay history into public/history/ (gitignored)
npm run import:history -- --symbol XAUUSD     # import user-downloaded gold CSVs from history-import/XAUUSD/
```

`typecheck` and `test` are the pre-PR gates. `npm run lint` exists but ESLint is not a declared dependency. Tests only match `src/**/*.test.{ts,tsx}`; coverage is thin and there are no Playwright specs despite the dependency.

Path aliases: `@/` → `src/`, `@propsim/types` → `src/vendor/types.ts` (defined in `vite.config.ts`, `vitest.config.ts` and `tsconfig.json`). The history scripts are `.ts` run directly by Node (type stripping) and import `src/services/replay/data/codec.ts` — keep that module import-free with erasable-only syntax.

## Architecture

**Backend-agnostic data layer.** The UI only talks to two modules:
- `src/services/api.ts` — REST-shaped facade, typed as `typeof demoApi` (calling an undeclared method is a compile error; a runtime `Proxy` still resolves unknown methods to `null`). `services/demo/api.ts` is the authoritative list of methods; shapes live in `services/schemas.ts` (zod).
- `src/services/ws.ts` — streaming client (`connect` / `subscribe(channel, handler)` / `subscribeAccounts` / `onStateChange`) backed by the in-process `demo/bus.ts`. Channels: `market-data`, `positions`, `orders`, `account`.

Swapping in a real backend means reimplementing those two files only; keep demo-specific logic behind them.

**Demo layer (`services/demo/`):** `engine.ts` is the single source of truth for account/positions/orders (in-memory, resets on reload; marks to market, handles SL/TP). `feed.ts` replays bundled 1m closes as ticks every 600 ms and drives `engine.mark()`. `candles.ts` serves bundled history time-shifted so the last bar is "now". `instruments.ts` defines symbols (adding one also requires an entry in `scripts/fetch-demo-data.mjs` and re-running it).

**Bar replay (`services/replay/`):** history is 15m bars in `public/history/{SYMBOL}/{YEAR}.bin` (columnar binary, `data/codec.ts`) plus `manifest.json`; `data/bar-source.ts` lazy-loads year chunks, `data/aggregate.ts` builds 30m–1w (weeks Monday-aligned) and `data/visible-candles.ts` the chart window with a partial last bar. `engine/` is a pure, clock-free trading engine (prices are bid, ask = bid + spread; orders/SL/TP fill on each 15m bar using TradingView's intrabar path O→H→L→C or O→L→H→C, gaps fill at the open). `controller.ts` owns one open session (engine, window, playback clock, persistence) and mirrors view state into `store.ts` (zustand). The engine plugs into the existing UI: `bus-adapter.ts` publishes live-engine-shaped events under the session's uuid `accountId`, and `demo/replay-router.ts` routes `api` trading calls by account/position/order id to the registered replay backend — so OrderPanel, tables, SL/TP drag and MarketDataBridge work unchanged. `TradingPage` takes optional `replay` bindings (`pages/replay/types.ts`). Sessions, engine state and journal persist in IndexedDB (`persistence/`); replay drawings use the localStorage key `replay:<sessionId>:<SYMBOL>`.

**State:**
- Zustand (`services/store.tsx`) — auth + trading state (symbols, accounts, selected symbol, live ticks).
- TanStack Query (`services/queries.ts`) — everything fetched via `api`, keyed by `queryKeys`.
- `components/MarketDataBridge.tsx` — the single place bus events land in React.
- `localStorage` — drawings (`oc_drawings_<SYMBOL>`), chart templates (`oc_chart_templates`), prefs (`trader_prefs`), `tradeSoundMuted`. Chart preference changes broadcast a `chart-preferences-updated` window event rather than using a store.

**Terminal UI:** `pages/TradingPage.tsx` is the layout; `pages/trading/` holds the panels and chart hooks. `ChartPanel.tsx` creates the chart and attaches series primitives. `src/services/api/` contains legacy HTTP clients from the original platform (only `chart-templates.ts` is live, and it's localStorage-backed).

## Extension points

- **Indicator:** pure calc in `lib/indicators.ts` → add to `IndicatorType` union and `INDICATOR_REGISTRY` (toolbar renders from it) → render/dispose series in `pages/trading/useIndicators.ts`.
- **Drawing tool** (custom engine in `lib/chart-plugins/drawing-tools/`) touches five places: `DrawingTool` union / `DrawingLine` fields in `pages/trading/constants.ts`; `buildNew()` (and single-click list) in `manager.ts`; a case in `renderers.ts`; a case in `hit-test.ts`; the button in `pages/trading/DrawingToolRail.tsx`. Shared math in `geometry.ts`, pixel-space types in `types.ts`. Drawings are plain JSON and persist automatically.
- **Chart plugin:** extend `PluginBase` (`lib/chart-plugins/plugin-base.ts`, an `ISeriesPrimitive`), attach in `ChartPanel.tsx`, add a toggle in `ChartToolbar.tsx`.
- Chart palette: `pages/trading/constants.ts`; design tokens: `tailwind.config.js`.

## Gotchas

- React runs in `StrictMode`: chart effects mount twice in dev, so every series, primitive and subscription needs a correct cleanup.
- Replay controllers are opened twice under StrictMode; only the latest one (ownership token in `controller.ts`) may write the store or register a backend. Keep that invariant when adding controller state.
- ChartPanel applies replay steps with `series.update` when `diffSeries` (pages/trading/series-diff.ts) sees only the last bar changed/appended — this relies on candle objects keeping identity between steps (`appendAggregate` structural sharing + the row cache in `useChartData`). Creating new candle objects every step silently falls back to full `setData`.
- Dormant code from the source platform is gated, not removed: the live journal tab is hidden in `BottomPanel.tsx` (replay has its own), `AiTraderPage` is a stub, `TradeCalculator` is never mounted, challenge levels are inert.
- In the live demo, limit/stop orders fill immediately (only the replay engine rests them); the DOM ladder is synthetic (real mid, random sizes).
- **Licensing:** never set `attributionLogo: false` on the chart (in `ChartPanel.tsx`) — the TradingView attribution is required by Lightweight Charts' Apache 2.0 terms. Plugins in `lib/chart-plugins/` (other than `drawing-tools/`) are adapted from Lightweight Charts' plugin examples and keep that license.
- Optional env: `VITE_POSTHOG_API_KEY` (analytics off when unset), `VITE_POSTHOG_HOST`, `VITE_API_URL` (legacy HTTP client only).

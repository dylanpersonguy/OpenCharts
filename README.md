# OpenCharts

An open-source trading terminal: advanced charting, a full drawing-tool suite,
watchlist, depth-of-market (DOM), and an order panel backed by a built-in
**paper-trading engine** — all running entirely in the browser with **no backend
required**.

Built with React + Vite and [`lightweight-charts`](https://github.com/tradingview/lightweight-charts),
extended with a large library of custom chart plugins (trend lines, rectangles,
session highlighting, volume profile, delta tooltips, price alerts, and more).

## Features

- **Charting** — candles, multiple timeframes (1m → 1w), volume, OHLC legend,
  and a docked drawing toolbar.
- **Drawing tools** — trend lines, rays, rectangles, vertical/horizontal lines,
  text, with per-object styling, templates, and an object tree.
- **Watchlist, DOM & order panel** — market/limit/stop tickets with take-profit
  and stop-loss, position management (modify / close / close-all), orders, and
  trade history.
- **Paper trading** — orders fill against an in-browser engine; positions are
  marked-to-market live, with stop-loss / take-profit handling.
- **Real market data** — the demo session is seeded with genuine historical OHLC
  (no synthetic candles) and replays a tick stream forward from "now".

## Quick start

```bash
npm install
npm run dev
```

Open the printed local URL. The terminal boots straight into a demo session with
a paper-trading account — pick a symbol, set a size, and trade.

## Refreshing the bundled market data

Demo OHLC is bundled under `src/services/demo/data/` and is fetched from the
public Binance klines API (no key required):

```bash
node scripts/fetch-demo-data.mjs
```

## Bring your own data / backend

The data layer is isolated under [`src/services/demo/`](src/services/demo) and
surfaced through `src/services/api.ts` (REST-shaped) and `src/services/ws.ts`
(streaming). To wire OpenCharts to a real backend, implement those two modules
against your own market-data + trading APIs; the UI is agnostic to the source.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | Type-check with `tsc` |
| `npm run test` | Run unit tests |

## License

See [LICENSE](LICENSE).

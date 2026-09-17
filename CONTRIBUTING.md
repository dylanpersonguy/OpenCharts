# Contributing to OpenCharts

Thanks for being here. OpenCharts is a community project with no gatekeeping
core team — issues, pull requests, questions and design opinions are all
welcome, and small first contributions are genuinely useful.

## Getting set up

Requires **Node 20+**.

```bash
git clone https://github.com/dylanpersonguy/OpenCharts.git
cd OpenCharts
npm install
npm run dev
```

The terminal boots straight into a funded paper-trading session against bundled
market data. There is no backend to run and nothing to configure.

## The four gates

CI runs these on every pull request, and they all pass on `main`. Run them
before you push:

```bash
npm run typecheck   # tsc --noEmit, strict
npm run lint        # ESLint 9 — CI runs this with --max-warnings=0
npm run test        # Vitest
npm run build && npm run check:size
```

A few notes on what they enforce:

- **`--max-warnings=0`.** The tree is at zero warnings. The React Compiler rules
  (`react-hooks/purity`, `refs`, `set-state-in-effect`, `immutability`) are the
  ones most likely to be flagging a real defect, so please fix rather than
  suppress. If a suppression is genuinely right — synchronising with an external
  system, for example — add it on the specific line with a comment saying why.
- **`check:size`** guards the first-load payload. It was 4.94 MB before the
  candle data was made lazy. If your change pushes it over budget, prefer a
  lazy import; if the growth is justified, raise the budget in
  `scripts/check-bundle-size.mjs` in the same commit and say why.

## How the project is laid out

The README has a full tour, but the short version:

| Path | What lives there |
| --- | --- |
| `src/pages/trading/` | The terminal: chart, toolbars, order ticket, DOM, watchlist, replay |
| `src/lib/chart-plugins/` | lightweight-charts primitives and the custom drawing engine |
| `src/lib/indicators.ts` | Indicator maths — pure functions over candle arrays |
| `src/services/` | The `api` / `wsClient` boundary and the in-browser demo layer behind it |
| `src/__tests__/` | Vitest suites |

**The one architectural rule**: UI code talks to `api` and `wsClient`, never to
the demo layer directly. That boundary is what lets people point OpenCharts at
their own backend, so please keep changes on the right side of it.

## Good first contributions

- **Indicators.** Add the maths to `src/lib/indicators.ts`, register it in
  `INDICATOR_REGISTRY`, render it in `useIndicators.ts`. Cover the degenerate
  cases — flat series, zero-range windows, invalid periods — the existing tests
  show the pattern.
- **Drawing tools.** Five files, listed in the README's "Building on OpenCharts"
  section.
- **Themes.** The chart palette is in `pages/trading/constants.ts`, design
  tokens in `tailwind.config.js`.
- **Data adapters** for other exchanges or brokers, behind `api` / `wsClient`.
- **Bug reports.** Genuinely useful. Include what you expected and what happened.

## Pull requests

- Branch from `main` and keep the change focused — one concern per PR.
- Explain *why* in the description, not just what. If you fixed a bug, say how
  it reproduced.
- Add or update tests for behaviour you change. Money maths
  (`services/demo/engine.ts`) and indicator maths should not change without
  tests moving with them.
- Comment the non-obvious. This codebase favours a short comment explaining a
  decision over a clever line that needs archaeology later.
- Don't reformat unrelated code — it buries the real change.

## Reporting bugs

Open an issue with the template. The most useful reports include the browser,
what you did, what you expected, what happened, and anything in the console.

## A note on scope

OpenCharts ships no market-data feed, no news integration and no trading
backend. The bundled data is real historical OHLC; everything simulated is
labelled as such in the UI and in the README's "What's real and what's
simulated" table. Please keep it that way — nothing in this project should be
capable of being mistaken for live market data or for trading advice.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE), and that any code you add which derives from
TradingView's Lightweight Charts remains subject to its Apache-2.0 terms
(see [NOTICE](NOTICE)).

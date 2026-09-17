# Live market data from Binance

A working `OpenChartsAdapter` in one file — real prices, real candles, no API
key, and no changes to the terminal itself.

It exists to prove the adapter contract is implementable against a real
backend. If your exchange or broker has a REST endpoint for candles and a
socket for quotes, this is roughly the shape of the work.

## Run it

```bash
VITE_ADAPTER=binance npm run dev
```

The terminal boots against live Binance prices. Trading stays on the bundled
paper engine, so you can place orders against a live market without risking
anything.

## What it implements

| Contract | How |
| --- | --- |
| `getSymbols()` | A fixed map of six USD pairs → Binance's USDT pairs |
| `getCandles()` | `GET /api/v3/klines`, honouring `limit`, `fromMs` and `toMs` |
| `getQuote()` | `GET /api/v3/ticker/bookTicker` |
| `subscribe()` | `wss://stream.binance.com/stream` combined `@bookTicker` streams |
| `connect()` / `disconnect()` | Socket lifecycle with capped exponential-backoff reconnect |
| `onConnectionChange()` | Drives the terminal's connection indicator |

`createBinancePaperAdapter()` then composes that feed with the bundled paper
engine. The only glue needed is forwarding each tick to `engine.mark()`, so the
engine can mark positions to market and trigger resting orders — the same thing
you would do when pairing a live feed with your own execution.

## Two details worth copying

**Timestamps are seconds, not milliseconds.** Binance returns milliseconds;
`klineToCandle` divides. The conformance suite checks this, because a
millisecond timestamp renders as a chart fifty thousand years in the future.

**`toMs` is exclusive.** Binance's `endTime` is inclusive, so the adapter
subtracts a millisecond. Without it, the boundary bar comes back on every page
of scroll-back history and the chart accumulates duplicates. The conformance
suite caught exactly this when the adapter was first written.

## Verify your own adapter

```bash
npm run test -- binance-adapter        # offline: mapping, streaming, reconnect
OC_LIVE_TESTS=1 npm run test -- binance-live   # against the real API
```

The live run is opt-in so CI never fails because an exchange was slow or
rate-limited the runner.

## Before you ship this

- Binance restricts access from some jurisdictions and rate-limits by IP.
- Symbols and tick sizes are hardcoded here. A production adapter should read
  `/api/v3/exchangeInfo` and derive tick size from the symbol filters.
- Ticks are best bid/ask, not trades. Swap to `@trade` or `@aggTrade` if you
  want last-traded prices.
- There is no authentication, because nothing here needs it. Real order
  placement would need signed requests and a key you never put in the browser.

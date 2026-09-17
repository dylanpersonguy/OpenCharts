# Composing your own layout

`<Terminal />` is the whole terminal in its default arrangement. When you want
something else — a chart inside your own dashboard, a chart beside your own
order form — mount the panels individually instead.

```tsx
<OpenChartsProvider adapter={myAdapter}>
  <TerminalProvider>
    <Chart />
    <OrderTicket />
  </TerminalProvider>
</OpenChartsProvider>
```

Two rules:

1. **`OpenChartsProvider`** installs your data and trading backend.
2. **`TerminalProvider`** holds the state the panels share — the charted symbol,
   the timeframe, the account, drawings, positions — so selecting a symbol in
   the watchlist moves the chart, and an order from the ticket appears in
   positions. It also renders the confirm and modify dialogs, so every
   composition gets them.

Layout is entirely yours: neither provider carries sizes, tabs or visibility.

## Available panels

| Panel | What it is |
| --- | --- |
| `<Chart />` | Candles, indicators, drawing tools, position overlays, replay |
| `<OrderTicket />` | Market / limit / stop entry with take-profit and stop-loss |
| `<Positions />` | Open positions with close, partial close and modify |
| `<Orders />` | Working orders with cancel and modify |
| `<Watchlist />` | Instruments with live prices |
| `<DepthLadder />` | Depth ladder around the mid price |

[`App.tsx`](App.tsx) in this folder is a complete example. To see it, render
`<EmbeddedChartExample />` from `src/main.tsx` in place of `<App />`.

## Running it against your own backend

Swap `createDemoAdapter()` for your implementation of `OpenChartsAdapter` —
see the [adapter contract](../../src/adapter/types.ts) and the
[Binance example](../binance-adapter/) for a live one.

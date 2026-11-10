/**
 * OpenCharts — an embeddable trading terminal.
 *
 * ```tsx
 * import { OpenChartsProvider, Terminal } from "@dylanpersonguy/opencharts";
 * import { createDemoAdapter } from "@dylanpersonguy/opencharts/demo";
 * import "@dylanpersonguy/opencharts/style.css";
 *
 * <OpenChartsProvider adapter={createDemoAdapter()}>
 *   <Terminal />
 * </OpenChartsProvider>;
 * ```
 *
 * Point it at your own backend by implementing `OpenChartsAdapter`, and compose
 * your own layout from the individual panels. Neither requires forking.
 */
export * from "./adapter/index.ts";
export * from "./terminal/index.ts";
export type { OpenChartsProviderProps } from "./adapter/provider.tsx";
export { onNotification, type Notification } from "./notifications.ts";
export type { Candle, Order, Position, Symbol, PlaceOrderInput } from "./services/schemas.ts";
// Types only: the Hyperliquid broker itself is not part of the core entry so
// the package does not pull wallet and exchange dependencies into every host.
// Use `createHyperliquidAdapter` from src/hyperliquid/adapter.ts when building the app.
export type { HyperliquidAdapter, HyperliquidAdapterOptions } from "./hyperliquid/adapter.ts";

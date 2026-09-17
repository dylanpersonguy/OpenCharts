/**
 * OpenCharts — an embeddable trading terminal.
 *
 * ```tsx
 * import { OpenChartsProvider, Terminal, createDemoAdapter } from "opencharts";
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
export type { Candle, Order, Position, Symbol, PlaceOrderInput } from "./services/schemas.ts";

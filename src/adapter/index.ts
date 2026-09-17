/**
 * Public entry point for embedding OpenCharts.
 *
 * Implement `OpenChartsAdapter`, hand it to `<OpenChartsProvider>`, and the
 * terminal runs against your backend — no fork, no patched files.
 */
export { OpenChartsProvider } from "./provider.tsx";
export { createDemoAdapter } from "./demo.ts";
export {
  getAdapter,
  hasAdapter,
  onAdapterChange,
  setAdapter,
} from "./registry.ts";
export type {
  Account,
  CandleRequest,
  Candle,
  ClosedPosition,
  ConnectionState,
  MarketDataSource,
  MarketEvent,
  OpenChartsAdapter,
  Order,
  OrderModification,
  Page,
  PlaceOrderInput,
  Position,
  PositionModification,
  Quote,
  StorageDriver,
  Symbol,
  TradingEvent,
  TradingGateway,
  Unsubscribe,
} from "./types.ts";

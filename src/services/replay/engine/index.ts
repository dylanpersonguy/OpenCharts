/** Public API of the pure bar-replay trading engine. */
export * from "./types.ts";
export { createReplayEngine, initialEngineState } from "./create-engine.ts";
export type { EngineListener, ReplayEngine } from "./create-engine.ts";
export { processBar } from "./process-bar.ts";
export { placeOrder, cancelOrder, modifyOrder, modifyPosition } from "./orders.ts";
export { closePosition, closeAll } from "./close.ts";
export { accountSnapshot, grossPnl, marginFor, markPosition } from "./equity.ts";
export { pricePath, pathSegments } from "./intrabar.ts";
export type { PathSegment } from "./intrabar.ts";
export { collectTriggers, orderTrigger, positionTriggers, isCrossed } from "./triggers.ts";
export type { Trigger, TriggerDir, TriggerKind } from "./triggers.ts";
export { askOf, exitPriceAt, roundPrice } from "./price.ts";

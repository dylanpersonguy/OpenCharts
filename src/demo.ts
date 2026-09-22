/**
 * The bundled demo backend, as its own entry point.
 *
 * `createDemoAdapter()` runs the terminal against real historical OHLC and an
 * in-browser paper-trading engine, with nothing to configure — useful for
 * trying OpenCharts out, for tests, and as a reference implementation.
 *
 * It lives apart from the main entry because it carries the bundled candle
 * data. Importing the main entry never pulls that data in.
 */
export { createDemoAdapter } from "./adapter/demo.ts";

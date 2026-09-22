import { useEffect, useState } from "react";
import { createDemoAdapter } from "./adapter/demo.ts";
import { OpenChartsProvider } from "./adapter/provider.tsx";
import type { OpenChartsAdapter } from "./adapter/types.ts";
import { Terminal } from "./terminal/Terminal.tsx";

/**
 * The hosted demo's root.
 *
 * Deliberately what an integrator would write: install an adapter, render the
 * terminal. Everything else — query cache, market-data stream, notifications,
 * error boundary — comes from `<OpenChartsProvider>`.
 *
 * `VITE_ADAPTER=binance npm run dev` swaps in the live-market-data example from
 * examples/binance-adapter, loaded lazily so none of its code reaches the
 * default bundle.
 */

const wantsBinance = import.meta.env.VITE_ADAPTER === "binance";

export function Root() {
  const [adapter, setAdapter] = useState<OpenChartsAdapter | null>(() =>
    wantsBinance ? null : createDemoAdapter(),
  );

  useEffect(() => {
    if (!wantsBinance) return;
    import("../examples/binance-adapter/binance-adapter.ts")
      .then(({ createBinancePaperAdapter }) => createBinancePaperAdapter())
      .then(setAdapter)
      .catch((err: unknown) => {
        console.error("[opencharts] failed to load the Binance adapter; using the demo", err);
        setAdapter(createDemoAdapter());
      });
  }, []);

  if (!adapter) return null;
  return (
    <OpenChartsProvider adapter={adapter}>
      <Terminal />
    </OpenChartsProvider>
  );
}

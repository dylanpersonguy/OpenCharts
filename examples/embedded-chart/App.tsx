import { createDemoAdapter, OpenChartsProvider } from "../../src/adapter/index.ts";
import {
  Chart,
  OrderTicket,
  Positions,
  TerminalProvider,
  Watchlist,
} from "../../src/terminal/index.ts";

/**
 * Composing your own layout.
 *
 * The panels are mounted individually rather than taking `<Terminal />`, so the
 * arrangement is yours: here a chart with a watchlist beside it, an order
 * ticket underneath, and the positions table across the bottom. Drop whichever
 * panels you do not want — `<Chart />` on its own is a valid application.
 *
 * Only two things are required: an adapter, and `<TerminalProvider>` around the
 * panels so they share one symbol, timeframe and account.
 */
export function EmbeddedChartExample() {
  return (
    <OpenChartsProvider adapter={createDemoAdapter()}>
      <TerminalProvider>
        <div className="flex h-screen flex-col bg-background text-foreground">
          <header className="border-b border-border px-4 py-2 text-sm font-semibold">
            My Application
          </header>

          <div className="flex min-h-0 flex-1">
            <main className="min-w-0 flex-1">
              <Chart />
            </main>

            <aside className="flex w-[320px] flex-col border-l border-border">
              <div className="min-h-0 flex-1 overflow-auto">
                <Watchlist />
              </div>
              <div className="border-t border-border">
                <OrderTicket />
              </div>
            </aside>
          </div>

          <section className="h-[180px] overflow-auto border-t border-border">
            <Positions />
          </section>
        </div>
      </TerminalProvider>
    </OpenChartsProvider>
  );
}

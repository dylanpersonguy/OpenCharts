import { TerminalProvider } from "./context.tsx";
import { TradingPage } from "../pages/TradingPage.tsx";

/**
 * The full terminal: chart, toolbar, order ticket, depth, watchlist, positions
 * and replay in the standard layout.
 *
 * ```tsx
 * <OpenChartsProvider adapter={myAdapter}>
 *   <Terminal />
 * </OpenChartsProvider>
 * ```
 *
 * For a different arrangement, use `<TerminalProvider>` with the individual
 * panels instead of this component.
 */
export function Terminal() {
  return (
    <TerminalProvider>
      <TradingPage />
    </TerminalProvider>
  );
}

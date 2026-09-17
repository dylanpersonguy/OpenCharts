/**
 * Composable terminal pieces.
 *
 * `<Terminal />` is the whole thing in its default layout. For a custom
 * arrangement, wrap your own composition in `<TerminalProvider>` and mount only
 * the panels you want — each reads what it needs from the provider.
 */
export { Terminal } from "./Terminal.tsx";
export { TerminalProvider } from "./context.tsx";
export { useTerminal, type TerminalContextValue } from "./use-terminal.ts";
export { Chart, DepthLadder, OrderTicket, Orders, Positions, Watchlist } from "./panels.tsx";

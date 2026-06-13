import { useEffect } from "react";
import { wsClient } from "../services/ws.ts";

/**
 * Declare which market-data symbols this view needs over the WebSocket.
 *
 * The wsClient unions every active declaration and informs the server, which
 * (when the p04_ws_symbol_filtering rollout is enabled) stops sending ticks
 * for undeclared symbols to this connection. Pass "all" for views that render
 * live quotes across the whole symbol list (watchlist / quotes pages).
 *
 * Fail-open by design: no registrations, any "all" registration, or an empty
 * union all clear the server-side filter, so a wiring mistake can only result
 * in extra data — never frozen quotes.
 */
export function useSymbolInterest(key: string, symbols: string[] | "all"): void {
  const serialized = symbols === "all" ? "all" : symbols.join(",");
  useEffect(() => {
    wsClient.setSymbolInterest(
      key,
      serialized === "all" ? "all" : serialized.split(",").filter(Boolean),
    );
    return () => wsClient.setSymbolInterest(key, null);
  }, [key, serialized]);
}

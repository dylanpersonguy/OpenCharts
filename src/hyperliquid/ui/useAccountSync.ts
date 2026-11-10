import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTradingStore } from "../../services/store.tsx";
import { useHlSession } from "../session.ts";

/**
 * Keep the terminal's account list in step with the connected wallet. The
 * account id IS the wallet address, so connecting loads it and disconnecting
 * clears it (and any cached positions/orders) rather than leaving a previous
 * wallet's data on screen.
 */
export function useAccountSync(): void {
  const address = useHlSession((s) => s.address);
  const qc = useQueryClient();
  useEffect(() => {
    let cancelled = false;
    if (!address) {
      useTradingStore.setState({ accounts: [], activeAccountId: null, positions: [], orders: [] });
      void qc.invalidateQueries();
      return;
    }
    useTradingStore
      .getState()
      .loadAccounts()
      .catch((err: unknown) => console.error("[hyperliquid] could not load the account", err))
      .finally(() => {
        if (!cancelled) void qc.invalidateQueries();
      });
    return () => {
      cancelled = true;
    };
  }, [address, qc]);
}

import { useEffect, useState } from "react";
import { useHlSession } from "../session.ts";
import { getAccountSummary, type AccountSummary } from "../wallet/funds.ts";
import type { HlInfoApi } from "../wallet/clients.ts";

/** Equity / free margin for the connected address, polled from the public info API (no session needed). */
export function useAccountSummary(intervalMs = 15_000, info?: Pick<HlInfoApi, "clearinghouseState" | "spotClearinghouseState" | "userAbstraction">) {
  const address = useHlSession((s) => s.address);
  const [loaded, setSummary] = useState<{ address: string; summary: AccountSummary } | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!address) return;
    let live = true;
    const load = (): void => {
      getAccountSummary(address, info)
        .then((s) => {
          if (live) {
            setSummary({ address, summary: s });
            setError(false);
          }
        })
        .catch(() => live && setError(true));
    };
    load();
    const t = setInterval(load, intervalMs);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [address, intervalMs, info, tick]);
  // Never show another account's numbers after a wallet switch.
  const summary = address && loaded?.address === address ? loaded.summary : null;
  return { summary, error, refresh: () => setTick((n) => n + 1) };
}

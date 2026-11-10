import { z } from "zod";
import { create } from "zustand";
import type { FailMode } from "./config.ts";
import { readComplianceSettings } from "./config.ts";

/**
 * Wallet-address screening (sanctions / risk lists).
 *
 * A client-side call is ADVISORY: the visitor controls the browser. Use it to
 * keep honest users out and to produce an audit trail, and enforce the same
 * decision server-side where you can. Never put a screening vendor API key in a
 * VITE_* variable (it ships to every visitor): point VITE_SCREEN_URL at your own
 * edge function that holds the key and answers `GET <url>?address=0x...` with
 * `{ "allowed": boolean }`.
 *
 * Privacy: the address is sent to that URL. Disclose it in your privacy policy.
 */

export interface ScreenResult {
  allowed: boolean;
}

export interface AddressScreener {
  screen(address: string, signal?: AbortSignal): Promise<ScreenResult>;
}

/** Default: everything is allowed. */
export const noopScreener: AddressScreener = {
  screen: () => Promise.resolve({ allowed: true }),
};

const ScreenResponse = z.object({ allowed: z.boolean() });

export interface UrlScreenerOptions {
  timeoutMs?: number;
  failMode?: FailMode;
  fetchImpl?: typeof fetch;
}

export function createUrlScreener(url: string, opts: UrlScreenerOptions = {}): AddressScreener {
  const failMode = opts.failMode ?? "closed";
  return {
    async screen(address, signal) {
      const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 4000);
      signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
      try {
        const u = new URL(url, globalThis.location?.href ?? "https://placeholder.invalid");
        u.searchParams.set("address", address);
        const res = await doFetch(u.toString(), {
          signal: ctrl.signal,
          cache: "no-store",
          credentials: "omit",
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = ScreenResponse.safeParse(await res.json());
        if (!parsed.success) throw new Error("invalid response");
        return { allowed: parsed.data.allowed };
      } catch {
        return { allowed: failMode === "open" };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export type ScreenStatus = "idle" | "checking" | "allowed" | "blocked";

export interface ScreeningState {
  /** Lower-case address the status refers to. */
  address: string | null;
  status: ScreenStatus;
}

/** The gate reads this. `blocked` means the connected wallet must not trade. */
export const useScreeningStore = create<ScreeningState>(() => ({ address: null, status: "idle" }));

let screener: AddressScreener | undefined;
const cache = new Map<string, boolean>();

/** Override the screener (tests, custom vendors). Pass undefined to return to the env-configured one. */
export function setAddressScreener(s: AddressScreener | undefined): void {
  screener = s;
  cache.clear();
}

export function getAddressScreener(): AddressScreener {
  if (screener) return screener;
  const s = readComplianceSettings();
  screener = s.screenUrl ? createUrlScreener(s.screenUrl, { failMode: s.screenFailMode }) : noopScreener;
  return screener;
}

/** True when a non-default screener is active (so the UI should wait for it). */
export function isScreeningConfigured(): boolean {
  return getAddressScreener() !== noopScreener;
}

/**
 * Screen a wallet address and publish the result to `useScreeningStore`.
 * Call it when a wallet connects (ComplianceGate does this automatically by
 * watching `hlSession.address`). Results are cached per address for the page
 * lifetime; the latest call wins if several overlap.
 */
export async function screenAddress(address: string): Promise<ScreenResult> {
  const key = address.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) {
    useScreeningStore.setState({ address: key, status: cached ? "allowed" : "blocked" });
    return { allowed: cached };
  }
  useScreeningStore.setState({ address: key, status: "checking" });
  let allowed: boolean;
  try {
    allowed = (await getAddressScreener().screen(key)).allowed;
  } catch {
    allowed = readComplianceSettings().screenFailMode === "open";
  }
  cache.set(key, allowed);
  if (useScreeningStore.getState().address === key) {
    useScreeningStore.setState({ status: allowed ? "allowed" : "blocked" });
  }
  return { allowed };
}

/** Synchronous guard for the trading path: false only if this address was screened and refused. */
export function isAddressBlocked(address: string | null | undefined): boolean {
  return !!address && cache.get(address.toLowerCase()) === false;
}

export function resetScreening(): void {
  cache.clear();
  useScreeningStore.setState({ address: null, status: "idle" });
}

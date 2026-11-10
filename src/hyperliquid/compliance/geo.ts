import { z } from "zod";
import type { FailMode } from "./config.ts";

/** Response contract of the geo endpoint. Extra fields are ignored. */
const GeoResponse = z.object({
  allowed: z.boolean(),
  country: z.string().max(8).optional(),
  reason: z.string().max(200).optional(),
});

export type GeoVerdict =
  | { kind: "allowed"; country?: string }
  | { kind: "blocked"; country?: string }
  | { kind: "unavailable"; error: string };

export const GEO_TIMEOUT_MS = 4000;

export interface GeoCheckOptions {
  timeoutMs?: number;
  blockedCountries?: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
}

/**
 * Ask the geo endpoint whether this visitor may use the service. Never throws.
 * The static country blocklist is applied on top of the endpoint's answer, so
 * `{allowed:true,country:"XX"}` is still blocked when XX is on the list.
 * The endpoint's free-text `reason` is deliberately discarded: it is never shown.
 */
export async function checkGeo(url: string, opts: GeoCheckOptions = {}): Promise<GeoVerdict> {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? GEO_TIMEOUT_MS);
  try {
    const res = await doFetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { kind: "unavailable", error: `HTTP ${res.status}` };
    const parsed = GeoResponse.safeParse(await res.json());
    if (!parsed.success) return { kind: "unavailable", error: "invalid response" };
    const country = parsed.data.country?.trim().toUpperCase() || undefined;
    if (!parsed.data.allowed) return { kind: "blocked", country };
    if (country && opts.blockedCountries?.has(country)) return { kind: "blocked", country };
    return { kind: "allowed", country };
  } catch (e) {
    const timedOut = ctrl.signal.aborted;
    return { kind: "unavailable", error: timedOut ? "timeout" : e instanceof Error ? e.name : "network" };
  } finally {
    clearTimeout(timer);
  }
}

export type GeoDecision = "allow" | "block";

/** Collapse a verdict + fail mode into the final decision. */
export function decideGeo(v: GeoVerdict, failMode: FailMode): GeoDecision {
  if (v.kind === "allowed") return "allow";
  if (v.kind === "blocked") return "block";
  return failMode === "open" ? "allow" : "block";
}

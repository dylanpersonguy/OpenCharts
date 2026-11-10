/**
 * Compliance configuration. All env parsing for this module lives here.
 *
 * IMPORTANT: everything in this folder runs in the user's browser and is
 * therefore ADVISORY. It reduces accidental use and shows disclosures; it does
 * not enforce anything against a determined user (VPN, devtools, a modified
 * bundle). Real geo-blocking must happen at the edge. See
 * docs/COMPLIANCE_CHECKLIST.md and docs/deploy/.
 */

/**
 * Bump this whenever the Terms & Risk text changes in substance. Everyone who
 * accepted an older version is asked again.
 */
export const TERMS_VERSION = "2026-11-10.1";

export const TERMS_STORAGE_KEY = "openbroker.terms.accepted";

export type FailMode = "open" | "closed";

export interface ComplianceSettings {
  /** Geo endpoint returning `{allowed:boolean,country?:string,reason?:string}`; undefined = no geo gate. */
  geoUrl: string | undefined;
  /**
   * What to do when the geo endpoint cannot be reached / returns garbage.
   * Default "closed" (block). "open" must be chosen explicitly.
   */
  geoFailMode: FailMode;
  /** Upper-case ISO-3166 alpha-2 codes that are always blocked, applied to the endpoint's `country`. */
  blockedCountries: ReadonlySet<string>;
  /** Wallet-screening endpoint, see screen.ts; undefined = no-op screener. */
  screenUrl: string | undefined;
  screenFailMode: FailMode;
}

type Env = Record<string, string | undefined>;
// Literal `import.meta.env` so Vite can statically replace it (and vitest can stub it).
const readEnv = (): Env => import.meta.env;

const ISO2 = /^[A-Z]{2}$/;

export function parseCountryList(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const c = part.trim().toUpperCase();
    if (ISO2.test(c)) out.add(c);
  }
  return out;
}

function parseUrl(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  try {
    const u = new URL(v, "https://placeholder.invalid");
    // Only http(s) or a same-origin path make sense for these endpoints.
    return u.protocol === "https:" || u.protocol === "http:" ? v : undefined;
  } catch {
    return undefined;
  }
}

function parseFailMode(raw: string | undefined): FailMode {
  return raw?.trim().toLowerCase() === "open" ? "open" : "closed";
}

export function readComplianceSettings(e: Env = readEnv()): ComplianceSettings {
  return {
    geoUrl: parseUrl(e.VITE_GEO_CHECK_URL),
    geoFailMode: parseFailMode(e.VITE_GEO_FAIL_MODE),
    blockedCountries: parseCountryList(e.VITE_BLOCKED_COUNTRIES),
    screenUrl: parseUrl(e.VITE_SCREEN_URL),
    screenFailMode: parseFailMode(e.VITE_SCREEN_FAIL_MODE),
  };
}

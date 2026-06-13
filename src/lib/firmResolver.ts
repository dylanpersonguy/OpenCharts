/**
 * Firm Slug Resolver
 *
 * Determines which firm the trader-terminal should render for.
 * Resolution order:
 *   1. ?firm= URL query parameter (used by storefront login/register links)
 *   2. sessionStorage 'firm_slug' (persisted when visiting a firm storefront)
 *   3. Custom domain → call /api/public/resolve-domain/:hostname → get slug + purpose
 *   4. VITE_FIRM_SLUG env var (build-time config)
 *   5. Fallback to 'propsim-demo'
 *
 * The resolved slug is cached for the session so the API is only called once.
 * Purpose is also cached — either 'STOREFRONT' or 'TRADER_TERMINAL'.
 */
import { API_BASE } from "../services/api";

export type DomainPurpose = "STOREFRONT" | "TRADER_TERMINAL";

interface ResolvedFirm {
  slug: string;
  purpose: DomainPurpose;
}

const DEFAULT_SLUG = "propsim-demo";

/** Hostnames that are considered "platform-owned" (not custom domains). */
const PLATFORM_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

/**
 * Reserved subdomains under *.propsim.markets that are platform infrastructure,
 * NOT firm subdomains.  Any subdomain NOT in this list is treated as a firm subdomain
 * and resolved via the /api/public/resolve-domain/ API.
 */
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "admin",
  "trade",
  "app",
  "blog",
  "docs",
  "mail",
  "smtp",
  "status",
  "cdn",
  "staging",
  "dev",
  "test",
]);

function isPlatformHost(hostname: string): boolean {
  if (PLATFORM_HOSTS.has(hostname)) return true;
  if (hostname.endsWith(".localhost")) return true;
  if (hostname.endsWith(".vercel.app")) return true;
  if (hostname.endsWith(".railway.app")) return true;
  if (hostname.endsWith(".propsim.com") || hostname === "propsim.com") return true;
  if (hostname.endsWith(".propsim.io") || hostname === "propsim.io") return true;

  // For *.propsim.markets — only treat reserved subdomains as platform-owned.
  // Firm subdomains like acme-corp.propsim.markets should NOT be treated as platform
  // but instead resolved via the API so the correct firm loads.
  if (hostname === "propsim.markets") return true;
  if (hostname.endsWith(".propsim.markets")) {
    const sub = hostname.replace(".propsim.markets", "");
    return RESERVED_SUBDOMAINS.has(sub);
  }

  return false;
}

let _cached: ResolvedFirm | null = null;
let _resolvePromise: Promise<ResolvedFirm> | null = null;

/**
 * Resolve the firm slug + purpose for the current hostname.
 * Cached — only runs the API call once per page session.
 */
export function resolveFirmSlug(): Promise<string> {
  return resolveFirm().then((r) => r.slug);
}

/**
 * Resolve full firm info (slug + purpose) for the current hostname.
 */
export function resolveFirm(): Promise<ResolvedFirm> {
  if (_cached) return Promise.resolve(_cached);
  if (_resolvePromise) return _resolvePromise;

  _resolvePromise = _doResolve().then((result) => {
    _cached = result;
    return result;
  });

  return _resolvePromise;
}

async function _doResolve(): Promise<ResolvedFirm> {
  // 1. Check ?firm= query parameter (set by storefront login/register links)
  const urlFirm = new URLSearchParams(window.location.search).get("firm");
  if (urlFirm) {
    // Persist so subsequent navigations within the session remember the firm
    try {
      sessionStorage.setItem("firm_slug", urlFirm);
    } catch {}
    return { slug: urlFirm, purpose: "TRADER_TERMINAL" };
  }

  // 2. Check sessionStorage (set when user visits a firm storefront)
  try {
    const stored = sessionStorage.getItem("firm_slug");
    if (stored) return { slug: stored, purpose: "TRADER_TERMINAL" };
  } catch {}

  const hostname = window.location.hostname;

  // 3. If we're on a platform-owned host, use env or default
  if (isPlatformHost(hostname)) {
    return { slug: _envSlug(), purpose: "STOREFRONT" };
  }

  // 3b. Firm subdomain under *.propsim.markets — use subdomain directly as slug
  //     (avoids API call that can fail with 504 behind nginx proxy)
  if (hostname.endsWith(".propsim.markets")) {
    const sub = hostname.replace(".propsim.markets", "");
    if (sub && !RESERVED_SUBDOMAINS.has(sub)) {
      return { slug: sub, purpose: "TRADER_TERMINAL" };
    }
  }

  // 4. Custom domain — ask the API to resolve it
  try {
    const res = await fetch(`${API_BASE}/public/resolve-domain/${encodeURIComponent(hostname)}`);
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data?.slug) {
        return {
          slug: json.data.slug,
          purpose: json.data.purpose || "STOREFRONT",
        };
      }
    }
  } catch {
    // Network error — fall through to env/default
  }

  // 5. API didn't know this domain — use env or default
  return { slug: _envSlug(), purpose: "STOREFRONT" };
}

function _envSlug(): string {
  // Vite injects import.meta.env at build time
  return (
    (import.meta as unknown as { env?: { VITE_FIRM_SLUG?: string } }).env?.VITE_FIRM_SLUG ||
    DEFAULT_SLUG
  );
}

/**
 * Synchronous accessor — returns the cached slug or the env default.
 * Use only AFTER resolveFirmSlug() has completed (e.g. in components
 * that render after the LandingPage useEffect has run).
 */
export function getFirmSlug(): string {
  return _cached?.slug ?? _envSlug();
}

/**
 * Store a firm slug in sessionStorage so that subsequent pages
 * (login, register, etc.) resolve to the correct firm.
 */
export function setFirmSlug(slug: string): void {
  try {
    sessionStorage.setItem("firm_slug", slug);
  } catch {}
  // Invalidate cache so next resolve picks up the new slug
  _cached = null;
  _resolvePromise = null;
}

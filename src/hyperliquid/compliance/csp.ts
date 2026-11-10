/**
 * Content-Security-Policy builder. Pure and dependency-free so that BOTH the
 * Vite config (Node) and the unit tests can import it, which keeps the
 * production <meta> tag, dist/_headers and public/_headers from drifting.
 *
 * Origins the app contacts (enumerated from src/, verified against the build):
 *  - Hyperliquid REST + WebSocket, mainnet and testnet (config.ts HL_ENDPOINTS)
 *  - Arbitrum public RPCs that viem uses for `http()` with its default chain
 *    RPC (wallet/funds.ts createPublicClient): arb1.arbitrum.io (mainnet),
 *    sepolia-rollup.arbitrum.io (testnet)
 *  - env-driven URLs, appended automatically at build time by vite.config.ts:
 *    VITE_GEO_CHECK_URL, VITE_SCREEN_URL, VITE_FEE_CONFIG_URL, VITE_API_URL
 *
 * Script policy is `'self'` only: the production index.html has no inline
 * script. Styles allow 'unsafe-inline' because lightweight-charts injects a
 * <style> element at runtime (attribution logo) and libraries set style
 * attributes; nothing secret lives in the DOM and scripts stay locked down.
 */

export const HL_CONNECT_ORIGINS: readonly string[] = [
  "https://api.hyperliquid.xyz",
  "wss://api.hyperliquid.xyz",
  "https://api.hyperliquid-testnet.xyz",
  "wss://api.hyperliquid-testnet.xyz",
  "https://arb1.arbitrum.io",
  "https://sepolia-rollup.arbitrum.io",
];

export interface CspOptions {
  /** Extra connect-src origins (already origin-only, e.g. "https://geo.example.com"). */
  extraConnect?: readonly string[];
  /** Include directives that only work as an HTTP header (frame-ancestors). */
  header?: boolean;
  /** Demo-only escape hatch for the legacy TradingView embed widgets. Off by default. */
  allowTradingView?: boolean;
}

/** Reduce a URL to its origin; undefined for relative / invalid / non-http(s) URLs (those are covered by 'self'). */
export function originOf(url: string | undefined): string | undefined {
  const v = url?.trim();
  if (!v) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

/** Origins to add to connect-src from the build environment. */
export function extraConnectFromEnv(env: Record<string, string | undefined>): string[] {
  const out = new Set<string>();
  for (const k of ["VITE_GEO_CHECK_URL", "VITE_SCREEN_URL", "VITE_FEE_CONFIG_URL", "VITE_API_URL"]) {
    const o = originOf(env[k]);
    if (o) out.add(o);
  }
  for (const part of (env.VITE_CSP_EXTRA_CONNECT ?? "").split(/[\s,]+/)) {
    const o = originOf(part);
    if (o) out.add(o);
  }
  return [...out];
}

export function buildCsp(opts: CspOptions = {}): string {
  const connect = ["'self'", ...HL_CONNECT_ORIGINS, ...(opts.extraConnect ?? [])];
  const tv = opts.allowTradingView === true;
  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self'${tv ? " https://s3.tradingview.com" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${[...new Set(connect)].join(" ")}`,
    `frame-src ${tv ? "https://*.tradingview.com https://*.tradingview-widget.com" : "'none'"}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ];
  // Ignored (with a console warning) inside a <meta> tag, so header-only.
  if (opts.header) directives.push("frame-ancestors 'none'");
  return directives.join("; ");
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  // allow-popups: some wallet SDKs open a popup that talks back via window.opener.
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
};

/** Netlify / Cloudflare Pages `_headers` file content. */
export function buildHeadersFile(opts: Omit<CspOptions, "header"> = {}): string {
  const lines = ["/*", `  Content-Security-Policy: ${buildCsp({ ...opts, header: true })}`];
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) lines.push(`  ${k}: ${v}`);
  lines.push("", "/assets/*", "  Cache-Control: public, max-age=31536000, immutable", "");
  return lines.join("\n");
}

// SAMPLE ONLY. Not legal advice; have counsel decide the country list.
//
// Cloudflare Worker that enforces geo-blocking at the edge, BEFORE any of your
// HTML/JS is served, and also answers the front-end's advisory check.
//
// Deploy: Workers & Pages -> create Worker -> route `yourdomain.com/*` to it,
// with the origin (Pages project / bucket) behind it. Set the variable
//   BLOCKED_COUNTRIES = "KP,IR,SY,CU"     (ISO-3166 alpha-2, comma separated; example only)
// Front-end build env:  VITE_GEO_CHECK_URL=/geo   (same origin, no CSP change needed)
//
// Limits you must understand: IP geolocation is imperfect, and VPNs/proxies
// defeat it. It is a reasonable-measures control, not a guarantee.

export default {
  async fetch(request, env) {
    const blocked = new Set(
      (env.BLOCKED_COUNTRIES || "")
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
    );
    // request.cf.country is set by Cloudflare; "T1" = Tor, "XX" = unknown.
    const country = (request.cf && request.cf.country) || request.headers.get("CF-IPCountry") || "XX";
    const isBlocked = blocked.has(country);
    // Policy decision for unknown/Tor: here we block Tor (T1) but allow unknown. Change as counsel advises.
    const denied = isBlocked || country === "T1";

    const url = new URL(request.url);
    if (url.pathname === "/geo") {
      return new Response(JSON.stringify({ allowed: !denied, country }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    if (denied) {
      // 451 Unavailable For Legal Reasons. Do not hint at how to bypass.
      return new Response("This service is not available in your region.", {
        status: 451,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return fetch(request);
  },
};

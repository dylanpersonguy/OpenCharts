// SAMPLE ONLY. Not legal advice; have counsel decide the country list.
//
// Vercel Routing Middleware for a Vite SPA: place this file at the project root as
// `middleware.ts`. Vercel sets `x-vercel-ip-country` on every request.
//   Env (Project Settings): BLOCKED_COUNTRIES="KP,IR,SY,CU"  (example only)
//   Front-end build env:    VITE_GEO_CHECK_URL=/geo
//
// IP geolocation is imperfect and VPNs defeat it: this is a reasonable-measures control.

export const config = { matcher: "/((?!_next|favicon.ico).*)" };

const blocked = new Set(
  (process.env.BLOCKED_COUNTRIES ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean),
);

export default function middleware(request: Request): Response | undefined {
  const country = (request.headers.get("x-vercel-ip-country") ?? "XX").toUpperCase();
  const denied = blocked.has(country);
  const { pathname } = new URL(request.url);

  if (pathname === "/geo") {
    return new Response(JSON.stringify({ allowed: !denied, country }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  if (denied) {
    return new Response("This service is not available in your region.", {
      status: 451,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return undefined; // continue to the static site
}

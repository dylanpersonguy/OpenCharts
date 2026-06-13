/**
 * Synchronous localStorage cache for unauthenticated public firm branding.
 *
 * Keyed by hostname so every firm's domain has its own isolated entry.
 * Both LoginPage and RegisterPage read this on first render — if the cache
 * is warm the correct logo/colors appear instantly with zero flash.
 * The cache is always refreshed in the background after a successful API call.
 */

export interface PublicFirmBranding {
  name: string;
  slug: string;
  logoUrl?: string;
  logoUrlDark?: string;
  logoUrlLight?: string;
  logoHeight?: number;
  faviconUrl?: string;
  googleClientId?: string | null;
  // Registration template
  registerTemplate?: string;
  registerAccentColor?: string;
  registerBgColor?: string;
  registerCardBgColor?: string;
  registerTextColor?: string;
  registerButtonColor?: string;
  cachedAt: number;
}

const key = () =>
  `propsim:public-firm:v1:${typeof window !== "undefined" ? window.location.hostname : "ssr"}`;

export function readPublicFirmCache(): PublicFirmBranding | null {
  try {
    const raw = localStorage.getItem(key());
    if (!raw) return null;
    return JSON.parse(raw) as PublicFirmBranding;
  } catch {
    return null;
  }
}

export function writePublicFirmCache(data: Omit<PublicFirmBranding, "cachedAt">): void {
  try {
    localStorage.setItem(key(), JSON.stringify({ ...data, cachedAt: Date.now() }));
  } catch {
    /* ignore quota / private-browsing errors */
  }
}

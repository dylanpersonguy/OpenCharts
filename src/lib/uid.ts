/**
 * Collision-resistant id that works outside secure contexts.
 *
 * `crypto.randomUUID()` is only defined on HTTPS and localhost. Serving the
 * built terminal from a plain-HTTP host (a LAN IP, an internal box) leaves it
 * `undefined`, which used to throw at module load and blank the whole app, so
 * fall back to `getRandomValues` and finally to `Math.random`.
 */
export function uid(): string {
  const c: Crypto | undefined = typeof globalThis === "undefined" ? undefined : globalThis.crypto;

  if (typeof c?.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      // Fall through to the manual paths below.
    }
  }

  if (typeof c?.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    // RFC 4122 version 4 / variant 10xx bits.
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

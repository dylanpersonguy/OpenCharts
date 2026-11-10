import { safeStorage } from "../../lib/safe-storage.ts";
import { TERMS_STORAGE_KEY, TERMS_VERSION } from "./config.ts";

interface Acceptance {
  version: string;
  acceptedAt: number;
}

/** True when the visitor accepted the CURRENT terms version on this browser. */
export function hasAcceptedTerms(version: string = TERMS_VERSION): boolean {
  const a = safeStorage.getJSON<Partial<Acceptance> | null>(TERMS_STORAGE_KEY, null);
  return !!a && a.version === version;
}

/** Record acceptance. Returns false if the browser would not persist it (still accepted for this page view). */
export function recordTermsAcceptance(version: string = TERMS_VERSION, now: number = Date.now()): boolean {
  return safeStorage.setJSON(TERMS_STORAGE_KEY, { version, acceptedAt: now } satisfies Acceptance);
}

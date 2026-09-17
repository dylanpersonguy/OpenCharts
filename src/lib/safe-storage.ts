/**
 * Web Storage that cannot crash the app.
 *
 * Every accessor guarded here is a real failure mode, not defensive padding:
 * Safari in private mode throws on `setItem`, Chrome throws `SecurityError` on
 * any access when site data is blocked (the terminal is commonly embedded in an
 * iframe), quota exhaustion throws `QuotaExceededError` once enough drawings
 * accumulate, and a corrupt value makes `JSON.parse` throw at module load.
 *
 * Reads degrade to a fallback and writes degrade to a no-op that reports
 * failure, so the terminal keeps running with in-memory state.
 */

type StorageKind = "local" | "session";

function pick(kind: StorageKind): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    // Access to the property itself throws when site data is blocked.
    return null;
  }
}

export interface SafeStorage {
  getItem(key: string): string | null;
  /** Returns false when the value could not be persisted (quota, private mode). */
  setItem(key: string, value: string): boolean;
  removeItem(key: string): boolean;
  /** Parse a JSON value, falling back when it is missing or corrupt. */
  getJSON<T>(key: string, fallback: T): T;
  setJSON(key: string, value: unknown): boolean;
}

function makeStore(kind: StorageKind): SafeStorage {
  const storage = () => pick(kind);

  return {
    getItem(key: string): string | null {
      try {
        return storage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },

    setItem(key: string, value: string): boolean {
      try {
        const store = storage();
        if (!store) return false;
        store.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },

    removeItem(key: string): boolean {
      try {
        const store = storage();
        if (!store) return false;
        store.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },

    getJSON<T>(key: string, fallback: T): T {
      const raw = this.getItem(key);
      if (raw == null) return fallback;
      try {
        const parsed: unknown = JSON.parse(raw);
        return (parsed ?? fallback) as T;
      } catch {
        return fallback;
      }
    },

    setJSON(key: string, value: unknown): boolean {
      try {
        return this.setItem(key, JSON.stringify(value));
      } catch {
        // Circular structures throw inside stringify.
        return false;
      }
    },
  };
}

export const safeStorage: SafeStorage = makeStore("local");
export const safeSession: SafeStorage = makeStore("session");

import "@testing-library/jest-dom/vitest";

/**
 * jsdom exposes `window.localStorage` as an object with no methods in this
 * environment, so anything touching Web Storage throws `setItem is not a
 * function`. Install a working in-memory implementation so tests exercise the
 * same code path a browser would.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(window, name, {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

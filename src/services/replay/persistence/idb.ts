/**
 * Minimal promise wrapper around IndexedDB — just enough for the replay
 * repository (get / getAll / getAllFromIndex / put / delete, one store per
 * transaction plus a multi-store cascade delete).
 */

export interface StoreSpec {
  readonly name: string;
  readonly keyPath: string;
  readonly indexes?: readonly { readonly name: string; readonly keyPath: string }[];
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function createStores(db: IDBDatabase, stores: readonly StoreSpec[]): void {
  for (const spec of stores) {
    if (db.objectStoreNames.contains(spec.name)) continue;
    const store = db.createObjectStore(spec.name, { keyPath: spec.keyPath });
    for (const idx of spec.indexes ?? []) store.createIndex(idx.name, idx.keyPath);
  }
}

/** Open (and create/upgrade) a database. */
export function openDb(name: string, version: number, stores: readonly StoreSpec[]): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this browser"));
  }
  const req = indexedDB.open(name, version);
  req.onupgradeneeded = () => createStores(req.result, stores);
  return promisify(req);
}

export interface Db {
  get<T>(store: string, key: string): Promise<T | undefined>;
  getAll<T>(store: string): Promise<T[]>;
  getAllFromIndex<T>(store: string, index: string, key: string): Promise<T[]>;
  put<T>(store: string, value: T): Promise<void>;
  delete(store: string, key: string): Promise<void>;
  /** Delete `key` from every store in `keyed` and all rows matching `key` in each index of `indexed`. */
  cascadeDelete(
    keyed: readonly string[],
    indexed: readonly { store: string; index: string }[],
    key: string,
  ): Promise<void>;
}

/** Wrap an open database in the small `Db` interface. */
export function wrapDb(db: IDBDatabase): Db {
  const store = (name: string, mode: IDBTransactionMode) => db.transaction(name, mode).objectStore(name);
  return {
    get: <T>(name: string, key: string) => promisify(store(name, "readonly").get(key)) as Promise<T | undefined>,
    getAll: <T>(name: string) => promisify(store(name, "readonly").getAll()) as Promise<T[]>,
    getAllFromIndex: <T>(name: string, index: string, key: string) =>
      promisify(store(name, "readonly").index(index).getAll(key)) as Promise<T[]>,
    put: async (name, value) => {
      await promisify(store(name, "readwrite").put(value));
    },
    delete: async (name, key) => {
      await promisify(store(name, "readwrite").delete(key));
    },
    cascadeDelete: async (keyed, indexed, key) => {
      const names = [...new Set([...keyed, ...indexed.map((i) => i.store)])];
      const tx = db.transaction(names, "readwrite");
      for (const name of keyed) tx.objectStore(name).delete(key);
      for (const { store: name, index } of indexed) {
        const os = tx.objectStore(name);
        const keys = await promisify(os.index(index).getAllKeys(key));
        for (const k of keys) os.delete(k);
      }
      await txDone(tx);
    },
  };
}

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, HlNetwork } from "./config.ts";
import { create } from "zustand";
import { toast } from "../services/toast.ts";
import type { AgentCredential } from "./session.ts";

/**
 * Agent (API wallet) key lifecycle.
 *
 * The agent key can only place/cancel orders (it can NOT withdraw). We generate
 * it in the browser, encrypt it with AES-GCM using a NON-EXTRACTABLE CryptoKey
 * kept in IndexedDB, and store only {address, encryptedKey, validUntil}. A script
 * that dumps localStorage therefore learns nothing; an attacker with full
 * same-origin code execution can still *use* the key (inherent to any browser
 * key storage), which is why the agent is limited and expiring.
 *
 * Keys are never logged.
 */

export const AGENT_BASE_NAME = "OpenBroker"; // <= 16 chars (HL limit, excluding the valid_until suffix)
/** 30 days: a shorter agent lifetime limits the blast radius of a same-origin compromise. */
export const DEFAULT_AGENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** HL allows at most 180 days. */
export const MAX_AGENT_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** Rotation window, proportional to the TTL (3 of 30 days). */
export const ROTATE_BEFORE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * HL agent name carrying an expiry: `"<name> valid_until <unix ms>"`
 * (SDK approveAgent docs; the base name must be <= 16 chars).
 */
export function buildAgentName(validUntil: number, base: string = AGENT_BASE_NAME): string {
  if (base.length > 16) throw new Error("Agent base name must be at most 16 characters.");
  return `${base} valid_until ${Math.floor(validUntil)}`;
}

export function computeValidUntil(now: number = Date.now(), ttlMs: number = DEFAULT_AGENT_TTL_MS): number {
  return now + Math.min(Math.max(ttlMs, 60_000), MAX_AGENT_TTL_MS);
}

/** True when the agent is expired or inside the rotation window. */
export function needsRotation(validUntil: number, now: number = Date.now()): boolean {
  return validUntil - now < ROTATE_BEFORE_MS;
}

export function isExpired(validUntil: number, now: number = Date.now()): boolean {
  return validUntil <= now;
}

// ---------------------------------------------------------------------------
// Vault abstraction
// ---------------------------------------------------------------------------

export interface StoredAgent {
  address: Address;
  /** iv (12 bytes) || AES-GCM ciphertext of the 32-byte private key. */
  encryptedKey: Uint8Array;
  validUntil: number;
}

export interface KeyVault {
  /** The non-extractable AES-GCM wrapping key, if one exists. */
  getWrapKey(): Promise<CryptoKey | undefined>;
  setWrapKey(key: CryptoKey): Promise<void>;
  getAgent(id: string): Promise<StoredAgent | undefined>;
  putAgent(id: string, agent: StoredAgent): Promise<void>;
  deleteAgent(id: string): Promise<void>;
}

export function createMemoryVault(): KeyVault {
  let wrap: CryptoKey | undefined;
  const agents = new Map<string, StoredAgent>();
  return {
    getWrapKey: () => Promise.resolve(wrap),
    setWrapKey: (k) => {
      wrap = k;
      return Promise.resolve();
    },
    getAgent: (id) => Promise.resolve(agents.get(id)),
    putAgent: (id, a) => {
      agents.set(id, a);
      return Promise.resolve();
    },
    deleteAgent: (id) => {
      agents.delete(id);
      return Promise.resolve();
    },
  };
}

const DB_NAME = "openbroker-hl";
const STORE = "kv";
const WRAP_ID = "wrapKey";

function idb<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let open: IDBOpenDBRequest;
    try {
      open = indexedDB.open(DB_NAME, 1);
    } catch (err) {
      reject(err instanceof Error ? err : new Error("IndexedDB unavailable"));
      return;
    }
    open.onblocked = () => reject(new Error("IndexedDB blocked"));
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("IndexedDB unavailable"));
  });
}

/** IndexedDB-backed vault. CryptoKey objects are structured-cloneable, so they stay non-extractable. */
export function createIndexedDbVault(): KeyVault {
  let dbp: Promise<IDBDatabase> | undefined;
  const store = async (mode: IDBTransactionMode): Promise<IDBObjectStore> => {
    if (!dbp) {
      const p = openDb();
      dbp = p;
      // Never cache a rejected open: the next call retries.
      p.catch(() => {
        if (dbp === p) dbp = undefined;
      });
    }
    return (await dbp).transaction(STORE, mode).objectStore(STORE);
  };
  return {
    async getWrapKey() {
      return (await idb((await store("readonly")).get(WRAP_ID))) as CryptoKey | undefined;
    },
    async setWrapKey(key) {
      await idb((await store("readwrite")).put(key, WRAP_ID));
    },
    async getAgent(id) {
      return (await idb((await store("readonly")).get(`agent:${id}`))) as StoredAgent | undefined;
    },
    async putAgent(id, agent) {
      await idb((await store("readwrite")).put(agent, `agent:${id}`));
    },
    async deleteAgent(id) {
      await idb((await store("readwrite")).delete(`agent:${id}`));
    },
  };
}

let defaultVault: KeyVault | undefined;
/** IndexedDB when available, else in-memory (key lost on reload; user re-approves). */
export function getDefaultVault(): KeyVault {
  defaultVault ??= typeof indexedDB !== "undefined" ? createIndexedDbVault() : createMemoryVault();
  return defaultVault;
}
export function setDefaultVault(v: KeyVault | undefined): void {
  defaultVault = v;
  if (v === undefined) sessionFallback = undefined; // full reset (tests / re-init)
}

export const agentId = (network: HlNetwork, main: Address): string => `${network}:${main.toLowerCase()}`;

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("This browser does not support WebCrypto; cannot store a trading key securely.");
  return s;
}

async function getOrCreateWrapKey(vault: KeyVault): Promise<CryptoKey> {
  const existing = await vault.getWrapKey();
  if (existing) return existing;
  const key = await subtle().generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await vault.setWrapKey(key);
  return key;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(new ArrayBuffer(h.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(b: Uint8Array): `0x${string}` {
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function toBuf(b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(b.length));
  out.set(b);
  return out;
}

/** AAD binds a blob to `network:mainAddress` so it cannot be swapped between accounts. */
function aadBytes(aad: string): Uint8Array<ArrayBuffer> {
  return toBuf(new TextEncoder().encode(`openbroker-agent-v2:${aad}`));
}

export async function encryptKey(
  vault: KeyVault,
  privateKey: `0x${string}`,
  aad?: string,
): Promise<Uint8Array> {
  const key = await getOrCreateWrapKey(vault);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const params: AesGcmParams = { name: "AES-GCM", iv };
  if (aad !== undefined) params.additionalData = aadBytes(aad);
  const ct = new Uint8Array(await subtle().encrypt(params, key, hexToBytes(privateKey)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

export async function decryptKey(vault: KeyVault, blob: Uint8Array, aad?: string): Promise<`0x${string}`> {
  const key = await vault.getWrapKey();
  if (!key) throw new Error("Encryption key missing");
  return decryptWith(key, blob, aad);
}

async function decryptWith(key: CryptoKey, blob: Uint8Array, aad?: string): Promise<`0x${string}`> {
  const params: AesGcmParams = { name: "AES-GCM", iv: toBuf(blob.slice(0, 12)) };
  if (aad !== undefined) params.additionalData = aadBytes(aad);
  const pt = await subtle().decrypt(params, key, toBuf(blob.slice(12)));
  return bytesToHex(new Uint8Array(pt));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Shown when the agent key could only be kept in memory (it will not survive a reload). */
export const VOLATILE_KEY_NOTICE =
  "Your browser blocked persistent storage, so the trading key is kept in memory only for this session. You will need to re-approve it after reloading.";

export interface AgentVaultState {
  /** True when the current agent key lives in memory only. */
  volatile: boolean;
  notice: string | null;
}
/** UI can subscribe to show a non-blocking banner. */
export const useAgentVaultStore = create<AgentVaultState>(() => ({ volatile: false, notice: null }));

/** In-memory vault used when the persistent one is unusable (session only). */
let sessionFallback: KeyVault | undefined;

function announceVolatile(): void {
  useAgentVaultStore.setState({ volatile: true, notice: VOLATILE_KEY_NOTICE });
  try {
    toast.warning("Trading key not saved", VOLATILE_KEY_NOTICE);
  } catch {
    /* notices are best-effort */
  }
}

export interface NewAgent {
  /** Pass `address` + `name` to approveAgent; call `persist()` only after HL accepted it. */
  address: Address;
  name: string;
  validUntil: number;
  persist(): Promise<AgentCredential>;
}

/**
 * Generate a fresh agent key (held only in this closure until `persist()`).
 * Persisting after the approval succeeds avoids orphaned keys.
 */
export function createAgent(
  network: HlNetwork,
  main: Address,
  opts: {
    vault?: KeyVault;
    now?: number;
    ttlMs?: number;
    generate?: () => `0x${string}`;
    /** Called (in addition to the store + toast) when the key falls back to memory. */
    onVolatile?: (notice: string) => void;
  } = {},
): NewAgent {
  const vault = opts.vault ?? getDefaultVault();
  const privateKey = (opts.generate ?? generatePrivateKey)();
  const account = privateKeyToAccount(privateKey);
  const validUntil = computeValidUntil(opts.now, opts.ttlMs);
  const address = account.address.toLowerCase() as Address;
  return {
    address,
    name: buildAgentName(validUntil),
    validUntil,
    async persist() {
      const id = agentId(network, main);
      try {
        const encryptedKey = await encryptKey(vault, privateKey, id);
        await vault.putAgent(id, { address, encryptedKey, validUntil });
        useAgentVaultStore.setState({ volatile: false, notice: null });
      } catch {
        // HL has ALREADY accepted this agent: never throw now. Keep the key in
        // memory for this session and tell the user it will not survive a reload.
        sessionFallback ??= createMemoryVault();
        try {
          const encryptedKey = await encryptKey(sessionFallback, privateKey, id);
          await sessionFallback.putAgent(id, { address, encryptedKey, validUntil });
        } catch {
          /* the live account below still works for this session */
        }
        if (!opts.vault) setDefaultVault(sessionFallback);
        announceVolatile();
        opts.onVolatile?.(VOLATILE_KEY_NOTICE);
      }
      return { address, account, validUntil };
    },
  };
}

/** Load + decrypt the stored agent. Returns null if none, expired, or undecryptable (and cleans up). */
export async function loadAgent(
  network: HlNetwork,
  main: Address,
  opts: { vault?: KeyVault; now?: number } = {},
): Promise<AgentCredential | null> {
  const vault = opts.vault ?? getDefaultVault();
  const id = agentId(network, main);

  let stored: StoredAgent | undefined;
  let wrap: CryptoKey | undefined;
  let source = vault;
  try {
    stored = await vault.getAgent(id);
    if (stored) wrap = await vault.getWrapKey();
  } catch {
    // Transient read failure: keep the record. Fall back to this session's memory copy.
    if (!sessionFallback || sessionFallback === vault) return null;
    try {
      source = sessionFallback;
      stored = await source.getAgent(id);
      if (stored) wrap = await source.getWrapKey();
    } catch {
      return null;
    }
  }
  if (!stored) return null;

  const del = () => source.deleteAgent(id).catch(() => undefined);
  if (isExpired(stored.validUntil, opts.now)) {
    await del();
    return null;
  }
  if (!wrap) {
    await del(); // the non-extractable wrap key is gone: undecryptable forever
    return null;
  }
  subtle(); // missing WebCrypto is an environment problem, not corruption: throws without deleting

  try {
    let privateKey: `0x${string}`;
    let legacy = false;
    try {
      privateKey = await decryptWith(wrap, stored.encryptedKey, id);
    } catch {
      // Blobs written before AAD binding: accept once, then re-encrypt below.
      privateKey = await decryptWith(wrap, stored.encryptedKey);
      legacy = true;
    }
    const account = privateKeyToAccount(privateKey);
    if (account.address.toLowerCase() !== stored.address.toLowerCase()) throw new Error("Agent key mismatch");
    if (legacy) {
      try {
        await source.putAgent(id, {
          address: stored.address,
          encryptedKey: await encryptKey(source, privateKey, id),
          validUntil: stored.validUntil,
        });
      } catch {
        /* migration is best-effort; the legacy blob still decrypts */
      }
    }
    return { address: stored.address, account, validUntil: stored.validUntil };
  } catch {
    // Both AAD and legacy decryption failed (or the key is malformed): certainly unusable.
    await del();
    return null;
  }
}

/** Forget the local agent key (wipe on disconnect). The on-chain approval remains until replaced/expired. */
export async function revokeAgent(
  network: HlNetwork,
  main: Address,
  opts: { vault?: KeyVault } = {},
): Promise<void> {
  await (opts.vault ?? getDefaultVault()).deleteAgent(agentId(network, main));
}

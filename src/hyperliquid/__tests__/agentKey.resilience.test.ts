import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentId,
  createAgent,
  createIndexedDbVault,
  createMemoryVault,
  decryptKey,
  encryptKey,
  getDefaultVault,
  loadAgent,
  setDefaultVault,
  useAgentVaultStore,
  type KeyVault,
} from "../agentKey.ts";

const MAIN = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const PK = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318" as const;

afterEach(() => {
  vi.unstubAllGlobals();
  setDefaultVault(undefined);
  useAgentVaultStore.setState({ volatile: false, notice: null });
});

function brokenVault(): KeyVault {
  const fail = () => Promise.reject(new Error("storage unavailable"));
  return { getWrapKey: fail, setWrapKey: fail, getAgent: fail, putAgent: fail, deleteAgent: fail };
}

describe("IndexedDB vault", () => {
  it("does not cache a rejected open forever", async () => {
    let calls = 0;
    const fakeIdb = {
      open: () => {
        calls++;
        const req: Record<string, unknown> = { result: {} };
        const ok = calls > 1;
        setTimeout(() => {
          if (ok) {
            req.result = {
              transaction: () => ({
                objectStore: () => ({
                  get: () => {
                    const r: Record<string, unknown> = { result: undefined };
                    setTimeout(() => (r.onsuccess as () => void)(), 0);
                    return r;
                  },
                }),
              }),
            };
            (req.onsuccess as () => void)();
          } else {
            req.error = new Error("blocked");
            (req.onerror as () => void)();
          }
        }, 0);
        return req;
      },
    };
    vi.stubGlobal("indexedDB", fakeIdb);
    const v = createIndexedDbVault();
    await expect(v.getAgent("x")).rejects.toThrow();
    await expect(v.getAgent("x")).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});

describe("persist fallback", () => {
  it("falls back to memory instead of throwing after HL accepted the agent", async () => {
    const onVolatile = vi.fn();
    const a = createAgent("testnet", MAIN, { vault: brokenVault(), generate: () => PK, onVolatile });
    const cred = await a.persist();
    expect(cred.address).toBe(a.address);
    expect(useAgentVaultStore.getState().volatile).toBe(true);
    expect(useAgentVaultStore.getState().notice).toMatch(/memory only/);
    expect(onVolatile).toHaveBeenCalledOnce();
  });
  it("uses the in-memory vault as default afterwards so loadAgent still finds it", async () => {
    setDefaultVault(brokenVault());
    const a = createAgent("testnet", MAIN, { generate: () => PK });
    await a.persist();
    const loaded = await loadAgent("testnet", MAIN);
    expect(loaded?.address).toBe(a.address);
  });
});

describe("loadAgent deletion policy", () => {
  it("keeps the stored agent on transient storage errors", async () => {
    const vault = createMemoryVault();
    await createAgent("testnet", MAIN, { vault }).persist();
    const del = vi.fn(vault.deleteAgent);
    const flaky: KeyVault = {
      ...vault,
      getAgent: () => Promise.reject(new Error("transient")),
      deleteAgent: del,
    };
    expect(await loadAgent("testnet", MAIN, { vault: flaky })).toBeNull();
    expect(del).not.toHaveBeenCalled();
    expect(await loadAgent("testnet", MAIN, { vault })).not.toBeNull();
  });
  it("keeps the agent when only the wrap-key read fails transiently", async () => {
    const vault = createMemoryVault();
    await createAgent("testnet", MAIN, { vault }).persist();
    const del = vi.fn();
    const flaky: KeyVault = { ...vault, getWrapKey: () => Promise.reject(new Error("transient")), deleteAgent: del };
    expect(await loadAgent("testnet", MAIN, { vault: flaky })).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });
  it("deletes when the wrap key is gone (certainly undecryptable)", async () => {
    const vault = createMemoryVault();
    await createAgent("testnet", MAIN, { vault }).persist();
    await vault.setWrapKey(undefined as unknown as CryptoKey);
    expect(await loadAgent("testnet", MAIN, { vault })).toBeNull();
    expect(await vault.getAgent(agentId("testnet", MAIN))).toBeUndefined();
  });
});

describe("AES-GCM AAD", () => {
  it("binds the blob to network:address", async () => {
    const vault = createMemoryVault();
    const blob = await encryptKey(vault, PK, agentId("testnet", MAIN));
    await expect(decryptKey(vault, blob, agentId("testnet", MAIN))).resolves.toBe(PK);
    await expect(decryptKey(vault, blob, agentId("testnet", OTHER))).rejects.toThrow();
    await expect(decryptKey(vault, blob)).rejects.toThrow();
  });
  it("rejects a blob swapped between accounts", async () => {
    const vault = createMemoryVault();
    await createAgent("testnet", MAIN, { vault, generate: () => PK }).persist();
    const stored = await vault.getAgent(agentId("testnet", MAIN));
    if (!stored) throw new Error("missing");
    await vault.putAgent(agentId("testnet", OTHER), stored);
    expect(await loadAgent("testnet", OTHER, { vault })).toBeNull();
  });
  it("migrates a legacy (no-AAD) blob once, then stores it with AAD", async () => {
    const vault = createMemoryVault();
    const { privateKeyToAccount } = await import("viem/accounts");
    const address = privateKeyToAccount(PK).address.toLowerCase() as `0x${string}`;
    const legacy = await encryptKey(vault, PK); // pre-AAD format
    const id = agentId("testnet", MAIN);
    await vault.putAgent(id, { address, encryptedKey: legacy, validUntil: Date.now() + 86_400_000 });
    const loaded = await loadAgent("testnet", MAIN, { vault });
    expect(loaded?.address).toBe(address);
    const migrated = await vault.getAgent(id);
    expect(migrated?.encryptedKey).not.toEqual(legacy);
    await expect(decryptKey(vault, migrated?.encryptedKey ?? new Uint8Array(), id)).resolves.toBe(PK);
    expect((await loadAgent("testnet", MAIN, { vault }))?.address).toBe(address);
  });
});

describe("default vault", () => {
  it("is IndexedDB-backed when indexedDB exists", () => {
    vi.stubGlobal("indexedDB", { open: vi.fn() });
    expect(getDefaultVault()).toBeDefined();
  });
});

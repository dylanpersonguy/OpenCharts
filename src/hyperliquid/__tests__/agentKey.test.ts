import { describe, expect, it } from "vitest";
import {
  buildAgentName,
  computeValidUntil,
  createAgent,
  createMemoryVault,
  loadAgent,
  needsRotation,
  revokeAgent,
  DEFAULT_AGENT_TTL_MS,
} from "../agentKey.ts";

const MAIN = "0x1111111111111111111111111111111111111111" as const;
const PK = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318" as const;

describe("agent name / expiry", () => {
  it("uses the HL valid_until syntax", () => {
    expect(buildAgentName(1234567890123)).toBe("OpenBroker valid_until 1234567890123");
    expect(() => buildAgentName(1, "x".repeat(17))).toThrow();
  });
  it("defaults to 30 days, capped at 180", () => {
    expect(DEFAULT_AGENT_TTL_MS).toBe(30 * 86_400_000);
    expect(computeValidUntil(0)).toBe(DEFAULT_AGENT_TTL_MS);
    expect(computeValidUntil(0, 10 ** 12)).toBe(180 * 86_400_000);
  });
  it("rotates inside the 3-day window", () => {
    expect(needsRotation(5 * 86_400_000, 0)).toBe(false);
    expect(needsRotation(2 * 86_400_000, 0)).toBe(true);
  });
});

describe("agent persistence", () => {
  it("round-trips and never stores the raw key", async () => {
    const vault = createMemoryVault();
    const a = createAgent("testnet", MAIN, { vault, generate: () => PK, now: Date.now() });
    const cred = await a.persist();
    const stored = await vault.getAgent(`testnet:${MAIN}`);
    expect(stored).toBeDefined();
    const hex = Array.from(stored?.encryptedKey ?? [], (b) => b.toString(16).padStart(2, "0")).join("");
    expect(hex).not.toContain(PK.slice(2));
    const loaded = await loadAgent("testnet", MAIN, { vault });
    expect(loaded?.address).toBe(cred.address);
    expect(loaded?.account.address.toLowerCase()).toBe(cred.address);
  });
  it("is keyed by network and address", async () => {
    const vault = createMemoryVault();
    await createAgent("testnet", MAIN, { vault }).persist();
    expect(await loadAgent("mainnet", MAIN, { vault })).toBeNull();
    expect(await loadAgent("testnet", "0x2222222222222222222222222222222222222222", { vault })).toBeNull();
  });
  it("drops expired agents", async () => {
    const vault = createMemoryVault();
    const a = createAgent("testnet", MAIN, { vault, now: 0, ttlMs: 60_000 });
    await a.persist();
    expect(await loadAgent("testnet", MAIN, { vault, now: 61_000 })).toBeNull();
    expect(await vault.getAgent(`testnet:${MAIN}`)).toBeUndefined();
  });
  it("treats tampered ciphertext as no agent", async () => {
    const vault = createMemoryVault();
    await createAgent("testnet", MAIN, { vault }).persist();
    const s = await vault.getAgent(`testnet:${MAIN}`);
    if (!s) throw new Error("missing");
    s.encryptedKey[20] = (s.encryptedKey[20] ?? 0) ^ 0xff;
    expect(await loadAgent("testnet", MAIN, { vault })).toBeNull();
  });
  it("revokeAgent wipes", async () => {
    const vault = createMemoryVault();
    await createAgent("testnet", MAIN, { vault }).persist();
    await revokeAgent("testnet", MAIN, { vault });
    expect(await loadAgent("testnet", MAIN, { vault })).toBeNull();
  });
});

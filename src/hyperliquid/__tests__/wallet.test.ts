import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent, createMemoryVault, type KeyVault } from "../agentKey.ts";
import { hlSession } from "../session.ts";
import type { HlInfoApi } from "../wallet/clients.ts";
import { humanizeError } from "../wallet/errors.ts";
import {
  BRIDGE_ADDRESS,
  USDC_ADDRESS,
  moveUsdc,
  validateDeposit,
  validateWithdraw,
  withdrawUsdc,
  type FundsExchange,
} from "../wallet/funds.ts";
import type { Eip1193Provider } from "../wallet/providers.ts";
import { resolveSessionStatus } from "../wallet/resolve.ts";
import { enableTrading, type SetupDeps } from "../wallet/setup.ts";

vi.mock("../config.ts", async (orig) => {
  const o = await orig<typeof import("../config.ts")>();
  const E = { VITE_HL_BUILDER_ADDRESS: "0x3333333333333333333333333333333333333333", VITE_HL_BUILDER_FEE: "50" };
  return {
    ...o,
    getBuilderAddress: () => o.getBuilderAddress(E),
    getBuilderFeeTenthsBp: () => o.getBuilderFeeTenthsBp(E),
    getBuilderParam: () => o.getBuilderParam(E),
    getMaxFeeRateString: () => o.getMaxFeeRateString(E),
    builderFeeRate: () => o.builderFeeRate(E),
  };
});

const BUILDER = "0x3333333333333333333333333333333333333333";
const USER = "0x1111111111111111111111111111111111111111" as const;
const provider = { request: vi.fn() } as unknown as Eip1193Provider;

type Agent = { address: `0x${string}`; name: string; validUntil: number | null };

function info(agents: Agent[], fee: number): HlInfoApi {
  return {
    extraAgents: vi.fn().mockResolvedValue(agents),
    maxBuilderFee: vi.fn().mockResolvedValue(fee),
  } as unknown as HlInfoApi;
}

let vault: KeyVault;
beforeEach(() => {
  vault = createMemoryVault();
  hlSession.getState().patch({ network: "testnet", address: USER, agent: null, status: "connecting", error: null, approvedBuilderFee: null });
});

describe("resolveSessionStatus", () => {
  it("needs-agent without a stored agent", async () => {
    const r = await resolveSessionStatus(USER, { info: info([], 0), vault });
    expect(r.status).toBe("needs-agent");
  });
  it("needs-builder-approval when approved fee is below configured", async () => {
    const a = createAgent("testnet", USER, { vault });
    await a.persist();
    const r = await resolveSessionStatus(USER, { info: info([{ address: a.address, name: a.name, validUntil: null }], 10), vault });
    expect(r.status).toBe("needs-builder-approval");
    expect(hlSession.getState().approvedBuilderFee).toBe(10);
  });
  it("ready when agent approved and fee >= configured", async () => {
    const a = createAgent("testnet", USER, { vault });
    await a.persist();
    const r = await resolveSessionStatus(USER, { info: info([{ address: a.address, name: a.name, validUntil: Date.now() + 1e9 }], 50), vault });
    expect(r.status).toBe("ready");
    expect(hlSession.getState().agent?.address).toBe(a.address);
  });
  it("drops to needs-agent when HL no longer lists the agent", async () => {
    const a = createAgent("testnet", USER, { vault });
    await a.persist();
    const r = await resolveSessionStatus(USER, { info: info([], 50), vault });
    expect(r.status).toBe("needs-agent");
    expect(await vault.getAgent(`testnet:${USER}`)).toBeUndefined();
  });
  it("flags rotation inside 7 days", async () => {
    const a = createAgent("testnet", USER, { vault, ttlMs: 2 * 86_400_000 });
    await a.persist();
    const r = await resolveSessionStatus(USER, { info: info([{ address: a.address, name: a.name, validUntil: null }], 50), vault });
    expect(r.rotationDue).toBe(true);
  });
  it("silent re-check keeps status on network failure", async () => {
    hlSession.getState().patch({ status: "ready" });
    const bad = { extraAgents: vi.fn().mockRejectedValue(new Error("Failed to fetch")), maxBuilderFee: vi.fn() } as unknown as HlInfoApi;
    await createAgent("testnet", USER, { vault }).persist();
    const r = await resolveSessionStatus(USER, { info: bad, vault, silent: true });
    expect(r.status).toBe("ready");
  });
});

describe("enableTrading", () => {
  it("does both steps once each with the exact fee, and is resumable", async () => {
    let registered: Agent[] = [];
    let fee = 0;
    const i = {
      extraAgents: vi.fn(() => Promise.resolve(registered)),
      maxBuilderFee: vi.fn(() => Promise.resolve(fee)),
    } as unknown as HlInfoApi;
    const approveAgent = vi.fn((p: { agentAddress: `0x${string}`; agentName: string }) => {
      registered = [{ address: p.agentAddress, name: p.agentName, validUntil: null }];
      return Promise.resolve();
    });
    const approveBuilderFee = vi.fn(() => {
      fee = 50;
      return Promise.resolve();
    });
    const deps: SetupDeps = {
      provider,
      info: i,
      vault,
      ensureChain: () => Promise.resolve("0x66eee" as const),
      exchangeFactory: () => ({ approveAgent, approveBuilderFee }) as unknown as ReturnType<NonNullable<SetupDeps["exchangeFactory"]>>,
    };
    await enableTrading(deps);
    expect(approveAgent).toHaveBeenCalledTimes(1);
    expect(approveAgent.mock.calls[0]?.[0].agentName).toMatch(/^OpenBroker valid_until \d+$/);
    expect(approveBuilderFee).toHaveBeenCalledWith({ builder: BUILDER, maxFeeRate: "0.05%" });
    expect(hlSession.getState().status).toBe("ready");
    await enableTrading(deps);
    expect(approveAgent).toHaveBeenCalledTimes(1);
    expect(approveBuilderFee).toHaveBeenCalledTimes(1);
  });
  it("surfaces user rejection and persists nothing", async () => {
    const deps: SetupDeps = {
      provider,
      info: info([], 0),
      vault,
      ensureChain: () => Promise.resolve("0x66eee" as const),
      exchangeFactory: () =>
        ({
          approveAgent: vi.fn().mockRejectedValue(Object.assign(new Error("denied"), { code: 4001 })),
          approveBuilderFee: vi.fn(),
        }) as unknown as ReturnType<NonNullable<SetupDeps["exchangeFactory"]>>,
    };
    await expect(enableTrading(deps)).rejects.toMatchObject({ rejected: true, step: "agent" });
    expect(await vault.getAgent(`testnet:${USER}`)).toBeUndefined();
  });
});

describe("errors + funds helpers", () => {
  it("humanizes known failures", () => {
    expect(humanizeError({ code: 4001 })).toMatch(/rejected/i);
    expect(humanizeError(new Error("Builder fee approvals limit reached"))).toMatch(/limit/i);
    expect(humanizeError(new Error("Failed to fetch"))).toMatch(/reach/i);
  });
  it("blocks deposits under 5 USDC", () => {
    expect(validateDeposit("4.99").ok).toBe(false);
    expect(validateDeposit("5").ok).toBe(true);
    expect(validateDeposit("abc").ok).toBe(false);
    expect(validateDeposit("10", 5_000_000n).ok).toBe(false);
  });
  it("validates withdraw against fee and balance", () => {
    expect(validateWithdraw("1").ok).toBe(false);
    expect(validateWithdraw("50", 10).ok).toBe(false);
    expect(validateWithdraw("5", 10).ok).toBe(true);
  });
  it("uses documented bridge + USDC addresses", () => {
    expect(BRIDGE_ADDRESS.mainnet).toBe("0x2df1c51e09aecf9cacb7bc98cb1742757f163df7");
    expect(BRIDGE_ADDRESS.testnet).toBe("0x08cfc1b6b2dcf36a1480b99353a354aa8ac56f89");
    expect(USDC_ADDRESS.mainnet).toBe("0xaf88d065e77c8cc2239327c5edb3a432268e5831");
  });
  it("routes transfers: spot<->perp via usdClassTransfer, dex via sendAsset", async () => {
    const ex = { withdraw3: vi.fn(), sendAsset: vi.fn(), usdClassTransfer: vi.fn() };
    const deps = { provider, ensureChain: () => Promise.resolve("0x66eee" as const), exchangeFactory: () => ex as unknown as FundsExchange };
    await moveUsdc("spot", "", "10", deps);
    expect(ex.usdClassTransfer).toHaveBeenCalledWith({ amount: "10", toPerp: true });
    await moveUsdc("", "xyz", "10", deps);
    expect(ex.sendAsset).toHaveBeenCalledWith({ destination: USER, sourceDex: "", destinationDex: "xyz", token: "USDC", amount: "10" });
    await withdrawUsdc("20", 100, deps);
    expect(ex.withdraw3).toHaveBeenCalledWith({ destination: USER, amount: "20" });
  });
});

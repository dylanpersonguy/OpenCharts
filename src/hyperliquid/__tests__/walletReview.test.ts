import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createAgent, createMemoryVault, useAgentVaultStore, type KeyVault } from "../agentKey.ts";
import { hlSession } from "../session.ts";
import { createBrowserSigner, type HlInfoApi } from "../wallet/clients.ts";
import { humanizeError, isUserRejection } from "../wallet/errors.ts";
import {
  USDC_ADDRESS,
  BRIDGE_ADDRESS,
  depositUsdc,
  moveUsdc,
  validateDeposit,
  validateWithdraw,
  withdrawUsdc,
  type FundsExchange,
} from "../wallet/funds.ts";
import type { Eip1193Provider } from "../wallet/providers.ts";
import { resolveSessionStatus } from "../wallet/resolve.ts";
import { approveAgentStep, enableTrading, ensureWalletChain, type SetupDeps } from "../wallet/setup.ts";

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

const USER = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const provider = { request: vi.fn() } as unknown as Eip1193Provider;
const ARB_SEPOLIA = "0x66eee" as const;

let vault: KeyVault;
beforeEach(() => {
  vault = createMemoryVault();
  hlSession.getState().patch({ network: "testnet", address: USER, agent: null, status: "connecting", error: null, approvedBuilderFee: null });
});

describe("amount validation (USDC has 6 decimals)", () => {
  it("rejects more than 6 decimals instead of silently rounding", () => {
    expect(validateDeposit("4.9999999").ok).toBe(false);
    expect(validateDeposit("5.0000001").ok).toBe(false);
    expect(validateWithdraw("5.1234567", 100).ok).toBe(false);
  });
  it("returns exact units and a canonical decimal string", () => {
    const d = validateDeposit("5");
    expect(d.ok && d.units).toBe(5_000_000n);
    const w = validateWithdraw("12.345678", 100);
    expect(w.ok && w.amountStr).toBe("12.345678");
  });
  it("compares the minimum in integer units (4.999999 is rejected)", () => {
    expect(validateDeposit("4.999999").ok).toBe(false);
    expect(validateDeposit("5.000000").ok).toBe(true);
  });
  it("fails closed when the withdrawable balance is not a finite number", () => {
    expect(validateWithdraw("5", Number.NaN).ok).toBe(false);
  });
  it("accepts the withdraw fee boundary only above the fee", () => {
    expect(validateWithdraw("1.000001", 10).ok).toBe(true);
    expect(validateWithdraw("1", 10).ok).toBe(false);
  });
});

describe("depositUsdc", () => {
  const mkWallet = () => ({ writeContract: vi.fn().mockResolvedValue("0xabc" as const) });
  const base = (wallet: ReturnType<typeof mkWallet>, over: Record<string, unknown> = {}) => ({
    provider,
    ensureChain: () => Promise.resolve(ARB_SEPOLIA),
    wallet,
    getCode: () => Promise.resolve("0x" as const),
    balanceOf: () => Promise.resolve(100_000_000n),
    ...over,
  });

  it("transfers exact units of the network USDC to the network bridge", async () => {
    const w = mkWallet();
    await expect(depositUsdc("12.5", base(w))).resolves.toBe("0xabc");
    const arg = w.writeContract.mock.calls[0]?.[0] as { address: string; args: [string, bigint]; functionName: string };
    expect(arg.functionName).toBe("transfer");
    expect(arg.address.toLowerCase()).toBe(USDC_ADDRESS.testnet);
    expect(arg.args[0].toLowerCase()).toBe(BRIDGE_ADDRESS.testnet);
    expect(arg.args[1]).toBe(12_500_000n);
  });
  it("refuses to send when the wallet is not on the Arbitrum chain for this network", async () => {
    const w = mkWallet();
    await expect(depositUsdc("10", base(w, { ensureChain: () => Promise.resolve("0x1" as const) }))).rejects.toThrow(/arbitrum/i);
    expect(w.writeContract).not.toHaveBeenCalled();
  });
  it("refuses smart-contract wallets (credited address would be unusable)", async () => {
    const w = mkWallet();
    await expect(depositUsdc("10", base(w, { getCode: () => Promise.resolve("0x6080604052") }))).rejects.toThrow(/smart.contract/i);
    expect(w.writeContract).not.toHaveBeenCalled();
  });
  it("allows EIP-7702 delegated EOAs", async () => {
    const w = mkWallet();
    await expect(depositUsdc("10", base(w, { getCode: () => Promise.resolve("0xef0100" + "ab".repeat(20)) }))).resolves.toBe("0xabc");
  });
  it("refuses amounts above the on-chain balance", async () => {
    const w = mkWallet();
    await expect(depositUsdc("10", base(w, { balanceOf: () => Promise.resolve(9_999_999n) }))).rejects.toThrow(/balance/i);
    expect(w.writeContract).not.toHaveBeenCalled();
  });
  it("sub-minimum is rejected even when called directly", async () => {
    const w = mkWallet();
    await expect(depositUsdc("4.999999", base(w))).rejects.toThrow(/minimum/i);
    expect(w.writeContract).not.toHaveBeenCalled();
  });
  it("a double click sends exactly one transfer", async () => {
    let release!: (h: `0x${string}`) => void;
    const w = { writeContract: vi.fn(() => new Promise<`0x${string}`>((r) => (release = r))) };
    const deps = base(w as unknown as ReturnType<typeof mkWallet>);
    const a = depositUsdc("10", deps);
    const b = depositUsdc("10", deps);
    await vi.waitFor(() => expect(w.writeContract).toHaveBeenCalled());
    release("0xdead");
    await expect(Promise.all([a, b])).resolves.toEqual(["0xdead", "0xdead"]);
    expect(w.writeContract).toHaveBeenCalledTimes(1);
  });
  it("a different funds action cannot run concurrently", async () => {
    let release!: (h: `0x${string}`) => void;
    const w = { writeContract: vi.fn(() => new Promise<`0x${string}`>((r) => (release = r))) };
    const first = depositUsdc("10", base(w as unknown as ReturnType<typeof mkWallet>));
    const ex = { withdraw3: vi.fn(), sendAsset: vi.fn(), usdClassTransfer: vi.fn() };
    await expect(
      withdrawUsdc("20", 100, { provider, ensureChain: () => Promise.resolve(ARB_SEPOLIA), exchangeFactory: () => ex as unknown as FundsExchange }),
    ).rejects.toThrow(/in progress/i);
    expect(ex.withdraw3).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(w.writeContract).toHaveBeenCalled());
    release("0x1");
    await first;
  });
});

describe("withdraw / transfers", () => {
  const ex = () => ({ withdraw3: vi.fn(), sendAsset: vi.fn(), usdClassTransfer: vi.fn() });
  const deps = (e: ReturnType<typeof ex>) => ({ provider, ensureChain: () => Promise.resolve(ARB_SEPOLIA), exchangeFactory: () => e as unknown as FundsExchange });

  it("sends the decimal string, not a float repr, to the connected address", async () => {
    const e = ex();
    await withdrawUsdc("100000000000000000000000", 1e30, deps(e));
    expect(e.withdraw3).toHaveBeenCalledWith({ destination: USER, amount: "100000000000000000000000" });
  });
  it("does nothing when the amount is invalid or above withdrawable", async () => {
    const e = ex();
    await expect(withdrawUsdc("50", 10, deps(e))).rejects.toThrow();
    expect(e.withdraw3).not.toHaveBeenCalled();
  });
  it("moveUsdc refuses more than the available balance", async () => {
    const e = ex();
    await expect(moveUsdc("", "xyz", "10", { ...deps(e), available: 5 })).rejects.toThrow(/exceeds/i);
    expect(e.sendAsset).not.toHaveBeenCalled();
  });
  it("moveUsdc rejects excess precision and zero", async () => {
    const e = ex();
    await expect(moveUsdc("", "xyz", "1.0000001", deps(e))).rejects.toThrow();
    await expect(moveUsdc("", "xyz", "0", deps(e))).rejects.toThrow();
    expect(e.sendAsset).not.toHaveBeenCalled();
  });
  it("direction: perp -> spot is toPerp=false, spot -> perp is toPerp=true", async () => {
    const e = ex();
    await moveUsdc("", "spot", "3", deps(e));
    expect(e.usdClassTransfer).toHaveBeenLastCalledWith({ amount: "3", toPerp: false });
    await moveUsdc("spot", "", "3", deps(e));
    expect(e.usdClassTransfer).toHaveBeenLastCalledWith({ amount: "3", toPerp: true });
  });
});

describe("errors", () => {
  it("shows the gas message for insufficient ETH, not the HL volume message", () => {
    const m = humanizeError(new Error("Insufficient funds for gas * price + value. The total cost exceeds the balance of the account."));
    expect(m).toMatch(/gas/i);
    expect(m).not.toMatch(/volume/i);
  });
  it("recognises a rejection nested under a wrapper with its own code", () => {
    const inner = Object.assign(new Error("x"), { code: 4001 });
    const outer = Object.assign(new Error("wrapped"), { code: -32603, cause: inner });
    expect(isUserRejection(outer)).toBe(true);
  });
  it("recognises ethers ACTION_REJECTED", () => {
    expect(isUserRejection({ code: "ACTION_REJECTED", message: "user rejected action" })).toBe(true);
  });
  it("explains an ERC-20 balance revert", () => {
    expect(humanizeError(new Error("ERC20: transfer amount exceeds balance"))).toMatch(/usdc/i);
  });
});

describe("ensureWalletChain", () => {
  it("adds the chain when the switch error nests 4902 (MetaMask mobile style)", async () => {
    const calls: string[] = [];
    const p = {
      request: vi.fn(({ method }: { method: string }) => {
        calls.push(method);
        if (method === "eth_chainId") return Promise.resolve("0x1");
        if (method === "wallet_switchEthereumChain") return Promise.reject(Object.assign(new Error("Unrecognized chain"), { code: -32603, data: { originalError: { code: 4902 } } }));
        return Promise.resolve(null);
      }),
    } as unknown as Eip1193Provider;
    await expect(ensureWalletChain(p, "testnet")).resolves.toBe(ARB_SEPOLIA);
    expect(calls).toContain("wallet_addEthereumChain");
  });
  it("a rejected switch is a UserRejectedError", async () => {
    const p = {
      request: vi.fn(({ method }: { method: string }) =>
        method === "eth_chainId" ? Promise.resolve("0x1") : Promise.reject(Object.assign(new Error("no"), { code: 4001 })),
      ),
    } as unknown as Eip1193Provider;
    await expect(ensureWalletChain(p, "testnet")).rejects.toMatchObject({ name: "UserRejectedError" });
  });
});

describe("resolveSessionStatus races", () => {
  const agentList = (a: { address: `0x${string}`; name: string }) => [{ address: a.address, name: a.name, validUntil: null }];

  it("an older in-flight resolve cannot overwrite a newer one", async () => {
    const a = createAgent("testnet", USER, { vault });
    await a.persist();
    let releaseOld!: (n: number) => void;
    const oldInfo = {
      extraAgents: vi.fn().mockResolvedValue(agentList(a)),
      maxBuilderFee: vi.fn(() => new Promise<number>((r) => (releaseOld = r))),
    } as unknown as HlInfoApi;
    const newInfo = { extraAgents: vi.fn().mockResolvedValue(agentList(a)), maxBuilderFee: vi.fn().mockResolvedValue(100) } as unknown as HlInfoApi;
    const older = resolveSessionStatus(USER, { info: oldInfo, vault, silent: true });
    await vi.waitFor(() => expect(releaseOld).toBeTypeOf("function"));
    await resolveSessionStatus(USER, { info: newInfo, vault });
    expect(hlSession.getState().status).toBe("ready");
    releaseOld(0); // stale read from before the approval
    await older;
    expect(hlSession.getState().status).toBe("ready");
    expect(hlSession.getState().approvedBuilderFee).toBe(100);
  });
  it("a failure for an account that was switched away does not poison the new account", async () => {
    let fail!: (e: Error) => void;
    const bad = { extraAgents: vi.fn(), maxBuilderFee: vi.fn(() => new Promise((_, rej) => (fail = rej))) } as unknown as HlInfoApi;
    const a = createAgent("testnet", USER, { vault });
    await a.persist();
    (bad.extraAgents as ReturnType<typeof vi.fn>).mockResolvedValue(agentList(a));
    const p = resolveSessionStatus(USER, { info: bad, vault });
    await vi.waitFor(() => expect(fail).toBeTypeOf("function"));
    hlSession.getState().patch({ address: OTHER, status: "ready", error: null });
    fail(new Error("boom"));
    await p;
    expect(hlSession.getState().status).toBe("ready");
    expect(hlSession.getState().error).toBeNull();
  });
});

describe("setup flow", () => {
  const info = (): HlInfoApi => ({ extraAgents: vi.fn().mockResolvedValue([]), maxBuilderFee: vi.fn().mockResolvedValue(0) }) as unknown as HlInfoApi;

  it("does not attach the new agent to a different account selected during the signature", async () => {
    const approveAgent = vi.fn(() => {
      hlSession.getState().patch({ address: OTHER, agent: null, status: "connecting" });
      return Promise.resolve();
    });
    const deps: SetupDeps = {
      provider,
      info: info(),
      vault,
      ensureChain: () => Promise.resolve(ARB_SEPOLIA),
      exchangeFactory: () => ({ approveAgent, approveBuilderFee: vi.fn() }) as never,
    };
    await approveAgentStep(deps).catch(() => undefined);
    expect(hlSession.getState().agent).toBeNull();
  });
  it("when the key cannot be stored persistently, the session still works and is flagged volatile", async () => {
    const broken: KeyVault = { ...vault, putAgent: () => Promise.reject(new Error("QuotaExceededError")) };
    const deps: SetupDeps = {
      provider,
      vault: broken,
      ensureChain: () => Promise.resolve(ARB_SEPOLIA),
      exchangeFactory: () => ({ approveAgent: vi.fn().mockResolvedValue(undefined), approveBuilderFee: vi.fn() }) as never,
    };
    await approveAgentStep(deps);
    expect(hlSession.getState().agent).not.toBeNull();
    expect(useAgentVaultStore.getState().volatile).toBe(true);
  });
  it("two concurrent enableTrading calls prompt for the agent signature once", async () => {
    let registered: { address: `0x${string}`; name: string; validUntil: number | null }[] = [];
    const i = {
      extraAgents: vi.fn(() => Promise.resolve(registered)),
      maxBuilderFee: vi.fn().mockResolvedValue(0),
    } as unknown as HlInfoApi;
    const approveAgent = vi.fn(async (p: { agentAddress: `0x${string}`; agentName: string }) => {
      await new Promise((r) => setTimeout(r, 20));
      registered = [{ address: p.agentAddress, name: p.agentName, validUntil: null }];
    });
    const deps: SetupDeps = {
      provider,
      info: i,
      vault,
      ensureChain: () => Promise.resolve(ARB_SEPOLIA),
      exchangeFactory: () => ({ approveAgent, approveBuilderFee: vi.fn() }) as never,
    };
    await Promise.all([enableTrading(deps), enableTrading(deps)]);
    expect(approveAgent).toHaveBeenCalledTimes(1);
  });
});

describe("browser signer verifies who signed", () => {
  const types = {
    "HyperliquidTransaction:Withdraw": [
      { name: "hyperliquidChain", type: "string" },
      { name: "destination", type: "string" },
      { name: "amount", type: "string" },
      { name: "time", type: "uint64" },
    ],
  };
  const domain = { name: "HyperliquidSignTransaction", version: "1", chainId: 421614, verifyingContract: "0x0000000000000000000000000000000000000000" };
  const message = { hyperliquidChain: "Testnet", destination: USER, amount: "5", time: 1_700_000_000_000 };
  const eip712Domain = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ];
  const fakeWallet = (key: `0x${string}`): Eip1193Provider => ({
    request: vi.fn(async ({ params }: { params?: unknown[] | Record<string, unknown> }) => {
      const typed = JSON.parse((params as [string, string])[1]) as Parameters<ReturnType<typeof privateKeyToAccount>["signTypedData"]>[0];
      return privateKeyToAccount(key).signTypedData(typed);
    }),
  });

  it("accepts a signature from the expected account and rejects one from another", async () => {
    const mine = privateKeyToAccount(generatePrivateKey());
    const theirs = generatePrivateKey();
    const args = { domain, types: { EIP712Domain: eip712Domain, ...types }, primaryType: "HyperliquidTransaction:Withdraw", message };
    const ok = createBrowserSigner(fakeWallet(generatePrivateKey()), mine.address.toLowerCase() as `0x${string}`);
    await expect(ok.signTypedData(args)).rejects.toThrow(/different account|expected/i);
    const signerKey = generatePrivateKey();
    const addr = privateKeyToAccount(signerKey).address.toLowerCase() as `0x${string}`;
    await expect(createBrowserSigner(fakeWallet(signerKey), addr).signTypedData(args)).resolves.toMatch(/^0x[0-9a-f]{130}$/);
    await expect(createBrowserSigner(fakeWallet(theirs), addr).signTypedData(args)).rejects.toThrow(/different account|expected/i);
  });
});

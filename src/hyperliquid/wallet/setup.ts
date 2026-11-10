import type { ExchangeClient } from "@nktkas/hyperliquid";
import { createAgent, type KeyVault } from "../agentKey.ts";
import {
  getBuilderAddress,
  getBuilderFeeTenthsBp,
  getBuilderParam,
  getMaxFeeRateString,
  type Address,
} from "../config.ts";
import { hlSession } from "../session.ts";
import { createUserExchange, signatureChain, signatureChainIdHex, type HlInfoApi } from "./clients.ts";
import { hasErrorCode, humanizeError, isUserRejection, UserRejectedError } from "./errors.ts";
import type { Eip1193Provider } from "./providers.ts";
import { resolveSessionStatus } from "./resolve.ts";
import { requireProvider } from "./state.ts";

/**
 * Chain handling for user-signed actions (approveAgent / approveBuilderFee / withdraw3 ...).
 *
 * The SDK puts `signatureChainId` into the action AND into the EIP-712 domain
 * (`chainId`). MetaMask-style wallets refuse `eth_signTypedData_v4` when the
 * domain chainId differs from the wallet's active chain. By default the SDK
 * reads the wallet's current chain; we instead pin Arbitrum (0xa4b1 mainnet,
 * 0x66eee Arbitrum Sepolia for testnet, as in HL's docs) and ask the wallet to
 * switch first. If the wallet cannot switch (non-rejection), we fall back to
 * whatever chain it is on, which HL also accepts.
 */
export async function ensureWalletChain(
  provider: Eip1193Provider,
  network: "mainnet" | "testnet",
): Promise<`0x${string}`> {
  const want = signatureChainIdHex(network);
  const current = await provider.request({ method: "eth_chainId" }).catch(() => null);
  if (typeof current === "string" && parseInt(current, 16) === parseInt(want, 16)) return want;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
    return want;
  } catch (e) {
    if (isUserRejection(e)) throw new UserRejectedError("You declined switching networks. Switching to Arbitrum is required to sign.");
    if (hasErrorCode(e, 4902)) {
      const c = signatureChain(network);
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: want,
              chainName: c.name,
              nativeCurrency: c.nativeCurrency,
              rpcUrls: [...c.rpcUrls.default.http],
              blockExplorerUrls: c.blockExplorers ? [c.blockExplorers.default.url] : undefined,
            },
          ],
        });
        return want;
      } catch (e2) {
        if (isUserRejection(e2)) throw new UserRejectedError("You declined adding the Arbitrum network.");
      }
    }
    if (typeof current === "string" && /^0x[0-9a-f]+$/i.test(current)) return current as `0x${string}`;
    throw e;
  }
}

export type SetupStepId = "agent" | "builder";
export type SetupStepState = "idle" | "pending" | "done" | "error" | "skipped";

export interface SetupDeps {
  provider?: Eip1193Provider;
  info?: HlInfoApi;
  vault?: KeyVault;
  exchangeFactory?: (signatureChainId: `0x${string}`) => Pick<ExchangeClient, "approveAgent" | "approveBuilderFee">;
  ensureChain?: (provider: Eip1193Provider, network: "mainnet" | "testnet") => Promise<`0x${string}`>;
  onStep?: (step: SetupStepId, state: SetupStepState, message?: string) => void;
}

export class SetupError extends Error {
  readonly step: SetupStepId;
  readonly rejected: boolean;
  constructor(step: SetupStepId, cause: unknown) {
    super(humanizeError(cause));
    this.name = "SetupError";
    this.step = step;
    this.rejected = isUserRejection(cause);
  }
}

function exchangeFor(deps: SetupDeps, address: Address) {
  const network = hlSession.getState().network;
  return async () => {
    const provider = deps.provider ?? requireProvider();
    const chainId = await (deps.ensureChain ?? ensureWalletChain)(provider, network);
    return deps.exchangeFactory
      ? deps.exchangeFactory(chainId)
      : createUserExchange(provider, address, network, chainId);
  };
}

/** One in-flight signature request per step AND account, so a click on account B never joins A's prompt. */
const inflight = new Map<string, Promise<void>>();
function once(step: SetupStepId, run: () => Promise<void>): Promise<void> {
  const { address, network } = hlSession.getState();
  const key = `${step}:${network}:${address ?? ""}`;
  const cur = inflight.get(key);
  if (cur) return cur;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const sameAccount = (address: Address): boolean => hlSession.getState().address?.toLowerCase() === address.toLowerCase();

/** Step 2: approve a fresh, expiring agent key (ONE wallet signature). */
export function approveAgentStep(deps: SetupDeps = {}): Promise<void> {
  return once("agent", async () => {
    const { address, network } = hlSession.getState();
    if (!address) throw new Error("Connect your wallet first.");
    deps.onStep?.("agent", "pending");
    try {
      const agent = createAgent(network, address, { vault: deps.vault });
      const exchange = await exchangeFor(deps, address)();
      // Same name => HL replaces the previous agent of that name, so renewal never piles up agents.
      await exchange.approveAgent({ agentAddress: agent.address, agentName: agent.name });
      // persist() never throws once HL accepted the agent: it falls back to memory and sets useAgentVaultStore.
      const credential = await agent.persist();
      // The user may have switched wallet accounts while the signature prompt was open.
      if (sameAccount(address)) hlSession.getState().patch({ agent: credential });
      deps.onStep?.("agent", "done");
    } catch (e) {
      const err = new SetupError("agent", e);
      deps.onStep?.("agent", "error", err.message);
      throw err;
    }
  });
}

/** Step 3: approve exactly the builder fee we charge (ONE wallet signature). Skipped without a builder. */
export function approveBuilderStep(deps: SetupDeps = {}): Promise<void> {
  return once("builder", async () => {
    const { address } = hlSession.getState();
    if (!address) throw new Error("Connect your wallet first.");
    const builder = getBuilderAddress();
    if (!getBuilderParam() || !builder) {
      deps.onStep?.("builder", "skipped");
      return;
    }
    deps.onStep?.("builder", "pending");
    try {
      const exchange = await exchangeFor(deps, address)();
      // maxFeeRate is exactly the fee we charge, never higher.
      await exchange.approveBuilderFee({ builder, maxFeeRate: getMaxFeeRateString() });
      deps.onStep?.("builder", "done");
    } catch (e) {
      const err = new SetupError("builder", e);
      deps.onStep?.("builder", "error", err.message);
      throw err;
    }
  });
}

/**
 * One-time setup. Idempotent and resumable: re-resolves status first and only
 * performs the steps that are still missing. `renew` forces a new agent.
 */
const enabling = new Map<string, Promise<void>>();

export function enableTrading(deps: SetupDeps & { renew?: boolean } = {}): Promise<void> {
  const { address, network } = hlSession.getState();
  const key = `enable:${network}:${address ?? ""}`;
  const cur = enabling.get(key);
  if (cur) return cur;
  const p = runEnableTrading(deps).finally(() => enabling.delete(key));
  enabling.set(key, p);
  return p;
}

async function runEnableTrading(deps: SetupDeps & { renew?: boolean }): Promise<void> {
  const { address } = hlSession.getState();
  if (!address) throw new Error("Connect your wallet first.");
  const r = await resolveSessionStatus(address, deps);
  if (r.status === "error") throw new Error(hlSession.getState().error ?? "Could not check your account.");

  if (r.status === "needs-agent" || deps.renew) {
    await approveAgentStep(deps);
  } else {
    deps.onStep?.("agent", "done");
  }

  const fee = getBuilderFeeTenthsBp();
  const approved = hlSession.getState().approvedBuilderFee;
  if (!getBuilderParam()) deps.onStep?.("builder", "skipped");
  else if (approved !== null && approved >= fee) deps.onStep?.("builder", "done");
  else await approveBuilderStep(deps);

  await resolveSessionStatus(address, deps);
}

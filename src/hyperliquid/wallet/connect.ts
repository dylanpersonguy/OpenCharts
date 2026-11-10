import { revokeAgent } from "../agentKey.ts";
import type { Address } from "../config.ts";
import { hlSession } from "../session.ts";
import { humanizeError, isUserRejection, UserRejectedError } from "./errors.ts";
import { discoverWallets, type Eip1193Provider, type Eip6963ProviderDetail } from "./providers.ts";
import { resolveSessionStatus } from "./resolve.ts";
import { getActiveProvider, setActiveProvider, walletUi } from "./state.ts";

const LAST_WALLET_KEY = "openbroker:hl:wallet";
const RECHECK_MS = 5 * 60 * 1000;

let teardown: (() => void) | null = null;

const toAddress = (a: unknown): Address | null =>
  typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a) ? (a.toLowerCase() as Address) : null;

function remember(name: string | null): void {
  try {
    if (name) localStorage.setItem(LAST_WALLET_KEY, name);
    else localStorage.removeItem(LAST_WALLET_KEY);
  } catch {
    /* storage unavailable */
  }
}

async function readChainId(p: Eip1193Provider): Promise<number | null> {
  try {
    const hex = await p.request({ method: "eth_chainId" });
    return typeof hex === "string" ? parseInt(hex, 16) : null;
  } catch {
    return null;
  }
}

function attach(provider: Eip1193Provider): void {
  teardown?.();
  const onAccounts = (accounts: unknown): void => {
    const next = Array.isArray(accounts) ? toAddress(accounts[0]) : null;
    const cur = hlSession.getState().address;
    if (!next) {
      void disconnectWallet({ forgetAgent: false });
    } else if (next !== cur) {
      // Different account: drop the old agent from the session and re-resolve for the new one.
      hlSession.getState().patch({ address: next, agent: null, status: "connecting", error: null, approvedBuilderFee: null });
      void resolveSessionStatus(next);
    }
  };
  const onChain = (hex: unknown): void => {
    walletUi.getState().patch({ chainId: typeof hex === "string" ? parseInt(hex, 16) : null });
  };
  const recheck = (): void => {
    const a = hlSession.getState().address;
    if (a && document.visibilityState !== "hidden") void resolveSessionStatus(a, { silent: true });
  };
  provider.on?.("accountsChanged", onAccounts as never);
  provider.on?.("chainChanged", onChain as never);
  window.addEventListener("focus", recheck);
  document.addEventListener("visibilitychange", recheck);
  const timer = setInterval(recheck, RECHECK_MS);
  teardown = () => {
    provider.removeListener?.("accountsChanged", onAccounts as never);
    provider.removeListener?.("chainChanged", onChain as never);
    window.removeEventListener("focus", recheck);
    document.removeEventListener("visibilitychange", recheck);
    clearInterval(timer);
    teardown = null;
  };
}

async function activate(detail: Eip6963ProviderDetail, accounts: unknown): Promise<Address> {
  const address = Array.isArray(accounts) ? toAddress(accounts[0]) : null;
  if (!address) throw new Error("Your wallet did not return an account.");
  setActiveProvider(detail.provider);
  attach(detail.provider);
  walletUi.getState().patch({ providerName: detail.info.name, chainId: await readChainId(detail.provider) });
  hlSession.getState().patch({ address, agent: null, status: "connecting", error: null, approvedBuilderFee: null });
  remember(detail.info.name);
  await resolveSessionStatus(address);
  return address;
}

/**
 * Connect a wallet (prompts the user). With no argument, uses the first
 * EIP-6963 wallet or `window.ethereum`. Use `discoverWallets()` to let users pick.
 */
export function connectWallet(detail?: Eip6963ProviderDetail): Promise<Address> {
  // A second click while the wallet prompt is open must not fire a second eth_requestAccounts (-32002).
  connecting ??= doConnect(detail).finally(() => {
    connecting = null;
  });
  return connecting;
}

let connecting: Promise<Address> | null = null;

async function doConnect(detail?: Eip6963ProviderDetail): Promise<Address> {
  const chosen = detail ?? (await discoverWallets())[0];
  if (!chosen) {
    const msg = "No browser wallet found. Install MetaMask, Rabby or another EIP-1193 wallet.";
    hlSession.getState().patch({ status: "error", error: msg });
    throw new Error(msg);
  }
  hlSession.getState().patch({ status: "connecting", error: null });
  try {
    const accounts = await chosen.provider.request({ method: "eth_requestAccounts" });
    return await activate(chosen, accounts);
  } catch (e) {
    const rejected = isUserRejection(e);
    hlSession.getState().patch({
      status: rejected ? "disconnected" : "error",
      error: rejected ? null : humanizeError(e),
    });
    if (rejected) throw new UserRejectedError();
    throw e;
  }
}

/** Silent reconnect on page load (eth_accounts never prompts). No-op if the wallet is locked or never connected. */
export async function restoreWallet(): Promise<Address | null> {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_WALLET_KEY);
  } catch {
    return null;
  }
  if (!last) return null;
  const wallets = await discoverWallets();
  // Only the wallet the user connected last time: never silently attach a different wallet.
  const detail = wallets.find((w) => w.info.name === last);
  if (!detail) return null;
  // The user may have connected (or started to) while we were discovering; do not clobber that.
  if (connecting || hlSession.getState().address) return null;
  try {
    const accounts = await detail.provider.request({ method: "eth_accounts" });
    if (!Array.isArray(accounts) || accounts.length === 0) return null;
    return await activate(detail, accounts);
  } catch {
    return null;
  }
}

/**
 * Explicit disconnect. Wipes the locally stored agent key by default (the
 * on-chain approval stays until it expires or is replaced; reconnecting will
 * approve a fresh agent). Pass `forgetAgent:false` to keep it (e.g. locked wallet).
 */
export async function disconnectWallet(opts: { forgetAgent?: boolean } = {}): Promise<void> {
  const { address, network } = hlSession.getState();
  teardown?.();
  setActiveProvider(null);
  remember(null);
  // Drop the live session first so nothing can trade with the agent while the key is being wiped.
  hlSession.getState().patch({ address: null, agent: null, status: "disconnected", error: null, approvedBuilderFee: null });
  walletUi.getState().patch({ providerName: null, chainId: null, rotationDue: false });
  if (address && opts.forgetAgent !== false) await revokeAgent(network, address).catch(() => undefined);
}

export const isWalletConnected = (): boolean => getActiveProvider() !== null && hlSession.getState().address !== null;

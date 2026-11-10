import type { ExchangeClient } from "@nktkas/hyperliquid";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, parseUnits, type PublicClient } from "viem";
import { hlSession } from "../session.ts";
import type { Address, HlNetwork } from "../config.ts";
import { createInfoApi, createUserExchange, createWalletClientFor, signatureChain, type HlInfoApi } from "./clients.ts";
import { ensureWalletChain } from "./setup.ts";
import type { Eip1193Provider } from "./providers.ts";
import { requireProvider } from "./state.ts";

/**
 * Deposit / withdraw / transfer helpers.
 *
 * Sources (HL docs, "Bridge2" page, https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/bridge2):
 *  - Mainnet Bridge2 (Arbitrum One): 0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7
 *  - Testnet Bridge2 (Arbitrum Sepolia): 0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89
 *  - Native USDC: Arbitrum One 0xaf88d065e77c8cC2239327C5EDb3A432268e5831,
 *    Arbitrum Sepolia 0x1baAbB04529D43a73232B713C0FE471f7c7334d5
 *  - "The minimum deposit amount is 5 USDC"; smaller deposits are not credited and are lost.
 *  - Deposit = a plain USDC `transfer` to the bridge; it is credited to the sending address (<1 min).
 */
export const BRIDGE_ADDRESS: Record<HlNetwork, Address> = {
  mainnet: "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7",
  testnet: "0x08cfc1b6b2dcf36a1480b99353a354aa8ac56f89",
};
export const USDC_ADDRESS: Record<HlNetwork, Address> = {
  mainnet: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  testnet: "0x1baabb04529d43a73232b713c0fe471f7c7334d5",
};
export const USDC_DECIMALS = 6;
export const MIN_DEPOSIT_USDC = 5;
/** HL charges a flat 1 USDC fee on withdrawals (HL docs; verify on testnet). */
export const WITHDRAW_FEE_USDC = 1;

export type AmountCheck =
  | {
      ok: true;
      units: bigint;
      value: number;
      /** Canonical decimal string (exact, never exponent notation). */
      amountStr: string;
    }
  | { ok: false; error: string };

const MIN_DEPOSIT_UNITS = BigInt(MIN_DEPOSIT_USDC) * 10n ** BigInt(USDC_DECIMALS);
const WITHDRAW_FEE_UNITS = BigInt(WITHDRAW_FEE_USDC) * 10n ** BigInt(USDC_DECIMALS);

function parseAmount(raw: string): AmountCheck | { ok: "empty" } {
  const t = raw.trim();
  if (t === "") return { ok: "empty" };
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return { ok: false, error: "Enter a valid number." };
  // parseUnits ROUNDS extra decimals, which would send a different amount than the one typed.
  const decimals = t.split(".")[1]?.length ?? 0;
  if (decimals > USDC_DECIMALS) return { ok: false, error: `USDC supports at most ${USDC_DECIMALS} decimal places.` };
  try {
    const units = parseUnits(t, USDC_DECIMALS);
    const amountStr = formatUnits(units, USDC_DECIMALS);
    return { ok: true, units, value: Number(amountStr), amountStr };
  } catch {
    return { ok: false, error: "Enter a valid number." };
  }
}

/**
 * Funds actions are single-flight: a double click must never produce a second wallet
 * prompt / transfer. The same action in flight returns the same promise.
 */
const inflight = new Map<string, Promise<unknown>>();
function singleFlight<T>(kind: string, run: () => Promise<T>): Promise<T> {
  const same = inflight.get(kind);
  if (same) return same as Promise<T>;
  if (inflight.size > 0) return Promise.reject(new Error("Another funds action is already in progress. Wait for it to finish."));
  const p = run().finally(() => inflight.delete(kind));
  inflight.set(kind, p);
  return p;
}

/** Generic positive USDC amount check (internal transfers). */
export function validateAmountOnly(raw: string): AmountCheck {
  const p = parseAmount(raw);
  if (p.ok === "empty") return { ok: false, error: "Enter an amount." };
  if (!p.ok) return p;
  if (p.units <= 0n) return { ok: false, error: "Enter an amount above zero." };
  return p;
}

/** Client-side guard: below 5 USDC the deposit is LOST, so we hard-block it. */
export function validateDeposit(raw: string, balanceUnits?: bigint): AmountCheck {
  const p = parseAmount(raw);
  if (p.ok === "empty") return { ok: false, error: "Enter an amount." };
  if (!p.ok) return p;
  if (p.units < MIN_DEPOSIT_UNITS)
    return { ok: false, error: `Minimum deposit is ${MIN_DEPOSIT_USDC} USDC. Smaller deposits are NOT credited and are lost.` };
  if (balanceUnits !== undefined && p.units > balanceUnits) return { ok: false, error: "Amount exceeds your USDC balance." };
  return p;
}

export function validateWithdraw(raw: string, withdrawable?: number): AmountCheck {
  const p = parseAmount(raw);
  if (p.ok === "empty") return { ok: false, error: "Enter an amount." };
  if (!p.ok) return p;
  if (p.units <= WITHDRAW_FEE_UNITS) return { ok: false, error: `Amount must be more than the ${WITHDRAW_FEE_USDC} USDC withdrawal fee.` };
  // Written so NaN fails closed.
  if (withdrawable !== undefined && !(p.value <= withdrawable)) return { ok: false, error: "Amount exceeds your withdrawable balance." };
  return p;
}

export function createArbitrumPublicClient(network: HlNetwork): PublicClient {
  return createPublicClient({ chain: signatureChain(network), transport: http() }) as PublicClient;
}

/** Wallet's native USDC balance on Arbitrum (units of 1e-6). */
export async function getArbitrumUsdcBalance(
  address: Address,
  network: HlNetwork = hlSession.getState().network,
  client: Pick<PublicClient, "readContract"> = createArbitrumPublicClient(network),
): Promise<bigint> {
  return client.readContract({
    address: getAddress(USDC_ADDRESS[network]),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

export interface DepositDeps {
  provider?: Eip1193Provider;
  ensureChain?: typeof ensureWalletChain;
  wallet?: { writeContract: (a: never) => Promise<`0x${string}`> };
  /** Contract code at the sender (default: eth_getCode through the wallet). */
  getCode?: (address: Address) => Promise<string>;
  /** On-chain USDC balance of the sender (default: public Arbitrum RPC). */
  balanceOf?: (address: Address) => Promise<bigint>;
}

/** EOAs have no code; EIP-7702 delegated EOAs have `0xef0100 || address`. Anything else is a contract. */
const isContractCode = (code: string): boolean => code !== "0x" && code !== "" && !/^0xef0100/i.test(code);

/**
 * Send USDC to Bridge2. One wallet prompt (plus a chain switch if needed). Returns the tx hash.
 * Guards, in order: valid amount (>= 5 USDC, <= 6 decimals), wallet really on Arbitrum for this
 * network, sender is not a smart-contract wallet, balance covers the amount. Single-flight.
 */
export function depositUsdc(rawAmount: string, deps: DepositDeps = {}): Promise<`0x${string}`> {
  return singleFlight("deposit", async () => {
    const { address, network } = hlSession.getState();
    if (!address) throw new Error("Connect your wallet first.");
    const check = validateDeposit(rawAmount);
    if (!check.ok) throw new Error(check.error);
    const provider = deps.provider ?? requireProvider();
    const chainId = await (deps.ensureChain ?? ensureWalletChain)(provider, network);
    // ensureWalletChain may fall back to the wallet's current chain for SIGNING; a token transfer must be on Arbitrum.
    if (parseInt(chainId, 16) !== signatureChain(network).id)
      throw new Error(`Switch your wallet to ${signatureChain(network).name} to deposit, then try again.`);
    const code = await (deps.getCode
      ? deps.getCode(address)
      : provider.request({ method: "eth_getCode", params: [address, "latest"] }).then((c) => (typeof c === "string" ? c : "0x")));
    if (isContractCode(code))
      throw new Error(
        "Smart-contract wallets cannot deposit here: the funds would be credited to a contract address you may not be able to sign for. Use a regular wallet address.",
      );
    const balance = await (deps.balanceOf ? deps.balanceOf(address) : getArbitrumUsdcBalance(address, network)).catch(() => null);
    if (balance !== null && check.units > balance) throw new Error("Amount exceeds your USDC balance.");
    const wallet = deps.wallet ?? createWalletClientFor(provider, address, network);
    const args = {
      address: getAddress(USDC_ADDRESS[network]),
      abi: erc20Abi,
      functionName: "transfer",
      args: [getAddress(BRIDGE_ADDRESS[network]), check.units],
      account: address,
      chain: signatureChain(network),
    };
    return (wallet as { writeContract: (a: typeof args) => Promise<`0x${string}`> }).writeContract(args);
  });
}

// ---------------------------------------------------------------------------
// Account summary
// ---------------------------------------------------------------------------

export interface AccountSummary {
  /** Perp account value (equity) in USD for the core dex. */
  equity: number;
  /** Free margin = withdrawable. */
  freeMargin: number;
  marginUsed: number;
  /** USDC held in the spot balance (relevant for unified accounts). */
  spotUsdc: number;
  abstraction: "unifiedAccount" | "portfolioMargin" | "disabled" | "default" | "unknown";
}

export async function getAccountSummary(
  address: Address,
  info: Pick<HlInfoApi, "clearinghouseState" | "spotClearinghouseState" | "userAbstraction"> = createInfoApi(
    hlSession.getState().network,
  ),
): Promise<AccountSummary> {
  const [perp, spot, abstraction] = await Promise.all([
    info.clearinghouseState({ user: address }),
    info.spotClearinghouseState({ user: address }),
    info.userAbstraction({ user: address }).catch(() => "unknown" as const),
  ]);
  const usdc = spot.balances.find((b) => b.coin === "USDC");
  return {
    equity: Number(perp.marginSummary.accountValue),
    freeMargin: Number(perp.withdrawable),
    marginUsed: Number(perp.marginSummary.totalMarginUsed),
    spotUsdc: usdc ? Number(usdc.total) - Number(usdc.hold) : 0,
    abstraction,
  };
}

// ---------------------------------------------------------------------------
// Withdraw + internal transfers (user-signed by the MAIN wallet)
// ---------------------------------------------------------------------------

export type FundsExchange = Pick<ExchangeClient, "withdraw3" | "sendAsset" | "usdClassTransfer">;

export interface FundsDeps {
  provider?: Eip1193Provider;
  ensureChain?: typeof ensureWalletChain;
  exchangeFactory?: (chainId: `0x${string}`) => FundsExchange;
}

async function exchange(deps: FundsDeps): Promise<{ ex: FundsExchange; address: Address }> {
  const { address, network } = hlSession.getState();
  if (!address) throw new Error("Connect your wallet first.");
  const provider = deps.provider ?? requireProvider();
  const chainId = await (deps.ensureChain ?? ensureWalletChain)(provider, network);
  return { ex: deps.exchangeFactory ? deps.exchangeFactory(chainId) : createUserExchange(provider, address, network, chainId), address };
}

/** Withdraw USDC to the user's own Arbitrum address (HL charges a flat fee; arrives in minutes). */
export function withdrawUsdc(rawAmount: string, withdrawable: number, deps: FundsDeps = {}): Promise<void> {
  return singleFlight("withdraw", async () => {
    const check = validateWithdraw(rawAmount, withdrawable);
    if (!check.ok) throw new Error(check.error);
    const { ex, address } = await exchange(deps);
    await ex.withdraw3({ destination: address, amount: check.amountStr });
  });
}

/**
 * Move USDC between "spot", the core perp dex ("") and a HIP-3 dex (e.g. "xyz").
 *
 * Why this exists: on a non-unified account a deposit lands in the core perp
 * balance, and a HIP-3 dex keeps its OWN margin balance (collateral token per
 * dex: see `collateralToken` in meta). Funds must be moved to that dex before
 * trading there. Unified/portfolio-margin accounts draw spot USDC automatically.
 *
 * `available` (USDC) is the caller's known balance of the SOURCE; moving more is refused.
 */
export function moveUsdc(
  from: string,
  to: string,
  rawAmount: string,
  deps: FundsDeps & { available?: number } = {},
): Promise<void> {
  return singleFlight("move", async () => {
    const p = parseAmount(rawAmount);
    if (p.ok === "empty") throw new Error("Enter an amount.");
    if (!p.ok) throw new Error(p.error);
    if (p.units <= 0n) throw new Error("Enter an amount above zero.");
    if (from === to) throw new Error("Choose two different accounts.");
    if (deps.available !== undefined && !(p.value <= deps.available)) throw new Error("Amount exceeds the balance you are moving from.");
    const { ex, address } = await exchange(deps);
    const simple = (d: string) => d === "" || d === "spot";
    if (simple(from) && simple(to)) {
      await ex.usdClassTransfer({ amount: p.amountStr, toPerp: to === "" });
    } else {
      await ex.sendAsset({ destination: address, sourceDex: from, destinationDex: to, token: "USDC", amount: p.amountStr });
    }
  });
}

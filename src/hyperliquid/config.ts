/**
 * Network, builder-code and fee configuration for the Hyperliquid broker.
 * Everything environment-specific lives here; no other module reads import.meta.env
 * for Hyperliquid settings.
 */

export type HlNetwork = "mainnet" | "testnet";
export type Address = `0x${string}`;

export interface HlEndpoints {
  rest: string;
  ws: string;
  /** Value of `hyperliquidChain` in user-signed actions. */
  chain: "Mainnet" | "Testnet";
}

export const HL_ENDPOINTS: Record<HlNetwork, HlEndpoints> = {
  mainnet: { rest: "https://api.hyperliquid.xyz", ws: "wss://api.hyperliquid.xyz/ws", chain: "Mainnet" },
  testnet: {
    rest: "https://api.hyperliquid-testnet.xyz",
    ws: "wss://api.hyperliquid-testnet.xyz/ws",
    chain: "Testnet",
  },
};

/** Hyperliquid's hard cap for perps builder fees: 0.1% = 100 tenths of a basis point. */
export const MAX_PERP_BUILDER_FEE_TENTHS_BP = 100;

type Env = Record<string, string | undefined>;
const env = (): Env => ((import.meta as unknown as { env?: Env }).env ?? {}) as Env;

export function getNetwork(e: Env = env()): HlNetwork {
  return e.VITE_HL_NETWORK === "testnet" ? "testnet" : "mainnet";
}

export function getEndpoints(network: HlNetwork = getNetwork()): HlEndpoints {
  return HL_ENDPOINTS[network];
}

export interface BuilderParam {
  /** Builder (our) address, lowercase hex. */
  b: Address;
  /** Fee in tenths of a basis point (100 = 0.1%). Sent on every order. */
  f: number;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Parse + clamp a fee value. Invalid / negative -> 0, above the perps cap -> the cap. */
export function clampBuilderFee(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), MAX_PERP_BUILDER_FEE_TENTHS_BP);
}

/** Runtime override, used by the remote kill switch (see feeConfig.ts). */
let override: { enabled?: boolean; feeTenthsBp?: number } = {};
export function setBuilderOverride(next: { enabled?: boolean; feeTenthsBp?: number }): void {
  override = { ...next };
}

export function getBuilderAddress(e: Env = env()): Address | undefined {
  const a = e.VITE_HL_BUILDER_ADDRESS?.trim();
  return a && ADDRESS_RE.test(a) ? (a.toLowerCase() as Address) : undefined;
}

/** Configured fee in tenths of a bp (default 100 = 0.1%), after the runtime override. */
export function getBuilderFeeTenthsBp(e: Env = env()): number {
  const configured =
    e.VITE_HL_BUILDER_FEE === undefined
      ? MAX_PERP_BUILDER_FEE_TENTHS_BP
      : clampBuilderFee(e.VITE_HL_BUILDER_FEE);
  return clampBuilderFee(override.feeTenthsBp ?? configured);
}

/**
 * The `builder` object attached to every order action, or undefined when no
 * builder address is configured, the fee is 0, or the kill switch is off.
 */
export function getBuilderParam(e: Env = env()): BuilderParam | undefined {
  if (override.enabled === false) return undefined;
  const b = getBuilderAddress(e);
  const f = getBuilderFeeTenthsBp(e);
  return b && f > 0 ? { b, f } : undefined;
}

/**
 * The `maxFeeRate` string for `approveBuilderFee`, e.g. "0.1%". We ask users to
 * approve exactly the fee we charge (never more), so the disclosure is honest.
 */
export function getMaxFeeRateString(e: Env = env()): string {
  const pct = getBuilderFeeTenthsBp(e) / 1000; // tenths of bp -> percent
  return `${pct}%`;
}

/** Builder fee as a fraction of notional per side (0.001 = 0.1%). */
export function builderFeeRate(e: Env = env()): number {
  return getBuilderParam(e) ? getBuilderFeeTenthsBp(e) / 100_000 : 0;
}

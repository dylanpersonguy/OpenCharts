import { create } from "zustand";
import type { LocalAccount } from "viem";
import type { Address, HlNetwork } from "./config.ts";
import { getNetwork } from "./config.ts";

/**
 * The wallet/agent/approval session. Plain zustand store so BOTH React UI and
 * non-React code (the trading gateway) can read it:
 *   hlSession.getState().agent  /  useHlSession(s => s.status)
 *
 * Owned by the wallet/onboarding module. The trading gateway only READS
 * `address`, `agent`, `network`, and calls `requireReady()`.
 */

/** A viem local account holding the agent (API wallet) private key. */
export interface AgentCredential {
  address: Address;
  /** viem LocalAccount (privateKeyToAccount), passed to the SDK as `wallet`. */
  account: LocalAccount;
  /** Unix ms when the agent approval expires (HL allows up to 180 days). */
  validUntil: number;
}

export type SessionStatus =
  | "disconnected" // no wallet
  | "connecting"
  | "needs-agent" // wallet connected, no usable agent key approved
  | "needs-builder-approval" // agent ok, builder fee not approved (or approved < our fee)
  | "ready" // can trade
  | "error";

export interface HlSessionState {
  network: HlNetwork;
  /** The user's MAIN wallet address (what HL calls "user"). Never the agent address. */
  address: Address | null;
  agent: AgentCredential | null;
  status: SessionStatus;
  error: string | null;
  /** Approved max builder fee for our builder, tenths of bp (from `maxBuilderFee`). */
  approvedBuilderFee: number | null;
  patch(p: Partial<Omit<HlSessionState, "patch" | "requireReady">>): void;
  /** Throws a human-readable Error unless status === "ready". */
  requireReady(): { address: Address; agent: AgentCredential };
}

export const hlSession = create<HlSessionState>((set, get) => ({
  network: getNetwork(),
  address: null,
  agent: null,
  status: "disconnected",
  error: null,
  approvedBuilderFee: null,
  patch: (p) => set(p),
  requireReady() {
    const { status, address, agent } = get();
    if (status !== "ready" || !address || !agent) {
      throw new Error(
        status === "disconnected" || status === "connecting"
          ? "Connect your wallet to trade."
          : "Finish account setup (enable trading and approve the fee) before placing orders.",
      );
    }
    return { address, agent };
  },
}));

/** React hook alias: `useHlSession((s) => s.status)`. */
export const useHlSession = hlSession;

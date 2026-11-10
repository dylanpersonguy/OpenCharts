import { create } from "zustand";
import type { Eip1193Provider } from "./providers.ts";

/**
 * Wallet-side state that is not part of the trading session contract
 * (hlSession): which provider is active, its chain, and renewal hints.
 */
export interface WalletUiState {
  providerName: string | null;
  chainId: number | null;
  /** The approved agent is inside its rotation window (<7 days) - offer a renewal. */
  rotationDue: boolean;
  patch(p: Partial<Omit<WalletUiState, "patch">>): void;
}

export const walletUi = create<WalletUiState>((set) => ({
  providerName: null,
  chainId: null,
  rotationDue: false,
  patch: (p) => set(p),
}));

let activeProvider: Eip1193Provider | null = null;
export const getActiveProvider = (): Eip1193Provider | null => activeProvider;
export const setActiveProvider = (p: Eip1193Provider | null): void => {
  activeProvider = p;
};

export function requireProvider(): Eip1193Provider {
  if (!activeProvider) throw new Error("Connect your wallet first.");
  return activeProvider;
}

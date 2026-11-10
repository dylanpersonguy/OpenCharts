import { create } from "zustand";

/**
 * Cross-component UI intents for the Hyperliquid experience: which dialog is
 * open and why. Kept in a store (not component state) so the order ticket, the
 * adapter (builder-fee errors) and the top bar can all ask for the same dialog.
 */

export type SetupReason = "trade" | "fee-changed";

export interface HlUiState {
  setupOpen: boolean;
  setupReason: SetupReason | null;
  depositOpen: boolean;
  openSetup(reason?: SetupReason): void;
  closeSetup(): void;
  openDeposit(): void;
  closeDeposit(): void;
}

export const useHlUi = create<HlUiState>((set) => ({
  setupOpen: false,
  setupReason: null,
  depositOpen: false,
  openSetup: (reason = "trade") => set({ setupOpen: true, setupReason: reason }),
  closeSetup: () => set({ setupOpen: false, setupReason: null }),
  openDeposit: () => set({ depositOpen: true }),
  closeDeposit: () => set({ depositOpen: false }),
}));

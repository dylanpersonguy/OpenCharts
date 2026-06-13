import { useTradingStore } from "../services/store.tsx";

type InstrumentType = "FOREX" | "FUTURES" | "CRYPTO" | "EQUITIES";

/**
 * Returns display labels and formatters that adapt to the current account's
 * instrument type. Futures accounts show "contracts" instead of "lots", and
 * quantity is formatted as an integer.
 *
 * Subscribes only to the active account's instrumentType — NOT the entire
 * accounts array — so it does not re-render on every equity/balance tick.
 */
export function useInstrumentLabels() {
  // Derive instrumentType with a narrow selector to avoid re-renders on tick updates.
  // The full accounts array is replaced on every WebSocket equity event; subscribing
  // to it directly would cause all callers to re-render on every price tick.
  const instrumentType = useTradingStore((s): InstrumentType => {
    const active = s.accounts.find((a) => a.id === s.activeAccountId);
    return (active?.template?.instrumentType as InstrumentType) ?? "FOREX";
  });
  const isFutures = instrumentType === "FUTURES";

  return {
    instrumentType,
    isFutures,
    /** "lots" for forex/crypto, "contracts" for futures, "shares" for equities */
    unitLabel: isFutures ? "contracts" : instrumentType === "EQUITIES" ? "shares" : "lots",
    /** Capitalised version for use at sentence start */
    unitLabelCap: isFutures ? "Contracts" : instrumentType === "EQUITIES" ? "Shares" : "Lots",
    /**
     * Format a quantity with its unit label.
     * Futures quantities are shown as integers; forex as decimals.
     */
    formatQty: (qty: number) =>
      isFutures
        ? `${Math.round(qty)} contracts`
        : instrumentType === "EQUITIES"
          ? `${Math.round(qty)} shares`
          : `${qty.toFixed(2)} lots`,
  };
}

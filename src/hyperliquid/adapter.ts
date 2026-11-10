import type { OpenChartsAdapter, StorageDriver } from "../adapter/types.ts";
import { safeStorage } from "../lib/safe-storage.ts";
import { isAddressBlocked } from "./compliance/screen.ts";
import { isBuilderFeeApprovalError } from "./feeConfig.ts";
import { isBuilderFeeUnapprovedError } from "./orders.ts";
import { hlSession } from "./session.ts";
import { createHyperliquidMarketData, type HyperliquidMarketDataOptions } from "./marketData.ts";
import { createHyperliquidTrading, type HyperliquidTradingOptions, type HyperliquidTrading } from "./trading.ts";
import { HYPERLIQUID_ADAPTER_NAME } from "./ui/mode.ts";
import { useHlUi } from "./ui/uiStore.ts";

/**
 * The Hyperliquid broker adapter: market data + trading + account-scoped storage.
 *
 * ```tsx
 * <OpenChartsProvider adapter={createHyperliquidAdapter()}>
 *   <Terminal />
 * </OpenChartsProvider>
 * ```
 *
 * Trading only works once a wallet is connected and set up (see the onboarding
 * components); until then reads return empty and orders fail with a clear message.
 */

export interface HyperliquidAdapterOptions {
  marketData?: HyperliquidMarketDataOptions;
  /** Passed to `createHyperliquidTrading`; `registry` is supplied for you. */
  trading?: Omit<HyperliquidTradingOptions, "registry">;
  /** Override the backing store (tests). Defaults to localStorage via safe-storage. */
  store?: Pick<typeof safeStorage, "getItem" | "setItem" | "removeItem">;
  /**
   * Market data only: no trading gateway is created (no wallet, session watcher
   * or signing code is touched). The terminal then renders read-only.
   */
  marketDataOnly?: boolean;
  /** Reads the current account scope. Defaults to the connected wallet address. */
  getScope?: () => string | null;
}

const PREFIX = "hl";

/**
 * Chart state (drawings, templates, journal) follows the connected account:
 * keys are namespaced by wallet address, with an "anon" bucket while
 * disconnected so signed-out drawings are not lost nor leaked to an account.
 */
export function createAccountStorage(
  opts: Pick<HyperliquidAdapterOptions, "store" | "getScope"> = {},
): StorageDriver {
  const store = opts.store ?? safeStorage;
  const scope = opts.getScope ?? (() => hlSession.getState().address);
  const k = (key: string): string => `${PREFIX}:${(scope() ?? "anon").toLowerCase()}:${key}`;
  return {
    get: (key) => store.getItem(k(key)),
    set: (key, value) => {
      store.setItem(k(key), value);
    },
    remove: (key) => {
      store.removeItem(k(key));
    },
  };
}

/**
 * The builder fee can be raised remotely (see feeConfig.ts) beyond what a user
 * approved, and Hyperliquid then rejects their orders. Route the user to
 * re-approval from ANY order path (ticket, chart, watchlist) instead of leaving
 * a dead-end toast. The original error is rethrown unchanged.
 */
export function guardBuilderFeeErrors(trading: Pick<HyperliquidTrading, "placeOrder">): void {
  const placeOrder = trading.placeOrder.bind(trading);
  trading.placeOrder = async (input) => {
    try {
      return await placeOrder(input);
    } catch (err) {
      // Stable error code first (the message is humanized by then); raw-text match as a fallback.
      if (isBuilderFeeUnapprovedError(err) || isBuilderFeeApprovalError(err)) {
        hlSession.getState().patch({ status: "needs-builder-approval" });
        useHlUi.getState().openSetup("fee-changed");
      }
      throw err;
    }
  };
}

/** Shown when the connected wallet was refused by address screening. */
export const BLOCKED_ADDRESS_MESSAGE =
  "Trading is not available for this wallet address. If you believe this is a mistake, contact support.";

/**
 * Refuse to submit or modify orders for a wallet that address screening
 * rejected. Advisory (client-side) but it closes the gap between the UI gate
 * and any order path (ticket, chart, watchlist, API users of the adapter).
 */
export function guardBlockedAddress(
  trading: Pick<HyperliquidTrading, "placeOrder" | "modifyOrder">,
  getAddress: () => string | null = () => hlSession.getState().address,
): void {
  const placeOrder = trading.placeOrder.bind(trading);
  const modifyOrder = trading.modifyOrder.bind(trading);
  trading.placeOrder = (input) =>
    isAddressBlocked(getAddress()) ? Promise.reject(new Error(BLOCKED_ADDRESS_MESSAGE)) : placeOrder(input);
  trading.modifyOrder = (id, mod) =>
    isAddressBlocked(getAddress()) ? Promise.reject(new Error(BLOCKED_ADDRESS_MESSAGE)) : modifyOrder(id, mod);
}

export type HyperliquidAdapter = OpenChartsAdapter & { trading: HyperliquidTrading };
export type HyperliquidMarketDataAdapter = Omit<OpenChartsAdapter, "trading">;

export function createHyperliquidAdapter(
  opts: HyperliquidAdapterOptions & { marketDataOnly: true },
): HyperliquidMarketDataAdapter;
export function createHyperliquidAdapter(opts?: HyperliquidAdapterOptions): HyperliquidAdapter;
export function createHyperliquidAdapter(
  opts: HyperliquidAdapterOptions = {},
): HyperliquidAdapter | HyperliquidMarketDataAdapter {
  const md = createHyperliquidMarketData(opts.marketData);
  const storage = createAccountStorage(opts);

  if (opts.marketDataOnly) {
    return { name: HYPERLIQUID_ADAPTER_NAME, marketData: md, storage };
  }

  const trading = createHyperliquidTrading({ ...opts.trading, registry: md.registry });
  guardBuilderFeeErrors(trading);
  guardBlockedAddress(trading);

  const marketData: OpenChartsAdapter["marketData"] = {
    ...md,
    disconnect: () => {
      md.disconnect?.();
      // Safe to dispose here: subscribers have detached by now, and a later
      // subscribe() re-creates the session watcher.
      trading.dispose();
    },
  };

  return { name: HYPERLIQUID_ADAPTER_NAME, marketData, trading, storage };
}

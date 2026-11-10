import {
  ExchangeClient,
  HttpTransport,
  InfoClient,
  SubscriptionClient,
  WebSocketTransport,
  type AllDexsClearinghouseStateWsEvent,
  type OrderUpdatesWsEvent,
  type UserFillsWsEvent,
} from "@nktkas/hyperliquid";
import type { LocalAccount } from "viem";
import type { HlNetwork } from "./config.ts";
import { codeForHlError, humanizeHlError, redactSecrets, TradeError } from "./orders.ts";

/**
 * SDK wiring and the exchange-action pipeline.
 *
 * Signing model (verified in the SDK source): `ExchangeClient` is built with
 * `wallet` = the AGENT account. `executeL1Action` signs the action hash with
 * that key and POSTs `{action, nonce, signature}`; `vaultAddress` is only added
 * when explicitly configured and we never set it. Hyperliquid recovers the
 * signer, finds the agent -> master approval and applies the action to the
 * master account, so no master address is sent. (The server-side mapping is
 * Hyperliquid behaviour, not something the SDK source can prove.)
 *
 * Nonces: the SDK serialises requests per (signer x network) behind a lock and
 * issues strictly increasing nonces, so rapid actions cannot collide.
 */

export type ExchangeApi = Pick<ExchangeClient, "order" | "modify" | "cancel" | "cancelByCloid" | "updateLeverage">;
export type HlInfoApi = Pick<
  InfoClient,
  "allMids" | "l2Book" | "clearinghouseState" | "frontendOpenOrders" | "orderStatus" | "userFills" | "activeAssetData" | "userAbstraction" | "spotClearinghouseState"
>;

export type ExchangeFactory = (wallet: LocalAccount, network: HlNetwork) => ExchangeApi;
export type InfoFactory = (network: HlNetwork) => HlInfoApi;

export const createSdkExchange: ExchangeFactory = (wallet, network) =>
  new ExchangeClient({ transport: new HttpTransport({ isTestnet: network === "testnet" }), wallet });

export const createSdkInfo: InfoFactory = (network) =>
  new InfoClient({ transport: new HttpTransport({ isTestnet: network === "testnet" }) });

// ── Streams (websocket) ───────────────────────────────────────────────────

export interface StreamHandle {
  unsubscribe(): Promise<void>;
}

/** The slice of the websocket client the gateway needs; injectable for tests. */
export interface HlStreams {
  orderUpdates(user: `0x${string}`, cb: (e: OrderUpdatesWsEvent) => void): Promise<StreamHandle>;
  userFills(user: `0x${string}`, cb: (e: UserFillsWsEvent) => void): Promise<StreamHandle>;
  allDexsClearinghouseState(
    user: `0x${string}`,
    cb: (e: AllDexsClearinghouseStateWsEvent) => void,
  ): Promise<StreamHandle>;
  /** Called after the socket re-opens following a drop (not on the first open). */
  onReconnect(cb: () => void): () => void;
  close(): void;
}
export type StreamsFactory = (network: HlNetwork) => HlStreams;

export const createSdkStreams: StreamsFactory = (network) => {
  const transport = new WebSocketTransport({ isTestnet: network === "testnet" });
  const client = new SubscriptionClient({ transport });
  const listeners = new Set<() => void>();
  let opened = false;
  transport.socket.addEventListener("open", () => {
    if (opened) for (const l of [...listeners]) l();
    opened = true;
  });
  return {
    orderUpdates: (user, cb) => client.orderUpdates({ user }, cb),
    userFills: (user, cb) => client.userFills({ user }, cb),
    allDexsClearinghouseState: (user, cb) => client.allDexsClearinghouseState({ user }, cb),
    onReconnect(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    close() {
      listeners.clear();
      void transport.close();
    },
  };
};

// ── Failure classification ────────────────────────────────────────────────

/**
 * - `rejected`     the exchange answered and refused (nothing was applied)
 * - `rate_limited` refused for rate reasons (nothing was applied; safe to retry)
 * - `not_sent`     failed locally before leaving the browser (validation / signing)
 * - `ambiguous`    transport failure; the action may or may not have been applied
 */
export type FailureKind = "rejected" | "rate_limited" | "not_sent" | "ambiguous";

const RATE_LIMIT_RE = /too many cumulative requests|rate.?limit|too many requests|\b429\b/i;

function nameOf(e: unknown): string {
  return typeof e === "object" && e !== null && "name" in e ? String((e as { name: unknown }).name) : "";
}
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === "string" ? e : "";
}
function httpStatusOf(e: unknown): number | undefined {
  if (typeof e !== "object" || e === null || !("response" in e)) return undefined;
  const r = (e as { response?: unknown }).response;
  if (typeof r === "object" && r !== null && "status" in r && typeof (r as { status: unknown }).status === "number") {
    return (r as { status: number }).status;
  }
  return undefined;
}

export function classifyFailure(e: unknown): FailureKind {
  if (e instanceof TradeError) return "not_sent";
  const name = nameOf(e);
  if (httpStatusOf(e) === 429) return "rate_limited";
  if (name === "ApiRequestError") return RATE_LIMIT_RE.test(messageOf(e)) ? "rate_limited" : "rejected";
  if (name === "ValidationError" || name === "AbstractWalletError") return "not_sent";
  return "ambiguous";
}

/** The `response` payload of an SDK ApiRequestError (the raw exchange reply), if any. */
export function apiResponseOf(e: unknown): unknown {
  return nameOf(e) === "ApiRequestError" && typeof e === "object" && e !== null && "response" in e
    ? (e as { response: unknown }).response
    : undefined;
}

/** A user-safe message for any thrown value. Never includes signatures or keys. */
export function describeError(e: unknown): string {
  if (e instanceof TradeError) return e.message;
  switch (classifyFailure(e)) {
    case "rate_limited":
      return "Hyperliquid is rate-limiting requests. Wait a few seconds and try again.";
    case "rejected":
      return humanizeHlError(messageOf(e));
    case "not_sent":
      return `Request couldn't be prepared: ${redactSecrets(messageOf(e)).slice(0, 200)}`;
    case "ambiguous": {
      const m = redactSecrets(messageOf(e)).slice(0, 160);
      return m ? `Couldn't reach Hyperliquid (${m}).` : "Couldn't reach Hyperliquid.";
    }
  }
}

/** Convert any failure into a TradeError with a human message and a matching code. */
export function toTradeError(e: unknown): TradeError {
  if (e instanceof TradeError) return e;
  const kind = classifyFailure(e);
  const code =
    kind === "rate_limited" ? "rate_limit" : kind === "ambiguous" ? "network" : codeForHlError(messageOf(e));
  return new TradeError(describeError(e), code);
}

// ── Action queue ──────────────────────────────────────────────────────────

export interface RunnerOptions {
  /** Delay before retry n (0-based) after a rate-limit refusal. */
  backoffMs?: (attempt: number) => number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Runs exchange actions one at a time, in submission order, and transparently
 * retries a rate-limit refusal with exponential backoff. Only `rate_limited`
 * failures are retried: those are guaranteed not to have been applied, so a
 * retry can never double-submit. Anything ambiguous is surfaced to the caller,
 * which reconciles by client order id instead of blindly resending.
 */
export class ExchangeRunner {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly backoff: (attempt: number) => number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: RunnerOptions = {}) {
    this.backoff = opts.backoffMs ?? ((n) => Math.min(500 * 2 ** n, 8000));
    this.maxRetries = opts.maxRetries ?? 4;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => this.attempt(action));
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async attempt<T>(action: () => Promise<T>): Promise<T> {
    for (let n = 0; ; n++) {
      try {
        return await action();
      } catch (e) {
        if (classifyFailure(e) !== "rate_limited" || n >= this.maxRetries) throw e;
        await this.sleep(this.backoff(n));
      }
    }
  }
}

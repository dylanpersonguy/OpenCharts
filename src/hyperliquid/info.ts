import { getEndpoints } from "./config.ts";

/**
 * Thin typed client for Hyperliquid's public `POST /info` endpoint.
 *
 * - Retries HTTP 429 / 5xx / network failures with bounded exponential backoff
 *   (honouring `Retry-After`).
 * - De-duplicates identical in-flight requests (one network call, many callers).
 * - Caches slow-moving reference data (`perpDexs`, `meta`, `perpCategories`)
 *   because `meta`/`candleSnapshot` weigh 20 of the 1200/min per-IP budget.
 */

// ── Response types (only the fields we use) ───────────────

export interface HlPerpDex {
  name: string;
  fullName?: string;
  deployer?: string;
}

export interface HlAssetMeta {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
  marginMode?: string;
  isDelisted?: boolean;
  marginTableId?: number;
  /** HIP-3 only: the deployer's fee scale as a decimal string ("1.0"). */
  deployerFeeScale?: string;
  /** HIP-3 only: "enabled" when the market is in growth mode (-90% protocol fees). */
  growthMode?: string;
}

export interface HlMarginTable {
  description?: string;
  marginTiers: { lowerBound: string; maxLeverage: number }[];
}

export interface HlMeta {
  universe: HlAssetMeta[];
  /** [marginTableId, table] pairs. */
  marginTables?: [number, HlMarginTable][];
  /** Collateral token index in spot meta (0 = USDC). */
  collateralToken?: number;
}

export interface HlAssetCtx {
  funding?: string;
  openInterest?: string;
  prevDayPx?: string;
  dayNtlVlm?: string;
  markPx?: string;
  midPx?: string | null;
  oraclePx?: string;
}

export type HlMetaAndAssetCtxs = [HlMeta, HlAssetCtx[]];

/** `allMids` result: coin -> mid price string. */
export type HlAllMids = Record<string, string>;

export interface HlRawCandle {
  /** open time, ms */
  t: number;
  /** close time, ms */
  T: number;
  s: string;
  i: string;
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
  n: number;
}

export interface HlBookLevel {
  px: string;
  sz: string;
  n: number;
}

export interface HlL2Book {
  coin: string;
  time: number;
  /** [bids, asks] */
  levels: [HlBookLevel[], HlBookLevel[]];
}

/** [coinName, category] pairs, e.g. ["xyz:EUR", "fx"]. */
export type HlPerpCategories = [string, string][];

export interface HlPosition {
  coin: string;
  szi: string;
  entryPx?: string;
  positionValue?: string;
  unrealizedPnl?: string;
  liquidationPx?: string | null;
  marginUsed?: string;
  leverage?: { type: string; value: number };
  [k: string]: unknown;
}

export interface HlClearinghouseState {
  marginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  crossMarginSummary?: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  withdrawable: string;
  assetPositions: { type: string; position: HlPosition }[];
  time?: number;
}

export interface HlOpenOrder {
  coin: string;
  side: "A" | "B";
  limitPx: string;
  sz: string;
  oid: number;
  timestamp: number;
  origSz?: string;
  cloid?: string;
  [k: string]: unknown;
}

export interface HlUserFill {
  coin: string;
  px: string;
  sz: string;
  side: "A" | "B";
  time: number;
  startPosition?: string;
  dir?: string;
  closedPnl?: string;
  hash?: string;
  oid: number;
  fee?: string;
  feeToken?: string;
  [k: string]: unknown;
}

export interface CandleSnapshotReq {
  coin: string;
  interval: string;
  startTime: number;
  endTime?: number;
}

// ── Client ────────────────────────────────────────────────

export class HlInfoError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "HlInfoError";
    this.status = status;
  }
}

export interface InfoClientOptions {
  /** Defaults to `getEndpoints().rest`. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Retries after the first attempt (default 3). */
  maxRetries?: number;
  /** First backoff delay in ms (default 500, doubling, capped at 8s). */
  baseDelayMs?: number;
  /** How long `meta`-class responses stay cached (default 5 min). */
  cacheTtlMs?: number;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface InfoClient {
  /** Raw typed call. Not cached; identical in-flight calls are shared. */
  post<T>(body: Record<string, unknown>): Promise<T>;
  perpDexs(): Promise<(HlPerpDex | null)[]>;
  meta(dex?: string): Promise<HlMeta>;
  metaAndAssetCtxs(dex?: string): Promise<HlMetaAndAssetCtxs>;
  allMids(dex?: string): Promise<HlAllMids>;
  candleSnapshot(req: CandleSnapshotReq): Promise<HlRawCandle[]>;
  l2Book(coin: string): Promise<HlL2Book>;
  perpCategories(): Promise<HlPerpCategories>;
  clearinghouseState(user: string, dex?: string): Promise<HlClearinghouseState>;
  openOrders(user: string, dex?: string): Promise<HlOpenOrder[]>;
  userFills(user: string): Promise<HlUserFill[]>;
  /** Max builder fee (tenths of a bp) the user approved for `builder`. */
  maxBuilderFee(user: string, builder: string): Promise<number>;
  /** Drop cached reference data (e.g. after a new HIP-3 market is listed). */
  invalidate(): void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 30_000);
  return null;
}

function dexBody(type: string, dex?: string): Record<string, unknown> {
  return dex ? { type, dex } : { type };
}

export function createInfoClient(options: InfoClientOptions = {}): InfoClient {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.baseDelayMs ?? 500;
  const ttl = options.cacheTtlMs ?? 5 * 60_000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const url = () => `${(options.baseUrl ?? getEndpoints().rest).replace(/\/$/, "")}/info`;

  const inflight = new Map<string, Promise<unknown>>();
  const cache = new Map<string, { at: number; value: unknown }>();

  async function request<T>(body: Record<string, unknown>): Promise<T> {
    let lastError: HlInfoError | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let retryAfter: number | null = null;
      try {
        const res = await doFetch(url(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          return (await res.json()) as T;
        }
        const text = await res.text().catch(() => "");
        lastError = new HlInfoError(
          `Hyperliquid info "${String(body.type)}" failed: HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`,
          res.status,
        );
        if (!isRetryableStatus(res.status)) throw lastError;
        retryAfter = parseRetryAfter(res.headers?.get?.("retry-after") ?? null);
      } catch (err) {
        if (err instanceof HlInfoError) {
          if (!isRetryableStatus(err.status ?? 0)) throw err;
        } else {
          // Network failure / JSON parse failure: retry.
          lastError = new HlInfoError(
            `Hyperliquid info "${String(body.type)}" failed: ${err instanceof Error ? err.message : "network error"}`,
            null,
          );
        }
      }
      if (attempt < maxRetries) {
        const backoff = Math.min(8_000, baseDelay * 2 ** attempt);
        await sleep(retryAfter ?? backoff);
      }
    }
    throw lastError ?? new HlInfoError("Hyperliquid info request failed", null);
  }

  function post<T>(body: Record<string, unknown>): Promise<T> {
    const key = JSON.stringify(body);
    const existing = inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = request<T>(body).finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, p);
    return p;
  }

  function cached<T>(body: Record<string, unknown>): Promise<T> {
    const key = JSON.stringify(body);
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return Promise.resolve(hit.value as T);
    return post<T>(body).then((value) => {
      cache.set(key, { at: now(), value });
      return value;
    });
  }

  return {
    post,
    perpDexs: () => cached<(HlPerpDex | null)[]>({ type: "perpDexs" }),
    meta: (dex) => cached<HlMeta>(dexBody("meta", dex)),
    metaAndAssetCtxs: (dex) => post<HlMetaAndAssetCtxs>(dexBody("metaAndAssetCtxs", dex)),
    allMids: (dex) => post<HlAllMids>(dexBody("allMids", dex)),
    candleSnapshot: (req) => post<HlRawCandle[]>({ type: "candleSnapshot", req }),
    l2Book: (coin) => post<HlL2Book>({ type: "l2Book", coin }),
    perpCategories: () => cached<HlPerpCategories>({ type: "perpCategories" }),
    clearinghouseState: (user, dex) =>
      post<HlClearinghouseState>({ ...dexBody("clearinghouseState", dex), user }),
    openOrders: (user, dex) => post<HlOpenOrder[]>({ ...dexBody("openOrders", dex), user }),
    userFills: (user) => post<HlUserFill[]>({ type: "userFills", user }),
    maxBuilderFee: (user, builder) => post<number>({ type: "maxBuilderFee", user, builder }),
    invalidate: () => cache.clear(),
  };
}

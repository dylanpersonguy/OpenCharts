/**
 * Optional remote fee config: a kill switch and dynamic fee.
 *
 * Host a tiny JSON document (static file, CDN, gist, edge function) and point
 * VITE_FEE_CONFIG_URL at it:
 *
 *   { "enabled": true, "feeTenthsBp": 50, "message": "Fees halved this week" }
 *
 * FAILURE POLICY (fail-OPEN, bounded): if the fetch fails, times out or the
 * document does not validate, we KEEP THE LAST KNOWN GOOD config; before any
 * success that means the compiled-in default (VITE_HL_BUILDER_FEE or 100).
 * Tradeoff: an unreachable config host cannot switch fees off, so the kill
 * switch is only as fast as the host is reachable. We choose this over
 * fail-closed because an outage of a static JSON file must not silently turn
 * off revenue or block trading. The remote fee can never exceed the
 * compiled-in default (hence never HL's cap of 100): it may only lower or
 * disable the fee. `message` is sanitized plain text (render as a text node).
 *
 * APPROVALS: each user signed `approveBuilderFee` with a max rate. Raising
 * `feeTenthsBp` above what a user approved makes their orders fail with a
 * builder-fee error (see `isBuilderFeeApprovalError`). Lowering is always safe.
 * To raise fees, ship it together with a re-approval prompt: the trading flow
 * should catch this error and move the session to "needs-builder-approval".
 */
import { create } from "zustand";
import { z } from "zod";
import { MAX_PERP_BUILDER_FEE_TENTHS_BP, clampBuilderFee, setBuilderOverride } from "./config.ts";

export const FeeConfigSchema = z.object({
  enabled: z.boolean(),
  feeTenthsBp: z.number().finite().min(0).optional(),
  // Long messages are truncated by sanitizeFeeMessage, not rejected: a verbose
  // banner must not invalidate the document (and with it the kill switch).
  message: z.string().max(4000).optional(),
});
export type FeeConfig = z.infer<typeof FeeConfigSchema>;

export interface FeeConfigState {
  /** Banner text from the remote config, if any. */
  message: string | null;
  /** Last applied remote `enabled` (null until a successful fetch). */
  enabled: boolean | null;
  /** Last applied (clamped) remote fee, if the config specified one. */
  feeTenthsBp: number | null;
  /** Unix ms of the last successful fetch. */
  lastOkAt: number | null;
  lastError: string | null;
}

export const useFeeConfigStore = create<FeeConfigState>(() => ({
  message: null,
  enabled: null,
  feeTenthsBp: null,
  lastOkAt: null,
  lastError: null,
}));

/** Max characters of the remote banner that we keep. */
export const MAX_FEE_MESSAGE_CHARS = 200;

/**
 * Reduce a remote banner to short, single-line PLAIN TEXT: control characters,
 * bidi overrides and zero-width characters are removed, whitespace collapsed,
 * length capped. Consumers MUST render it as a React text node (never as HTML).
 */
export function sanitizeFeeMessage(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const clean = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  return clean.length > MAX_FEE_MESSAGE_CHARS ? `${clean.slice(0, MAX_FEE_MESSAGE_CHARS - 1)}…` : clean;
}

type Env = Record<string, string | undefined>;
const readEnv = (): Env => ((import.meta as unknown as { env?: Env }).env ?? {}) as Env;

/** The compiled-in fee (VITE_HL_BUILDER_FEE, default 100), ignoring any remote override. */
export function compiledDefaultFee(e: Env = readEnv()): number {
  return e.VITE_HL_BUILDER_FEE === undefined
    ? MAX_PERP_BUILDER_FEE_TENTHS_BP
    : clampBuilderFee(e.VITE_HL_BUILDER_FEE);
}

/** Validate an unknown JSON value; returns undefined if it is not a valid config. */
export function parseFeeConfig(json: unknown): FeeConfig | undefined {
  const r = FeeConfigSchema.safeParse(json);
  return r.success ? r.data : undefined;
}

/**
 * Apply a validated config: override fee/kill switch, publish the banner.
 * A remote config may only LOWER or disable the fee relative to the compiled-in
 * default, never raise it: the fee is clamped to `compiledDefaultFee()`.
 */
export function applyFeeConfig(cfg: FeeConfig, now: number = Date.now(), env?: Env): void {
  const fee =
    cfg.feeTenthsBp === undefined
      ? undefined
      : Math.min(clampBuilderFee(cfg.feeTenthsBp), compiledDefaultFee(env));
  setBuilderOverride({ enabled: cfg.enabled, feeTenthsBp: fee });
  useFeeConfigStore.setState({
    message: sanitizeFeeMessage(cfg.message),
    enabled: cfg.enabled,
    feeTenthsBp: fee ?? null,
    lastOkAt: now,
    lastError: null,
  });
}

export interface FeeConfigPollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

function envUrl(): string | undefined {
  const e = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const v = e?.VITE_FEE_CONFIG_URL?.trim();
  return v ? v : undefined;
}

/** One fetch + validate + apply. Returns true on success; on failure keeps last known good. */
export async function fetchFeeConfigOnce(
  url: string,
  opts: Pick<FeeConfigPollOptions, "timeoutMs" | "fetchImpl"> & { env?: Env } = {},
): Promise<boolean> {
  const doFetch = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await doFetch(url, { signal: ctrl.signal, cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cfg = parseFeeConfig(await res.json());
    if (!cfg) throw new Error("invalid fee config schema");
    applyFeeConfig(cfg, Date.now(), opts.env);
    return true;
  } catch (err) {
    useFeeConfigStore.setState({ lastError: err instanceof Error ? err.message : String(err) });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Poll the remote config. No URL configured = no-op. Returns `stop()`.
 * First fetch happens immediately, then every `intervalMs` (default 60s).
 */
export function startFeeConfigPolling(
  url: string | undefined = envUrl(),
  opts: FeeConfigPollOptions = {},
): () => void {
  if (!url) return () => {};
  const interval = opts.intervalMs ?? 60_000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    await fetchFeeConfigOnce(url, opts);
    if (!stopped) timer = setTimeout(() => void tick(), interval);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/**
 * True when an exchange error means the user has not approved our builder, or
 * approved less than the fee we sent. Hyperliquid's text (community-observed,
 * NOT from official docs, verify against live testnet): "Builder fee has not
 * been approved." The other patterns are GUESSES at variants ("...exceeds
 * max", "must approve builder fee") kept deliberately loose.
 */
export function isBuilderFeeApprovalError(msg: unknown): boolean {
  const text = typeof msg === "string" ? msg : msg instanceof Error ? msg.message : "";
  if (!text) return false;
  return (
    /builder fee has not been approved/i.test(text) || // observed
    /builder.{0,40}(not (been )?approved|unapproved|exceeds?.{0,20}(max|approv))/i.test(text) || // guess
    /(must|need|needs).{0,20}approve.{0,30}builder/i.test(text) || // guess
    /max(imum)? builder fee/i.test(text) // guess
  );
}

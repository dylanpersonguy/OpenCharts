/**
 * Shared helpers for the builder ops scripts (run with `tsx`, see package.json
 * "builder:*" scripts). Pure functions are exported for unit tests; anything
 * touching the network or env lives in the bottom half.
 *
 * Verified CSV schema (builder_fills, fetched 2026-11):
 *   time,user,coin,side,px,sz,crossed,special_trade_type,tif,is_trigger,
 *   counterparty,closed_pnl,twap_id,builder_fee
 * `builder_fee` is in USDC. We still resolve columns BY NAME and fail loudly
 * if no builder-fee-like column exists, because the schema is undocumented.
 */
import lz4 from "lz4js";

export const STATS_BASE = "https://stats-data.hyperliquid.xyz";
const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

// ---------- addresses / dates ----------

/** The stats bucket is case sensitive: addresses MUST be lowercase. */
export function assertLowercaseAddress(addr: string, label = "address"): `0x${string}` {
  if (!ADDRESS_RE.test(addr)) {
    throw new Error(`${label} must be a lowercase 0x-prefixed 40-hex address, got "${addr}"`);
  }
  return addr as `0x${string}`;
}

/** Date -> "YYYYMMDD" (UTC). */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** "YYYYMMDD" or "YYYY-MM-DD" -> UTC midnight Date. */
export function parseDay(s: string): Date {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  if (!m) throw new Error(`bad date "${s}", expected YYYYMMDD or YYYY-MM-DD`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (ymd(d) !== `${m[1]}${m[2]}${m[3]}`) throw new Error(`invalid calendar date "${s}"`);
  return d;
}

/** Inclusive list of UTC days. */
export function dayRange(from: Date, to: Date): string[] {
  if (from.getTime() > to.getTime()) throw new Error("--from is after --to");
  const out: string[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) out.push(ymd(new Date(t)));
  return out;
}

export function builderFillsUrl(builder: string, day: string, network: "mainnet" | "testnet" = "mainnet"): string {
  const addr = assertLowercaseAddress(builder, "builder address");
  return `${STATS_BASE}/${network === "mainnet" ? "Mainnet" : "Testnet"}/builder_fills/${addr}/${day}.csv.lz4`;
}

// ---------- LZ4 + CSV ----------

/** Decompress an LZ4 *frame* (what the `lz4` CLI / HL produce) to UTF-8 text. */
export function decodeLz4(buf: Uint8Array): string {
  const out = lz4.decompress(buf);
  return new TextDecoder().decode(Uint8Array.from(out));
}

/** Test helper / symmetric encoder. */
export function encodeLz4(text: string): Uint8Array {
  return Uint8Array.from(lz4.compress(new TextEncoder().encode(text)));
}

/** Minimal RFC4180-ish CSV splitter (handles quotes and CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

export interface FillRow {
  /** ISO timestamp as in the CSV. */
  time: string;
  /** YYYYMMDD derived from `time` (UTC). */
  day: string;
  coin: string;
  side: string;
  /** px * sz when both columns exist, else 0. */
  notional: number;
  /** Builder fee, USDC. */
  fee: number;
}

export interface ParsedFills {
  columns: string[];
  feeColumn: string;
  rows: FillRow[];
  /** Rows skipped because time or fee was unparsable. */
  skipped: number;
}

function findColumn(cols: string[], test: (c: string) => boolean): number {
  return cols.findIndex((c) => test(c.trim().toLowerCase()));
}

/** Parse a builder_fills CSV by header names. Throws if essential columns are missing. */
export function parseBuilderFills(csv: string, fallbackDay?: string): ParsedFills {
  const table = parseCsv(csv);
  const header = table[0];
  if (!header) throw new Error("empty CSV (no header)");
  const iFee = findColumn(header, (c) => /builder/.test(c) && /fee/.test(c));
  if (iFee < 0) {
    throw new Error(`no builder-fee-like column in CSV header; found: ${header.join(", ")}`);
  }
  const iTime = findColumn(header, (c) => c === "time" || c === "timestamp");
  const iCoin = findColumn(header, (c) => c === "coin" || c === "market" || c === "asset");
  const iSide = findColumn(header, (c) => c === "side" || c === "dir");
  const iPx = findColumn(header, (c) => c === "px" || c === "price");
  const iSz = findColumn(header, (c) => c === "sz" || c === "size");
  if (iCoin < 0) throw new Error(`no coin column in CSV header; found: ${header.join(", ")}`);
  if (iTime < 0 && !fallbackDay) throw new Error(`no time column in CSV header; found: ${header.join(", ")}`);

  const rows: FillRow[] = [];
  let skipped = 0;
  for (const r of table.slice(1)) {
    const fee = Number(r[iFee]);
    const time = iTime >= 0 ? (r[iTime] ?? "") : "";
    const day = time ? time.slice(0, 10).replace(/-/g, "") : (fallbackDay ?? "");
    if (!Number.isFinite(fee) || r[iFee] === "" || !/^\d{8}$/.test(day)) {
      skipped++;
      continue;
    }
    const px = iPx >= 0 ? Number(r[iPx]) : NaN;
    const sz = iSz >= 0 ? Number(r[iSz]) : NaN;
    rows.push({
      time,
      day,
      coin: r[iCoin] ?? "?",
      side: iSide >= 0 ? (r[iSide] ?? "?") : "?",
      notional: Number.isFinite(px) && Number.isFinite(sz) ? px * sz : 0,
      fee,
    });
  }
  return { columns: header, feeColumn: header[iFee] ?? "", rows, skipped };
}

// ---------- aggregation ----------

export interface Bucket {
  key: string;
  fills: number;
  notional: number;
  fee: number;
}

function groupBy(rows: FillRow[], keyOf: (r: FillRow) => string): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const r of rows) {
    const k = keyOf(r);
    const b = m.get(k) ?? { key: k, fills: 0, notional: 0, fee: 0 };
    b.fills++;
    b.notional += r.notional;
    b.fee += r.fee;
    m.set(k, b);
  }
  return [...m.values()];
}

export interface Aggregate {
  byDay: Bucket[];
  byMarket: Bucket[];
  bySide: Bucket[];
  total: { fills: number; notional: number; fee: number };
}

export function aggregate(rows: FillRow[]): Aggregate {
  const byFeeDesc = (a: Bucket, b: Bucket) => b.fee - a.fee;
  return {
    byDay: groupBy(rows, (r) => r.day).sort((a, b) => a.key.localeCompare(b.key)),
    byMarket: groupBy(rows, (r) => r.coin).sort(byFeeDesc),
    bySide: groupBy(rows, (r) => r.side).sort(byFeeDesc),
    total: rows.reduce(
      (t, r) => ({ fills: t.fills + 1, notional: t.notional + r.notional, fee: t.fee + r.fee }),
      { fills: 0, notional: 0, fee: 0 },
    ),
  };
}

export function bucketsToCsv(title: string, buckets: Bucket[]): string {
  const lines = [`${title},fills,notional_usd,builder_fee_usd`];
  for (const b of buckets) {
    lines.push(`${csvCell(b.key)},${b.fills},${b.notional.toFixed(2)},${b.fee.toFixed(6)}`);
  }
  return lines.join("\n") + "\n";
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function formatTable(title: string, buckets: Bucket[], limit = 25): string {
  const shown = buckets.slice(0, limit);
  const w = Math.max(title.length, ...shown.map((b) => b.key.length));
  const out = [`${title.padEnd(w)}  ${"fills".padStart(8)}  ${"notional".padStart(16)}  ${"fee (USDC)".padStart(14)}`];
  for (const b of shown) {
    out.push(
      `${b.key.padEnd(w)}  ${String(b.fills).padStart(8)}  ${b.notional.toFixed(2).padStart(16)}  ${b.fee.toFixed(4).padStart(14)}`,
    );
  }
  if (buckets.length > limit) out.push(`... ${buckets.length - limit} more (see CSV/JSON output)`);
  return out.join("\n");
}

// ---------- reconcile ----------

export interface Drift {
  csvTotal: number;
  apiTotal: number;
  diff: number;
  /** |diff| / max(csv, api); 0 when both are 0. */
  ratio: number;
  flagged: boolean;
}

export function computeDrift(csvTotal: number, apiTotal: number, threshold = 0.01): Drift {
  const diff = csvTotal - apiTotal;
  const denom = Math.max(Math.abs(csvTotal), Math.abs(apiTotal));
  const ratio = denom === 0 ? 0 : Math.abs(diff) / denom;
  return { csvTotal, apiTotal, diff, ratio, flagged: ratio > threshold };
}

// ---------- args / env ----------

export interface Args {
  flags: Map<string, string | true>;
  positional: string[];
}

export function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) flags.set(a.slice(2, eq), a.slice(eq + 1));
      else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags.set(a.slice(2), next);
          i++;
        } else flags.set(a.slice(2), true);
      }
    } else positional.push(a);
  }
  return { flags, positional };
}

export function flagStr(args: Args, name: string): string | undefined {
  const v = args.flags.get(name);
  return typeof v === "string" ? v : undefined;
}

export type Env = Record<string, string | undefined>;

export function resolveNetwork(env: Env): "mainnet" | "testnet" {
  const n = (env.HL_NETWORK ?? env.VITE_HL_NETWORK ?? "mainnet").toLowerCase();
  if (n !== "mainnet" && n !== "testnet") throw new Error(`HL_NETWORK must be mainnet or testnet, got "${n}"`);
  return n;
}

export function resolveBuilderAddress(env: Env, override?: string): `0x${string}` {
  const raw = (override ?? env.HL_BUILDER_ADDRESS ?? env.VITE_HL_BUILDER_ADDRESS ?? "").trim();
  if (!raw) throw new Error("builder address not set: pass --builder or set HL_BUILDER_ADDRESS (or VITE_HL_BUILDER_ADDRESS)");
  return assertLowercaseAddress(raw.toLowerCase(), "builder address");
}

/** Default report window: the last 7 complete UTC days (today's file is not published yet). */
export function defaultRange(now: Date = new Date(), days = 7): { from: Date; to: Date } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { from: new Date(today - days * 86_400_000), to: new Date(today - 86_400_000) };
}

// ---------- IO (network) ----------

/** Fetch + decode one day. Returns null on 404 (no fills that day). Throws on other errors. */
export async function fetchBuilderDay(
  builder: string,
  day: string,
  network: "mainnet" | "testnet" = "mainnet",
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedFills | null> {
  const url = builderFillsUrl(builder, day, network);
  const res = await fetchImpl(url);
  if (res.status === 404 || res.status === 403) return null; // S3-style buckets answer 403 for missing keys
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const text = decodeLz4(new Uint8Array(await res.arrayBuffer()));
  return parseBuilderFills(text, day);
}

export async function fetchBuilderRange(
  builder: string,
  days: string[],
  network: "mainnet" | "testnet" = "mainnet",
  fetchImpl: typeof fetch = fetch,
  onDay?: (day: string, parsed: ParsedFills | null) => void,
): Promise<{ rows: FillRow[]; columns: string[]; missingDays: string[]; skipped: number }> {
  const rows: FillRow[] = [];
  const missingDays: string[] = [];
  let columns: string[] = [];
  let skipped = 0;
  for (const d of days) {
    const p = await fetchBuilderDay(builder, d, network, fetchImpl);
    onDay?.(d, p);
    if (!p) {
      missingDays.push(d);
      continue;
    }
    columns = p.columns;
    skipped += p.skipped;
    for (const r of p.rows) rows.push(r);
  }
  return { rows, columns, missingDays, skipped };
}

/** Info-API client for the selected network (dynamic import keeps pure tests light). */
export async function makeInfoClient(network: "mainnet" | "testnet") {
  const { InfoClient, HttpTransport } = await import("@nktkas/hyperliquid");
  return new InfoClient({ transport: new HttpTransport({ isTestnet: network === "testnet" }) });
}

/** Never print secrets: redact anything that looks like a 32-byte hex key. */
export function redact(s: string): string {
  return s.replace(/0x[0-9a-fA-F]{64}\b/g, "0x[REDACTED]");
}

// Minimal local typing: the app tsconfig has no @types/node (scripts run under Node via tsx).
declare const process: { exit(code?: number): never };

export function fail(msg: string, code = 1): never {
  console.error(redact(msg));
  process.exit(code);
}

// ---------- health evaluation (pure) ----------

export type CheckLevel = "ok" | "warn" | "fail";
export interface Check {
  name: string;
  level: CheckLevel;
  detail: string;
}

export const MIN_BUILDER_ACCOUNT_VALUE = 100;
export const WARN_BUILDER_ACCOUNT_VALUE = 150;

/** userAbstraction "disabled"/"default" are the standard (non-unified) modes. */
export function checkAbstraction(mode: string): Check {
  const standard = mode === "disabled" || mode === "default";
  return {
    name: "account abstraction mode",
    level: standard ? "ok" : "fail",
    detail: standard
      ? `"${mode}" (standard)`
      : `"${mode}": builder wallet must be in standard mode (unified / portfolio-margin accounts are not supported for builder fee accrual)`,
  };
}

export function checkAccountValue(value: number): Check {
  if (!Number.isFinite(value)) return { name: "perps account value", level: "fail", detail: "unparsable value" };
  const detail = `${value.toFixed(2)} USDC (min ${MIN_BUILDER_ACCOUNT_VALUE}, warn < ${WARN_BUILDER_ACCOUNT_VALUE})`;
  if (value < MIN_BUILDER_ACCOUNT_VALUE) return { name: "perps account value", level: "fail", detail };
  if (value < WARN_BUILDER_ACCOUNT_VALUE) return { name: "perps account value", level: "warn", detail };
  return { name: "perps account value", level: "ok", detail };
}

export function checkFeeConfig(fee: number, maxFee = 100): Check {
  const ok = Number.isInteger(fee) && fee >= 0 && fee <= maxFee;
  return {
    name: "fee config",
    level: ok ? "ok" : "fail",
    detail: ok ? `f=${fee} tenths of a bp (${(fee / 10).toFixed(1)} bps)` : `f=${fee} must be an integer in [0, ${maxFee}]`,
  };
}

export function checkApproval(approved: number, configured: number, user: string): Check {
  const ok = approved >= configured;
  return {
    name: "maxBuilderFee for test user",
    level: ok ? "ok" : "fail",
    detail: ok
      ? `${user} approved ${approved} >= configured ${configured}`
      : `${user} approved ${approved} < configured ${configured}: orders would be rejected`,
  };
}

/** Exit code for a set of checks: 1 if any fail, else 0 (warnings do not fail). */
export function healthExitCode(checks: Check[]): number {
  return checks.some((c) => c.level === "fail") ? 1 : 0;
}

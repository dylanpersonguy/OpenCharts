/**
 * Phase 0 verification tool: exercises the Hyperliquid broker layer against
 * Hyperliquid TESTNET and records what the exchange REALLY does, so the open
 * assumptions in the code can be confirmed or corrected.
 *
 *   HL_NETWORK=testnet HL_BUILDER_ADDRESS=0x... HL_TEST_PRIVATE_KEY=0x... \
 *     npx tsx scripts/hl-testnet-verify.mts --report testnet-report.json
 *
 *   HL_NETWORK=testnet npx tsx scripts/hl-testnet-verify.mts --dry-run --report dry.json
 *
 * Flags:
 *   --report <path>     JSON report file (default ./hl-testnet-report.json)
 *   --dry-run           no key needed; self-checks + public read-only steps only
 *   --notional <usd>    size of the test orders, default 12 (must be >= 11)
 *   --skip-hip3         do not trade a HIP-3 market
 *   --dexes a,b,c       HIP-3 dexes to load (default: the known deployers that exist on testnet:
 *                       xyz, flx, vntl, hyna, km, abcd, cash, para, mkts, io). Testnet lists ~280
 *                       dexes; loading all of them costs ~5.5k info weight (limit 1200/min) and
 *                       triggers HTTP 429 for minutes.
 *   --all-dexes         load every HIP-3 dex (slow, rate-limited; read-only research only)
 *   --keep-funds        do not send the second test account's funds back
 *   --help
 *
 * SAFETY (all enforced in code, see assertSafeEnvironment / installNetworkGuard):
 *  - HL_NETWORK must be exactly "testnet"; anything else refuses to start.
 *  - The ONLY host this process may talk to is api.hyperliquid-testnet.xyz.
 *    A global fetch guard throws for every other host, mainnet included.
 *  - HL_TEST_PRIVATE_KEY must be a THROWAWAY key funded from the testnet faucet.
 *    It is read from the environment only, never printed, never written to the
 *    report, never put on a command line.
 *  - Every position/order opened is cancelled/closed in a finally block.
 *
 * Where the app's own code is reused: the agent approval is the real
 * `approveAgentStep` (src/hyperliquid/wallet/setup.ts) driven by a Node EIP-1193
 * provider, and every trade goes through the real `createHyperliquidTrading`
 * gateway. `approveBuilderStep` reads `import.meta.env` (undefined under Node,
 * so it would skip), therefore the builder approval is REPLICATED here with the
 * identical calls (`ensureWalletChain` + `createUserExchange(...).approveBuilderFee`
 * with `getMaxFeeRateString`). Output is PASS / FAIL / INFO per check.
 */
import { writeFileSync } from "node:fs";
import { ExchangeClient, HttpTransport, InfoClient as SdkInfoClient } from "@nktkas/hyperliquid";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { recoverTypedDataAddress, type LocalAccount } from "viem";
import { createMemoryVault } from "../src/hyperliquid/agentKey.ts";
import { getMaxFeeRateString, MAX_PERP_BUILDER_FEE_TENTHS_BP, clampBuilderFee, type Address, type BuilderParam } from "../src/hyperliquid/config.ts";
import { isBuilderFeeApprovalError } from "../src/hyperliquid/feeConfig.ts";
import { createInfoClient } from "../src/hyperliquid/info.ts";
import { formatPx, formatSz, humanizeHlError, slippagePx, MIN_ORDER_NOTIONAL_USD } from "../src/hyperliquid/orders.ts";
import { hlSession } from "../src/hyperliquid/session.ts";
import { createMarketRegistry } from "../src/hyperliquid/symbols.ts";
import { createHyperliquidTrading } from "../src/hyperliquid/trading.ts";
import { humanizeError } from "../src/hyperliquid/wallet/errors.ts";
import { createUserExchange, createInfoApi } from "../src/hyperliquid/wallet/clients.ts";
import type { Eip1193Provider } from "../src/hyperliquid/wallet/providers.ts";
import { approveAgentStep, ensureWalletChain } from "../src/hyperliquid/wallet/setup.ts";

// ───────────────────────────────────────────────────────────── types / consts

const TESTNET_REST = "https://api.hyperliquid-testnet.xyz";
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(["api.hyperliquid-testnet.xyz"]);
const TESTNET_SIG_CHAIN = "0x66eee" as const; // Arbitrum Sepolia (421614)
const REPORT_SCHEMA = "openbroker.hl-testnet-verify/1";

type Status = "PASS" | "FAIL" | "INFO" | "SKIP";
interface StepRecord {
  id: string;
  title: string;
  status: Status;
  checks: Array<{ status: Exclude<Status, "SKIP">; message: string }>;
  data: Record<string, unknown>;
  error?: string;
  ms: number;
}
interface Args {
  report: string;
  dryRun: boolean;
  notional: number;
  skipHip3: boolean;
  keepFunds: boolean;
  allDexes: boolean;
  dexes: string[];
  help: boolean;
}

const DEFAULT_DEXES = ["xyz", "flx", "vntl", "hyna", "km", "abcd", "cash", "para", "mkts", "io"];

class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Refusal";
  }
}

// ───────────────────────────────────────────────────────────── pure helpers (exported for tests)

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = { report: "hl-testnet-report.json", dryRun: false, notional: 12, skipHip3: false, keepFunds: false, allDexes: false, dexes: DEFAULT_DEXES, help: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] ?? "";
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Refusal(`${t} needs a value`);
      return v;
    };
    switch (t) {
      case "--report":
        a.report = next();
        break;
      case "--dry-run":
        a.dryRun = true;
        break;
      case "--notional": {
        const n = Number(next());
        if (!Number.isFinite(n) || n < MIN_ORDER_NOTIONAL_USD + 1 || n > 100) {
          throw new Refusal(`--notional must be between ${MIN_ORDER_NOTIONAL_USD + 1} and 100 (USD)`);
        }
        a.notional = n;
        break;
      }
      case "--skip-hip3":
        a.skipHip3 = true;
        break;
      case "--keep-funds":
        a.keepFunds = true;
        break;
      case "--all-dexes":
        a.allDexes = true;
        break;
      case "--dexes": {
        const list = next().split(",").map((x) => x.trim()).filter(Boolean);
        if (list.length === 0 || list.some((x) => !/^[A-Za-z0-9_-]{1,16}$/.test(x))) throw new Refusal("--dexes needs a comma-separated list of dex names");
        a.dexes = list;
        break;
      }
      case "--help":
      case "-h":
        a.help = true;
        break;
      default:
        throw new Refusal(`unknown argument "${t}" (try --help)`);
    }
  }
  return a;
}

/** Throws Refusal unless the environment is safe for a testnet run. */
export function assertSafeEnvironment(env: Record<string, string | undefined>, opts: { dryRun: boolean }): {
  key: `0x${string}` | undefined;
  builder: Address | undefined;
  feeTenthsBp: number;
} {
  if (env.HL_NETWORK !== "testnet") {
    throw new Refusal(`HL_NETWORK must be exactly "testnet" (got ${JSON.stringify(env.HL_NETWORK ?? null)}). This tool never talks to mainnet.`);
  }
  if (env.VITE_HL_NETWORK === "mainnet") throw new Refusal('VITE_HL_NETWORK=mainnet is set; unset it or set it to "testnet".');
  for (const [k, v] of Object.entries(env)) {
    if (/^(HL|VITE_HL)_.*(URL|ENDPOINT|REST|WS)/.test(k) && v && !/hyperliquid-testnet\.xyz/.test(v)) {
      throw new Refusal(`${k} points at a non-testnet endpoint; refusing.`);
    }
  }
  const rawKey = env.HL_TEST_PRIVATE_KEY?.trim();
  if (!opts.dryRun) {
    if (!rawKey) throw new Refusal("HL_TEST_PRIVATE_KEY is missing. Use a THROWAWAY testnet key (see docs/TESTNET_CHECKLIST.md). It is read from the environment only.");
  }
  if (rawKey && !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) throw new Refusal("HL_TEST_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string.");
  const builderRaw = env.HL_BUILDER_ADDRESS?.trim();
  if (!opts.dryRun && !(builderRaw && /^0x[0-9a-fA-F]{40}$/.test(builderRaw))) {
    throw new Refusal("HL_BUILDER_ADDRESS must be set to a 0x address (the builder wallet that receives fees).");
  }
  if (builderRaw && !/^0x[0-9a-fA-F]{40}$/.test(builderRaw)) throw new Refusal("HL_BUILDER_ADDRESS is not a valid address.");
  const feeRaw = env.HL_BUILDER_FEE ?? env.VITE_HL_BUILDER_FEE;
  const feeTenthsBp = feeRaw === undefined || feeRaw === "" ? MAX_PERP_BUILDER_FEE_TENTHS_BP : clampBuilderFee(feeRaw);
  if (feeTenthsBp <= 0) throw new Refusal("Builder fee resolves to 0; set HL_BUILDER_FEE to 1..100 (tenths of a basis point).");
  return {
    key: rawKey as `0x${string}` | undefined,
    builder: builderRaw ? (builderRaw.toLowerCase() as Address) : undefined,
    feeTenthsBp,
  };
}

/** Replace anything that looks like a key/signature before it reaches stdout or the report. */
export function redact(s: string): string {
  return s.replace(/0x[0-9a-fA-F]{64,}/g, "[redacted]");
}

/** Expected builder fee in USDC for `notional` at `f` tenths of a bp. */
export function expectedBuilderFee(notional: number, f: number): number {
  return (notional * f) / 100_000;
}

export function builderFeeMatches(actual: number, notional: number, f: number): boolean {
  const exp = expectedBuilderFee(notional, f);
  return actual > 0 && Math.abs(actual - exp) <= Math.max(0.00005, exp * 0.05);
}

/** Block every host except the testnet API. Returns an undo function (used by the self-test). */
export function installNetworkGuard(): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let host = "";
    try {
      host = new URL(raw).hostname;
    } catch {
      /* relative / invalid: refuse below */
    }
    if (!ALLOWED_HOSTS.has(host)) return Promise.reject(new Refusal(`network guard: refusing request to "${host || raw}"`));
    return real(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

// ───────────────────────────────────────────────────────────── report plumbing

const steps: StepRecord[] = [];
const findings: Record<string, unknown> = {};
const cleanupLog: string[] = [];

const out = (line: string): void => console.log(redact(line));
const tag = (s: Status): string => `[${s}]`.padEnd(7);

interface Rec {
  pass(msg: string): void;
  fail(msg: string): void;
  info(msg: string): void;
  data(k: string, v: unknown): void;
}

async function step(id: string, title: string, fn: (r: Rec) => Promise<void>): Promise<StepRecord> {
  const rec: StepRecord = { id, title, status: "INFO", checks: [], data: {}, ms: 0 };
  const t0 = Date.now();
  out(`\n== ${id}  ${title}`);
  const r: Rec = {
    pass: (m) => (rec.checks.push({ status: "PASS", message: m }), out(`  ${tag("PASS")} ${m}`)),
    fail: (m) => (rec.checks.push({ status: "FAIL", message: m }), out(`  ${tag("FAIL")} ${m}`)),
    info: (m) => (rec.checks.push({ status: "INFO", message: m }), out(`  ${tag("INFO")} ${m}`)),
    data: (k, v) => {
      rec.data[k] = v;
    },
  };
  try {
    await fn(r);
  } catch (e) {
    rec.error = redact(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    r.fail(`step threw: ${rec.error}`);
  }
  rec.ms = Date.now() - t0;
  rec.status = rec.checks.some((c) => c.status === "FAIL") ? "FAIL" : rec.checks.some((c) => c.status === "PASS") ? "PASS" : "INFO";
  steps.push(rec);
  return rec;
}

function skip(id: string, title: string, reason: string): void {
  steps.push({ id, title, status: "SKIP", checks: [{ status: "INFO", message: reason }], data: {}, ms: 0 });
  out(`\n== ${id}  ${title}\n  ${tag("SKIP")} ${reason}`);
}

function writeReport(path: string, base: Record<string, unknown>): void {
  const counts = { PASS: 0, FAIL: 0, INFO: 0, SKIP: 0 };
  for (const s of steps) counts[s.status]++;
  const report = { schema: REPORT_SCHEMA, ...base, finishedAt: new Date().toISOString(), summary: counts, findings, cleanup: cleanupLog, steps };
  writeFileSync(path, redact(JSON.stringify(report, null, 2)));
  out(`\nReport written to ${path}  (PASS ${counts.PASS}, FAIL ${counts.FAIL}, INFO ${counts.INFO}, SKIP ${counts.SKIP})`);
}

// ───────────────────────────────────────────────────────────── infra

/**
 * Keep every dex's POSITION in `perpDexs` (asset ids depend on it) but blank the ones we do not
 * want, so the registry skips them (symbols.ts ignores dexIndex > 0 with an empty name).
 */
function restrictDexes(info: ReturnType<typeof createInfoClient>, keep: ReadonlySet<string>): ReturnType<typeof createInfoClient> {
  return {
    ...info,
    perpDexs: async () => (await info.perpDexs()).map((d) => (d === null ? null : keep.has(d.name) ? d : { name: "" })),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const errText = (e: unknown): string => redact(e instanceof Error ? e.message : String(e));

async function rawInfo<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${TESTNET_REST}/info`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`info ${String(body.type)} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** A Node EIP-1193 wallet that behaves like MetaMask: it enforces the chain-id match on typed-data signing. */
function makeNodeWallet(account: PrivateKeyAccount, startChain = "0x1") {
  const log: Array<{ method: string; detail?: unknown }> = [];
  let chain = startChain;
  const provider: Eip1193Provider = {
    async request({ method, params }) {
      const p = Array.isArray(params) ? params : [];
      switch (method) {
        case "eth_chainId":
          return chain;
        case "wallet_switchEthereumChain": {
          chain = String((p[0] as { chainId: string }).chainId);
          log.push({ method, detail: chain });
          return null;
        }
        case "eth_accounts":
        case "eth_requestAccounts":
          return [account.address];
        case "eth_signTypedData_v4": {
          const typed = JSON.parse(String(p[1])) as {
            domain: { chainId?: number | string };
            types: Record<string, Array<{ name: string; type: string }>>;
            primaryType: string;
            message: Record<string, unknown>;
          };
          const dc = Number(typed.domain.chainId);
          if (dc !== parseInt(chain, 16)) {
            throw new Error(`wallet refused: typed-data chainId ${dc} != active chain ${parseInt(chain, 16)}`);
          }
          const { EIP712Domain: _omit, ...types } = typed.types;
          void _omit;
          log.push({ method, detail: { primaryType: typed.primaryType, chainId: dc } });
          return account.signTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message } as never);
        }
        default:
          throw new Error(`unsupported method ${method}`);
      }
    },
  };
  return { provider, log };
}

interface RawOrderOutcome {
  thrown?: string;
  response?: unknown;
}

/** Send one raw order with the SDK (bypassing the gateway's local validation) and keep the exchange's exact words. */
async function rawOrder(
  signer: LocalAccount,
  wire: Parameters<ExchangeClient["order"]>[0]["orders"][number],
  builder: BuilderParam | undefined,
): Promise<RawOrderOutcome> {
  const ex = new ExchangeClient({ transport: new HttpTransport({ isTestnet: true }), wallet: signer });
  try {
    const response = await ex.order({ orders: [wire], grouping: "na", ...(builder ? { builder: { b: builder.b, f: builder.f } } : {}) });
    return { response };
  } catch (e) {
    const resp = typeof e === "object" && e !== null && "response" in e ? (e as { response: unknown }).response : undefined;
    return { thrown: errText(e), response: resp };
  }
}

const textOf = (o: RawOrderOutcome): string => redact([o.thrown ?? "", o.response === undefined ? "" : JSON.stringify(o.response)].join(" ").trim());

// ───────────────────────────────────────────────────────────── self-checks (no network, no key)

async function selfChecks(r: Rec): Promise<void> {
  const expectRefusal = (label: string, fn: () => unknown): void => {
    try {
      fn();
      r.fail(`${label}: NOT refused`);
    } catch (e) {
      if (e instanceof Refusal) r.pass(`${label}: refused ("${e.message.slice(0, 70)}...")`);
      else r.fail(`${label}: wrong error ${errText(e)}`);
    }
  };
  const goodKey = generatePrivateKey();
  const goodBuilder = "0x1111111111111111111111111111111111111111";
  expectRefusal("HL_NETWORK=mainnet", () => assertSafeEnvironment({ HL_NETWORK: "mainnet", HL_TEST_PRIVATE_KEY: goodKey, HL_BUILDER_ADDRESS: goodBuilder }, { dryRun: false }));
  expectRefusal("HL_NETWORK unset", () => assertSafeEnvironment({ HL_TEST_PRIVATE_KEY: goodKey, HL_BUILDER_ADDRESS: goodBuilder }, { dryRun: true }));
  expectRefusal("missing HL_TEST_PRIVATE_KEY (live)", () => assertSafeEnvironment({ HL_NETWORK: "testnet", HL_BUILDER_ADDRESS: goodBuilder }, { dryRun: false }));
  expectRefusal("malformed key", () => assertSafeEnvironment({ HL_NETWORK: "testnet", HL_TEST_PRIVATE_KEY: "0x1234", HL_BUILDER_ADDRESS: goodBuilder }, { dryRun: false }));
  expectRefusal("missing HL_BUILDER_ADDRESS (live)", () => assertSafeEnvironment({ HL_NETWORK: "testnet", HL_TEST_PRIVATE_KEY: goodKey }, { dryRun: false }));
  expectRefusal("mainnet endpoint override", () =>
    assertSafeEnvironment({ HL_NETWORK: "testnet", HL_REST_URL: "https://api.hyperliquid.xyz", HL_TEST_PRIVATE_KEY: goodKey, HL_BUILDER_ADDRESS: goodBuilder }, { dryRun: false }),
  );
  expectRefusal("VITE_HL_NETWORK=mainnet", () =>
    assertSafeEnvironment({ HL_NETWORK: "testnet", VITE_HL_NETWORK: "mainnet", HL_TEST_PRIVATE_KEY: goodKey, HL_BUILDER_ADDRESS: goodBuilder }, { dryRun: false }),
  );
  expectRefusal("unknown flag", () => parseArgs(["--mainnet"]));
  expectRefusal("tiny --notional", () => parseArgs(["--notional", "3"]));

  try {
    const ok = assertSafeEnvironment({ HL_NETWORK: "testnet", HL_TEST_PRIVATE_KEY: goodKey, HL_BUILDER_ADDRESS: goodBuilder }, { dryRun: false });
    if (ok.feeTenthsBp === 100 && ok.builder === goodBuilder) r.pass("valid testnet environment accepted (fee defaults to 100)");
    else r.fail("valid environment parsed incorrectly");
  } catch (e) {
    r.fail(`valid environment rejected: ${errText(e)}`);
  }

  // Network guard: a mainnet request must be rejected locally, before any socket opens.
  try {
    await fetch("https://api.hyperliquid.xyz/info", { method: "POST", body: "{}" });
    r.fail("network guard let a mainnet request through");
  } catch (e) {
    if (e instanceof Refusal) r.pass("network guard blocks api.hyperliquid.xyz (rejected locally)");
    else r.fail(`network guard threw the wrong error: ${errText(e)}`);
  }

  // The Node wallet must produce signatures that recover to the signer, and refuse a chain mismatch.
  const acct = privateKeyToAccount(generatePrivateKey());
  const w = makeNodeWallet(acct);
  const typed = {
    domain: { name: "HyperliquidSignTransaction", version: "1", chainId: 421614, verifyingContract: "0x0000000000000000000000000000000000000000" },
    types: { "HyperliquidTransaction:ApproveBuilderFee": [{ name: "hyperliquidChain", type: "string" }, { name: "maxFeeRate", type: "string" }, { name: "builder", type: "address" }, { name: "nonce", type: "uint64" }] },
    primaryType: "HyperliquidTransaction:ApproveBuilderFee",
    message: { hyperliquidChain: "Testnet", maxFeeRate: "0.1%", builder: goodBuilder, nonce: 1 },
  };
  try {
    await w.provider.request({ method: "eth_signTypedData_v4", params: [acct.address, JSON.stringify(typed)] });
    r.fail("node wallet signed with a mismatched chain");
  } catch {
    r.pass("node wallet refuses typed-data whose chainId differs from the active chain (MetaMask behaviour)");
  }
  await ensureWalletChain(w.provider, "testnet");
  const sig = (await w.provider.request({ method: "eth_signTypedData_v4", params: [acct.address, JSON.stringify(typed)] })) as `0x${string}`;
  const recovered = await recoverTypedDataAddress({ domain: typed.domain, types: typed.types, primaryType: typed.primaryType, message: typed.message, signature: sig } as never);
  if (recovered.toLowerCase() === acct.address.toLowerCase()) r.pass("ensureWalletChain switched to 0x66eee and the signature recovers to the signer");
  else r.fail("signature did not recover to the signer");

  // Wiring check of the real setup.ts code path, with a stub exchange (no network).
  hlSession.getState().patch({ network: "testnet", address: acct.address.toLowerCase() as Address, status: "needs-agent" });
  const captured: Array<{ agentAddress: string; agentName?: string }> = [];
  await approveAgentStep({
    provider: w.provider,
    vault: createMemoryVault(),
    ensureChain: () => Promise.resolve(TESTNET_SIG_CHAIN),
    exchangeFactory: () =>
      ({
        approveAgent: (p: { agentAddress: string; agentName?: string }) => (captured.push(p), Promise.resolve({ status: "ok", response: { type: "default" } })),
        approveBuilderFee: () => Promise.resolve({ status: "ok", response: { type: "default" } }),
      }) as never,
  });
  const c0 = captured[0];
  if (c0 && /^OpenBroker valid_until \d{13}$/.test(c0.agentName ?? "") && hlSession.getState().agent?.address === c0.agentAddress) {
    r.pass(`setup.ts approveAgentStep ran under Node (agentName="${c0.agentName}")`);
  } else r.fail("approveAgentStep wiring check failed");
  r.info(`approveBuilderFee maxFeeRate for fee 100 would be "${getMaxFeeRateString({ VITE_HL_BUILDER_FEE: "100" })}"`);
  hlSession.getState().patch({ address: null, agent: null, status: "disconnected" });
}

// ───────────────────────────────────────────────────────────── main

interface Ctx {
  main: PrivateKeyAccount;
  builder: BuilderParam;
  feeStr: string;
  notional: number;
  trading: ReturnType<typeof createHyperliquidTrading>;
  registry: ReturnType<typeof createMarketRegistry>;
  info: ReturnType<typeof createInfoClient>;
  sdkInfo: ReturnType<typeof createInfoApi>;
}
const touchedCoins = new Set<string>();

type RawFill = { coin: string; px: string; sz: string; oid: number; time: number; fee?: string; builderFee?: string; dir?: string; closedPnl?: string; crossed?: boolean };
async function fillsSince(user: string, sinceMs: number, oid?: number, waitMs = 12_000): Promise<RawFill[]> {
  const until = Date.now() + waitMs;
  for (;;) {
    const fills = await rawInfo<RawFill[]>({ type: "userFillsByTime", user, startTime: Math.max(0, sinceMs - 2000) });
    const mine = oid === undefined ? fills : fills.filter((f) => f.oid === oid);
    if (mine.length > 0 || Date.now() > until) return mine;
    await sleep(1000);
  }
}

function sizeFor(mid: number, szDecimals: number, usd: number): number {
  const scale = 10 ** szDecimals;
  return Math.ceil((usd / mid) * scale) / scale;
}

async function midOf(ctx: Ctx, coin: string, dex: string): Promise<number> {
  const mids = await ctx.info.allMids(dex || undefined);
  return num(mids[coin]);
}

async function dumpOpenOrders(user: string): Promise<Array<Record<string, unknown>>> {
  const dexes = ["", ...((await rawInfo<Array<{ name: string } | null>>({ type: "perpDexs" })).filter((d): d is { name: string } => d !== null).map((d) => d.name))];
  const all: Array<Record<string, unknown>> = [];
  for (const dex of dexes) {
    const rows = await rawInfo<Array<Record<string, unknown>>>({ type: "frontendOpenOrders", user, ...(dex ? { dex } : {}) }).catch(() => []);
    all.push(...rows.map((r) => ({ ...r, _dex: dex })));
  }
  return all;
}

async function analyseBuilderFee(r: Rec, ctx: Ctx, label: string, user: string, sinceMs: number, oid: number): Promise<{ builderFee: number; notional: number; ok: boolean }> {
  const fills = await fillsSince(user, sinceMs, oid);
  if (fills.length === 0) {
    r.fail(`${label}: no fills found for oid ${oid}`);
    return { builderFee: 0, notional: 0, ok: false };
  }
  const notional = fills.reduce((s, f) => s + num(f.px) * num(f.sz), 0);
  const builderFee = fills.reduce((s, f) => s + num(f.builderFee), 0);
  const fee = fills.reduce((s, f) => s + num(f.fee), 0);
  const present = fills.some((f) => f.builderFee !== undefined);
  const exp = expectedBuilderFee(notional, ctx.builder.f);
  const ok = present && builderFeeMatches(builderFee, notional, ctx.builder.f);
  r.data(`${label}.fills`, fills.map((f) => ({ coin: f.coin, px: f.px, sz: f.sz, fee: f.fee, builderFee: f.builderFee, dir: f.dir, closedPnl: f.closedPnl })));
  r.data(`${label}.notional`, notional);
  r.data(`${label}.expectedBuilderFee`, exp);
  r.data(`${label}.actualBuilderFee`, builderFee);
  if (!present) r.fail(`${label}: fill has NO builderFee field (fields: ${Object.keys(fills[0] ?? {}).join(",")})`);
  else if (ok) r.pass(`${label}: builderFee ${builderFee} ~= notional ${notional.toFixed(4)} * ${ctx.builder.f}/100000 = ${exp.toFixed(6)}`);
  else r.fail(`${label}: builderFee ${builderFee} does not match expected ${exp.toFixed(6)} (notional ${notional.toFixed(4)})`);
  r.info(`${label}: exchange fee ${fee} (closedPnl field is gross of fees: ${fills.map((f) => f.closedPnl).join(",")})`);
  return { builderFee, notional, ok };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    out("usage: HL_NETWORK=testnet HL_TEST_PRIVATE_KEY=0x.. HL_BUILDER_ADDRESS=0x.. npx tsx scripts/hl-testnet-verify.mts [--report file.json] [--dry-run] [--notional 12] [--skip-hip3] [--keep-funds]");
    return;
  }
  const env = assertSafeEnvironment(process.env, { dryRun: args.dryRun });
  installNetworkGuard();
  hlSession.getState().patch({ network: "testnet" });

  const startedAt = new Date().toISOString();
  const main_ = env.key ? privateKeyToAccount(env.key) : undefined;
  const builder: BuilderParam = { b: env.builder ?? ("0x000000000000000000000000000000000000dEaD".toLowerCase() as Address), f: env.feeTenthsBp };
  const feeStr = getMaxFeeRateString({ VITE_HL_BUILDER_FEE: String(env.feeTenthsBp) });
  const base = {
    startedAt,
    network: "testnet",
    dryRun: args.dryRun,
    config: { builderAddress: builder.b, builderFeeTenthsBp: builder.f, maxFeeRate: feeStr, notionalUsd: args.notional },
    mainAddress: main_?.address.toLowerCase() ?? null,
  };
  out(`OpenBroker Hyperliquid TESTNET verification ${args.dryRun ? "(DRY RUN)" : ""}`);
  out(`builder ${builder.b} fee ${builder.f} (maxFeeRate ${feeStr}); main ${base.mainAddress ?? "n/a"}`);

  const info = createInfoClient({ baseUrl: TESTNET_REST });
  const registry = createMarketRegistry(args.allDexes ? info : restrictDexes(info, new Set(args.dexes)));
  const sdkInfo = createInfoApi("testnet");

  if (args.dryRun) {
    await step("0", "Self-checks: refusals, network guard, wallet path, setup.ts wiring", selfChecks);
  }

  // ── 1. public checks
  await step("1", "Public: perpDexs / meta / HIP-3 markets on testnet", async (r) => {
    const dexes = await info.perpDexs();
    const names = dexes.filter((d): d is NonNullable<typeof d> => d !== null).map((d) => d.name);
    r.data("hip3Dexes", names);
    if (names.length > 0) r.pass(`${names.length} HIP-3 dex(es) on testnet: ${names.slice(0, 25).join(", ")}${names.length > 25 ? ", ..." : ""}`);
    else r.info("no HIP-3 dexes on testnet: HIP-3 trading/fee questions cannot be answered here");
    const core = await info.meta();
    r.data("coreAssets", core.universe.length);
    if (core.universe.some((a) => a.name === "BTC")) r.pass(`core meta ok: ${core.universe.length} assets incl. BTC`);
    else r.fail("core meta has no BTC");
    await registry.load();
    r.data("loadedDexes", args.allDexes ? "all" : args.dexes);
    if (!args.allDexes) r.info(`registry limited to dexes [${args.dexes.join(", ")}] (use --dexes/--all-dexes to change); ${names.length} exist on testnet`);
    const markets = registry.markets();
    const byCat: Record<string, number> = {};
    for (const m of markets) byCat[m.category] = (byCat[m.category] ?? 0) + 1;
    r.data("marketsByCategory", byCat);
    r.info(`registry: ${markets.length} markets ${JSON.stringify(byCat)}`);
    const nonCrypto = markets.filter((m) => m.dex !== "" && m.category !== "Crypto");
    r.data("hip3NonCryptoMarkets", nonCrypto.slice(0, 40).map((m) => ({ symbol: m.symbol, category: m.category, assetId: m.assetId, maxLeverage: m.maxLeverage, onlyIsolated: m.onlyIsolated, marginMode: m.marginMode })));
    findings.testnetHasNonCryptoHip3 = nonCrypto.length > 0;
    if (nonCrypto.length > 0) r.pass(`${nonCrypto.length} non-crypto HIP-3 markets exist (e.g. ${nonCrypto.slice(0, 5).map((m) => m.symbol).join(", ")})`);
    else r.info("NO non-crypto HIP-3 markets on testnet: step 4h will be skipped");
    const probe = [...new Set(["xyz", ...args.dexes])].filter((d) => names.includes(d)).slice(0, 3);
    for (const dex of probe) {
      await sleep(400);
      const mids = await info.allMids(dex).catch((e: unknown) => {
        r.info(`allMids({dex:"${dex}"}) failed: ${errText(e)}`);
        return {} as Record<string, string>;
      });
      const keys = Object.keys(mids).slice(0, 4);
      if (keys.length === 0) continue;
      r.data(`allMids.${dex}.sampleKeys`, keys);
      r.info(`allMids({dex:"${dex}"}) keys: ${keys.join(", ")} (checklist: keys are prefixed "${dex}:")`);
      findings[`allMidsKeysPrefixed.${dex}`] = keys.length > 0 && keys.every((k) => k.startsWith(`${dex}:`));
    }
    const btc = registry.bySymbol("BTC");
    if (btc) r.info(`BTC assetId=${btc.assetId} szDecimals=${btc.szDecimals} maxLeverage=${btc.maxLeverage}`);
  });

  if (args.dryRun || !main_ || !env.builder) {
    skip("2-9", "Signing and trading steps", args.dryRun ? "dry run: no key, no signing, no orders" : "not available");
    writeReport(args.report, base);
    process.exit(steps.some((s) => s.status === "FAIL") ? 1 : 0);
  }
  if (!main_ || !env.builder) throw new Refusal("unreachable: key and builder are validated above");

  // ── live (non-dry-run) from here on
  const user = main_.address.toLowerCase() as Address;
  const wallet = makeNodeWallet(main_);
  const vault = createMemoryVault();
  hlSession.getState().patch({ network: "testnet", address: user, agent: null, status: "needs-agent", error: null, approvedBuilderFee: null });
  const trading = createHyperliquidTrading({ registry, getBuilder: () => builder, defaultLeverage: 3, sleep });
  const ctx: Ctx = { main: main_, builder, feeStr, notional: args.notional, trading, registry, info, sdkInfo };
  let fundedB: PrivateKeyAccount | undefined;

  try {
    await step("pre", "Account state before trading", async (r) => {
      const ch = await sdkInfo.clearinghouseState({ user });
      const spot = await sdkInfo.spotClearinghouseState({ user }).catch(() => null);
      const abstraction = await sdkInfo.userAbstraction({ user }).catch((e: unknown) => `error: ${errText(e)}`);
      const av = num(ch.marginSummary.accountValue);
      const spotUsdc = num(spot?.balances.find((b) => b.coin === "USDC")?.total);
      r.data("perpsAccountValue", av);
      r.data("spotUsdc", spotUsdc);
      r.data("userAbstraction", abstraction);
      r.info(`perps accountValue=$${av}, spot USDC=$${spotUsdc}, userAbstraction=${JSON.stringify(abstraction)}`);
      if (av + spotUsdc < 40) r.fail("account holds < $40 on testnet: fund it from the faucet (docs/TESTNET_CHECKLIST.md) and re-run");
      else r.pass("account is funded");
      findings.userAbstraction = abstraction;
    });
    if (steps.at(-1)?.status === "FAIL") throw new Refusal("account not funded; nothing was opened");

    // ── 2. approveAgent (real setup.ts code path)
    await step("2", "approveAgent with a fresh agent key (setup.ts approveAgentStep) + extraAgents", async (r) => {
      await approveAgentStep({ provider: wallet.provider, vault });
      const cred = hlSession.getState().agent;
      if (!cred) throw new Error("agent credential missing after approveAgentStep");
      r.data("signingLog", wallet.log);
      if (wallet.log.some((l) => l.method === "wallet_switchEthereumChain")) r.pass("wallet was asked to switch to 0x66eee before signing");
      else r.fail("no chain switch requested");
      let listed: Array<{ address: string; name: string; validUntil: number | null }> = [];
      for (let i = 0; i < 6 && !listed.some((a) => a.address.toLowerCase() === cred.address); i++) {
        listed = (await sdkInfo.extraAgents({ user })) as typeof listed;
        if (!listed.some((a) => a.address.toLowerCase() === cred.address)) await sleep(800);
      }
      const hit = listed.find((a) => a.address.toLowerCase() === cred.address);
      r.data("extraAgents", listed);
      if (hit) r.pass(`extraAgents lists the new agent: name="${hit.name}" validUntil=${hit.validUntil}`);
      else r.fail("extraAgents does NOT list the approved agent");
      findings.extraAgentsEntry = hit ?? null;
      if (hit) {
        if (hit.validUntil && Math.abs(hit.validUntil - cred.validUntil) < 60_000) r.pass("extraAgents.validUntil matches the requested expiry");
        else r.info(`validUntil differs from requested (${cred.validUntil}) -> ${hit.validUntil}: update resolve.ts expiry check`);
      }
    });
    const agent = hlSession.getState().agent;
    if (!agent) throw new Refusal("no agent; cannot continue");

    await step("2b", "Agent renewal: does a second approval replace the first?", async (r) => {
      const before = agent.address;
      await sleep(1100); // the agent name embeds validUntil (ms); keep it distinct
      await approveAgentStep({ provider: wallet.provider, vault });
      const cred = hlSession.getState().agent;
      if (!cred || cred.address === before) throw new Error("renewal did not produce a new agent");
      await sleep(1000);
      const listed = (await sdkInfo.extraAgents({ user })) as Array<{ address: string; name: string; validUntil: number | null }>;
      const oldStill = listed.some((a) => a.address.toLowerCase() === before);
      const newIn = listed.some((a) => a.address.toLowerCase() === cred.address);
      r.data("extraAgentsAfterRenewal", listed);
      findings.renewalReplacesOld = !oldStill;
      if (newIn) r.pass("new agent listed");
      else r.fail("new agent not listed after renewal");
      if (!oldStill) r.pass("old agent no longer listed: renewal REPLACES (agent name suffix is ignored for matching)");
      else r.info("old agent STILL listed: agents pile up on renewal. Fix: setup.ts approveAgentStep name strategy (stable name without valid_until?) or revoke old");
    });
    const liveAgent = hlSession.getState().agent;
    if (!liveAgent) throw new Refusal("no agent after renewal");

    // ── 3. approveBuilderFee (replicates approveBuilderStep; see header)
    await step("3", "approveBuilderFee with maxFeeRate from config + maxBuilderFee", async (r) => {
      const chainId = await ensureWalletChain(wallet.provider, "testnet");
      const ex = createUserExchange(wallet.provider, user, "testnet", chainId);
      await ex.approveBuilderFee({ builder: builder.b, maxFeeRate: feeStr });
      let approved = -1;
      for (let i = 0; i < 6 && approved < builder.f; i++) {
        approved = await sdkInfo.maxBuilderFee({ user, builder: builder.b });
        if (approved < builder.f) await sleep(800);
      }
      r.data("maxBuilderFee", approved);
      if (approved >= builder.f) r.pass(`maxBuilderFee = ${approved} (>= configured ${builder.f}) after approving "${feeStr}"`);
      else r.fail(`maxBuilderFee = ${approved}, expected >= ${builder.f}`);
      hlSession.getState().patch({ status: "ready", approvedBuilderFee: approved, agent: liveAgent });
    });
    hlSession.getState().patch({ status: "ready", agent: liveAgent });

    // ── 4. BTC order with builder, assert builderFee in fills
    let btcSz = 0;
    await step("4", "Market order on BTC via createHyperliquidTrading, builder fee in fills", async (r) => {
      await registry.load();
      const m = registry.bySymbol("BTC");
      if (!m) throw new Error("BTC market missing");
      const mid = await midOf(ctx, "BTC", "");
      const qty = sizeFor(mid, m.szDecimals, args.notional);
      btcSz = qty;
      touchedCoins.add("BTC");
      const t0 = Date.now();
      const order = await trading.placeOrder({ accountId: user, symbol: "BTC", side: "BUY", type: "MARKET", quantity: qty });
      r.data("order", order);
      r.info(`placed BTC buy ${qty} @ mid ${mid}: status=${order.status} id=${order.id}`);
      const res = await analyseBuilderFee(r, ctx, "btcOpen", user, t0, Number(order.id));
      findings.builderFeeAppliesToCrypto = res.ok;
      const lev = await trading.getLeverage("BTC");
      r.info(`leverage after first order: ${JSON.stringify(lev)} (default heuristics expect 3x cross)`);
      r.data("leverage", lev);
    });

    // ── 7. positionTpsl size handling (needs the open BTC position)
    await step("7", "positionTpsl: size handling on an open position", async (r) => {
      const mid = await midOf(ctx, "BTC", "");
      const pos = await trading.modifyPosition("BTC", { takeProfit: Number(formatPx(mid * 1.3, 5)), stopLoss: Number(formatPx(mid * 0.7, 5)) });
      r.info(`modifyPosition returned TP=${pos.takeProfit} SL=${pos.stopLoss}`);
      await sleep(800);
      const orders = (await dumpOpenOrders(user)).filter((o) => o.coin === "BTC");
      r.data("btcOpenOrders", orders);
      const trig = orders.filter((o) => o.isTrigger === true);
      if (trig.length >= 2) r.pass(`${trig.length} trigger orders resting`);
      else r.fail(`expected TP and SL trigger orders, found ${trig.length}`);
      for (const o of trig) r.info(`trigger ${String(o.orderType)}: sz=${String(o.sz)} origSz=${String(o.origSz)} reduceOnly=${String(o.reduceOnly)} isPositionTpsl=${String(o.isPositionTpsl)}`);
      findings.positionTpslOrderShape = trig.map((o) => ({ orderType: o.orderType, sz: o.sz, origSz: o.origSz, reduceOnly: o.reduceOnly, isPositionTpsl: o.isPositionTpsl }));
      const sizes = new Set(trig.map((o) => String(o.sz)));
      findings.positionTpslSizeIsFull = trig.length > 0 && [...sizes].every((s) => num(s) === btcSz);
      r.info(`TP/SL sz equals the position size (${btcSz})? ${String(findings.positionTpslSizeIsFull)} (checklist: size "0" vs full)`);
    });

    // ── 5. partial reduce-only below $10, then full close
    await step("5", "Reduce-only below $10 accepted; close position; TP/SL follow?", async (r) => {
      const m = registry.bySymbol("BTC");
      if (!m) throw new Error("BTC market missing");
      const mid = await midOf(ctx, "BTC", "");
      const small = Math.max(1 / 10 ** m.szDecimals, Number(formatSz((6 / mid), m.szDecimals)));
      const t0 = Date.now();
      try {
        await trading.closePosition("BTC", small);
        r.pass(`reduce-only close of ${small} BTC (~$${(small * mid).toFixed(2)} < $${MIN_ORDER_NOTIONAL_USD}) was ACCEPTED`);
        findings.reduceOnlyBelowMinAccepted = true;
      } catch (e) {
        r.fail(`reduce-only below $10 REJECTED: ${errText(e)} (checklist: orders.ts MIN_ORDER_NOTIONAL_USD handling / closeWire)`);
        findings.reduceOnlyBelowMinAccepted = false;
      }
      const fills = await fillsSince(user, t0);
      r.info(`partial close fills: ${JSON.stringify(fills.map((f) => ({ sz: f.sz, fee: f.fee, builderFee: f.builderFee, dir: f.dir, closedPnl: f.closedPnl })))}`);
      const orders = (await dumpOpenOrders(user)).filter((o) => o.coin === "BTC" && o.isTrigger === true);
      findings.positionTpslAfterPartialClose = orders.map((o) => ({ orderType: o.orderType, sz: o.sz }));
      r.info(`TP/SL sizes after partial close: ${orders.map((o) => String(o.sz)).join(", ")} (full position was ${btcSz})`);
      const t1 = Date.now();
      await trading.cancelAllOrders();
      await trading.closePosition("BTC");
      const closeFills = await fillsSince(user, t1);
      const bf = closeFills.reduce((s, f) => s + num(f.builderFee), 0);
      const notional = closeFills.reduce((s, f) => s + num(f.px) * num(f.sz), 0);
      r.data("closeFills", closeFills);
      if (bf > 0 && builderFeeMatches(bf, notional, builder.f)) r.pass(`closing fill carries builderFee ${bf} (fees are charged on close too)`);
      else r.fail(`closing fill builderFee ${bf} vs expected ~${expectedBuilderFee(notional, builder.f).toFixed(6)}`);
      const ch = await sdkInfo.clearinghouseState({ user });
      const left = ch.assetPositions.filter((p) => num(p.position.szi) !== 0);
      if (left.length === 0) r.pass("core dex is flat");
      else r.fail(`position(s) still open: ${left.map((p) => p.position.coin).join(",")}`);
    });

    // ── 6. modify keeps builder fee semantics?
    await step("6", "modify: does a modified order keep builder-fee semantics / oid?", async (r) => {
      const m = registry.bySymbol("BTC");
      if (!m) throw new Error("BTC market missing");
      const mid = await midOf(ctx, "BTC", "");
      const qty = sizeFor(mid, m.szDecimals, args.notional);
      const farPx = Number(formatPx(mid * 0.8, m.szDecimals));
      touchedCoins.add("BTC");
      const placed = await trading.placeOrder({ accountId: user, symbol: "BTC", side: "BUY", type: "LIMIT", quantity: qty, price: farPx });
      r.info(`resting Gtc buy ${qty} @ ${farPx} (mid ${mid}): status=${placed.status} id=${placed.id}`);
      if (placed.status !== "PENDING") r.fail(`expected a resting order, got ${placed.status}`);
      // 1) harmless modify (still resting)
      const farPx2 = Number(formatPx(mid * 0.81, m.szDecimals));
      const m1 = await trading.modifyOrder(placed.id, { price: farPx2 });
      r.info(`after price-only modify: id=${m1.id} (was ${placed.id}), price=${String(m1.price)}`);
      findings.modifyChangesOid = m1.id !== placed.id;
      // 2) modify to be marketable: it takes. Does the resulting fill carry builderFee?
      const t0 = Date.now();
      const cross = Number(formatPx(mid * 1.02, m.szDecimals));
      let m2: Awaited<ReturnType<typeof trading.modifyOrder>> | null = null;
      try {
        m2 = await trading.modifyOrder(m1.id, { price: cross });
        r.info(`after marketable modify: id=${m2.id} status=${m2.status}`);
      } catch (e) {
        r.fail(`marketable modify failed: ${errText(e)}`);
      }
      const fills = await fillsSince(user, t0);
      r.data("modifyFills", fills);
      if (fills.length === 0) r.fail("modified order produced no fill; cannot judge builder fee");
      else {
        const bf = fills.reduce((s, f) => s + num(f.builderFee), 0);
        const notional = fills.reduce((s, f) => s + num(f.px) * num(f.sz), 0);
        const kept = bf > 0 && builderFeeMatches(bf, notional, builder.f);
        findings.modifyKeepsBuilderFee = kept;
        if (kept) r.pass(`fill from a MODIFIED order carries builderFee ${bf}: modify keeps the builder`);
        else r.info(`fill from a MODIFIED order has builderFee=${bf} (expected ~${expectedBuilderFee(notional, builder.f).toFixed(6)}): modify DROPS the builder -> trading.ts modifyOrder must cancel+replace, or accept a free fill (docs/FEES.md)`);
      }
      await trading.cancelAllOrders();
      try {
        await trading.closePosition("BTC");
      } catch (e) {
        r.info(`close after modify test: ${errText(e)}`);
      }
    });

    // ── 4h. HIP-3 market (does the builder fee apply?)
    if (args.skipHip3) skip("4h", "HIP-3 market order and builder fee", "--skip-hip3");
    else {
      await step("4h", "Market order on a HIP-3 market: does the builder fee apply?", async (r) => {
        // Prefer the mainstream dex (xyz), then any non-crypto market; testnet has hundreds of junk dexes.
        const rank = (m: { dex: string; category: string }): number => (m.dex === "xyz" ? 0 : 2) + (m.category === "Crypto" ? 1 : 0);
        const cands = registry.markets().filter((m) => m.dex !== "").sort((a, b) => rank(a) - rank(b));
        let chosen: (typeof cands)[number] | undefined;
        let mid = 0;
        const tried = new Set<string>();
        for (const m of cands) {
          if (tried.has(m.dex)) continue;
          tried.add(m.dex);
          if (tried.size > 12) break;
          await sleep(350);
          mid = await midOf(ctx, m.coin, m.dex).catch(() => 0);
          if (mid > 0) {
            chosen = m;
            break;
          }
        }
        if (!chosen) {
          r.info("no tradable HIP-3 market with a live mid on testnet: question stays OPEN");
          findings.builderFeeAppliesToHip3 = null;
          return;
        }
        r.info(`using ${chosen.symbol} (${chosen.category}) assetId=${chosen.assetId} mid=${mid} onlyIsolated=${chosen.onlyIsolated} marginMode=${chosen.marginMode ?? "-"}`);
        touchedCoins.add(chosen.symbol);
        const qty = sizeFor(mid, chosen.szDecimals, args.notional);
        const t0 = Date.now();
        let order;
        try {
          order = await trading.placeOrder({ accountId: user, symbol: chosen.symbol, side: "BUY", type: "MARKET", quantity: qty });
        } catch (e) {
          r.info(`first attempt failed: ${errText(e)}`);
          findings.hip3FirstOrderError = errText(e);
          // Standard accounts must fund the dex's collateral first (checklist: sendAsset USDC to the dex).
          const ex = new ExchangeClient({ transport: new HttpTransport({ isTestnet: true }), wallet: main_, signatureChainId: TESTNET_SIG_CHAIN });
          try {
            const spotMeta = await new SdkInfoClient({ transport: new HttpTransport({ isTestnet: true }) }).spotMeta();
            const usdc = spotMeta.tokens.find((t) => t.name === "USDC");
            if (!usdc) throw new Error("USDC token not found in spotMeta");
            const res = await ex.sendAsset({ destination: user, sourceDex: "", destinationDex: chosen.dex, token: `USDC:${usdc.tokenId}`, amount: String(Math.ceil(args.notional / 2)) });
            r.info(`sendAsset USDC -> dex "${chosen.dex}": ${JSON.stringify(res)}`);
            findings.sendAssetToDex = { ok: true };
            await sleep(1500);
            order = await trading.placeOrder({ accountId: user, symbol: chosen.symbol, side: "BUY", type: "MARKET", quantity: qty });
          } catch (e2) {
            findings.sendAssetToDex = { ok: false, error: errText(e2) };
            r.fail(`HIP-3 order still failing after sendAsset attempt: ${errText(e2)}`);
            return;
          }
        }
        r.data("order", order);
        const res = await analyseBuilderFee(r, ctx, "hip3Open", user, t0, Number(order.id));
        findings.builderFeeAppliesToHip3 = res.ok;
        if (res.ok) r.pass("ANSWER: the builder fee APPLIES to HIP-3 markets");
        else r.info("ANSWER: builder fee did NOT (fully) apply on this HIP-3 market: update docs/FEES.md and the fee disclosure for HIP-3");
        const allMids = await info.allMids(chosen.dex);
        findings.hip3AllMidsKeyPrefixed = Object.keys(allMids).every((k) => k.startsWith(`${chosen.dex}:`));
        await trading.closePosition(chosen.symbol);
        const ch = await sdkInfo.clearinghouseState({ user, dex: chosen.dex });
        const left = ch.assetPositions.filter((p) => num(p.position.szi) !== 0);
        if (left.length === 0) r.pass(`${chosen.symbol} closed`);
        else r.fail(`${chosen.symbol} still open`);
      });
    }

    // ── 8. exact error strings
    await step("8a", "Min order value: exact exchange error for a ~$5 order", async (r) => {
      const m = registry.bySymbol("BTC");
      if (!m) throw new Error("BTC market missing");
      const mid = await midOf(ctx, "BTC", "");
      const qty = sizeFor(mid, m.szDecimals, 5);
      touchedCoins.add("BTC");
      const o = await rawOrder(liveAgent.account, { a: m.assetId, b: true, p: slippagePx(mid, true, 0.03, m.szDecimals), s: formatSz(qty, m.szDecimals), r: false, t: { limit: { tif: "Ioc" } } }, builder);
      const text = textOf(o);
      findings.minOrderValueErrorRaw = text;
      r.data("raw", o);
      r.info(`raw: ${text}`);
      const humanized = humanizeHlError(text);
      findings.minOrderValueHumanized = humanized;
      const ruleHit = /\$10 minimum/.test(humanized);
      findings.minOrderValueRuleMatches = ruleHit;
      if (/minimum|min.*value|10/i.test(text)) r.pass("exchange rejected a ~$5 order for value");
      else r.fail("did not see a minimum-value rejection (order may have been ACCEPTED: cleanup will close it)");
      if (ruleHit) r.pass('orders.ts ERROR_RULES matches this text ("...$10 minimum")');
      else r.fail(`orders.ts humanizeHlError does NOT map this text -> "${humanized}". Add its wording to ERROR_RULES in src/hyperliquid/orders.ts`);
    });

    await step("8b", "Builder fee NOT approved: exact exchange error (second fresh account)", async (r) => {
      const keyB = privateKeyToAccount(generatePrivateKey());
      const keyC = privateKeyToAccount(generatePrivateKey());
      fundedB = keyB;
      const m = registry.bySymbol("BTC");
      if (!m) throw new Error("BTC market missing");
      const mid = await midOf(ctx, "BTC", "");
      // Fund B from A (testnet funds only) so the order reaches the builder-fee check.
      let funded = false;
      try {
        const exA = new ExchangeClient({ transport: new HttpTransport({ isTestnet: true }), wallet: main_, signatureChainId: TESTNET_SIG_CHAIN });
        const res = await exA.usdSend({ destination: keyB.address, amount: String(Math.ceil(args.notional + 3)) });
        funded = true;
        r.info(`funded account B with usdSend: ${JSON.stringify(res)}`);
        await sleep(1500);
      } catch (e) {
        r.info(`could not fund account B (${errText(e)}); the error below may be an "account does not exist" text instead of the builder one`);
      }
      r.data("accountBFunded", funded);
      const exB = new ExchangeClient({ transport: new HttpTransport({ isTestnet: true }), wallet: keyB, signatureChainId: TESTNET_SIG_CHAIN });
      try {
        await exB.approveAgent({ agentAddress: keyC.address, agentName: "OpenBroker" });
      } catch (e) {
        r.info(`approveAgent for B failed: ${errText(e)}`);
      }
      await sleep(800);
      const qty = sizeFor(mid, m.szDecimals, args.notional);
      const o = await rawOrder(keyC, { a: m.assetId, b: true, p: slippagePx(mid, true, 0.03, m.szDecimals), s: formatSz(qty, m.szDecimals), r: false, t: { limit: { tif: "Ioc" } } }, builder);
      const text = textOf(o);
      findings.builderNotApprovedErrorRaw = text;
      r.data("raw", o);
      r.info(`raw: ${text}`);
      const isApproval = isBuilderFeeApprovalError(text);
      findings.isBuilderFeeApprovalErrorMatches = isApproval;
      findings.builderNotApprovedHumanized = humanizeHlError(text);
      if (isApproval) r.pass("feeConfig.ts isBuilderFeeApprovalError() recognises the real text");
      else r.fail("isBuilderFeeApprovalError() does NOT recognise this text -> update the regexes in src/hyperliquid/feeConfig.ts");
      if (/hasn't been approved|trading fee/.test(humanizeHlError(text))) r.pass("orders.ts humanizeHlError maps it to the 'fee hasn't been approved' message");
      else r.fail(`humanizeHlError gives "${humanizeHlError(text)}": add the wording to ERROR_RULES (src/hyperliquid/orders.ts)`);
      // Extra: approve a LOWER fee than we send, to see the 'exceeds max' wording.
      if (funded && builder.f > 1) {
        try {
          await exB.approveBuilderFee({ builder: builder.b, maxFeeRate: `${((builder.f - 1) / 1000).toString()}%` });
          await sleep(800);
          const o2 = await rawOrder(keyC, { a: m.assetId, b: true, p: slippagePx(mid, true, 0.03, m.szDecimals), s: formatSz(qty, m.szDecimals), r: false, t: { limit: { tif: "Ioc" } } }, builder);
          findings.builderFeeAboveApprovedErrorRaw = textOf(o2);
          findings.isBuilderFeeApprovalErrorMatchesAboveMax = isBuilderFeeApprovalError(textOf(o2));
          r.info(`raw (approved ${builder.f - 1}, sent ${builder.f}): ${textOf(o2)}`);
          if (findings.isBuilderFeeApprovalErrorMatchesAboveMax) r.pass("'fee above approved max' text is recognised too");
          else r.fail("'fee above approved max' text NOT recognised by isBuilderFeeApprovalError()");
        } catch (e) {
          r.info(`lower-approval probe failed: ${errText(e)}`);
        }
      }
    });

    // ── 9. agent cannot withdraw
    await step("9", "An agent key cannot withdraw (withdraw3 signed by the agent)", async (r) => {
      const ex = new ExchangeClient({ transport: new HttpTransport({ isTestnet: true }), wallet: liveAgent.account, signatureChainId: TESTNET_SIG_CHAIN });
      try {
        const res = await ex.withdraw3({ destination: user, amount: "2" });
        r.fail(`withdraw3 signed by the AGENT was accepted: ${JSON.stringify(res)} (SECURITY: stop and investigate)`);
        findings.agentCanWithdraw = true;
      } catch (e) {
        const text = errText(e) + (typeof e === "object" && e !== null && "response" in e ? " " + redact(JSON.stringify((e as { response: unknown }).response)) : "");
        findings.agentCanWithdraw = false;
        findings.agentWithdrawErrorRaw = text;
        r.pass(`agent withdraw refused: ${text.slice(0, 160)}`);
        r.info(`humanizeError (wallet/errors.ts) renders it as: "${humanizeError(new Error(text))}"`);
      }
    });
  } catch (e) {
    out(`\n${tag("FAIL")} run aborted: ${errText(e)}`);
    steps.push({ id: "abort", title: "Run aborted", status: "FAIL", checks: [{ status: "FAIL", message: errText(e) }], data: {}, ms: 0 });
  } finally {
    await cleanup(ctx, user, fundedB, args.keepFunds);
    trading.dispose();
    writeReport(args.report, base);
  }
  process.exit(steps.some((s) => s.status === "FAIL") ? 1 : 0);
}

/** Cancel everything and flatten every position on the throwaway account; return account B's funds. */
async function cleanup(ctx: Ctx, user: Address, accountB: PrivateKeyAccount | undefined, keepFunds: boolean): Promise<void> {
  out("\n== cleanup");
  try {
    if (hlSession.getState().status === "ready") {
      await ctx.trading.cancelAllOrders();
      cleanupLog.push("cancelAllOrders ok");
      try {
        await ctx.trading.closeAllPositions();
        cleanupLog.push("closeAllPositions ok");
      } catch (e) {
        cleanupLog.push(`closeAllPositions: ${errText(e)}`);
      }
    } else cleanupLog.push("session not ready: nothing to clean through the gateway");
    const left: string[] = [];
    const dexes = ["", ...ctx.registry.markets().map((m) => m.dex).filter((d, i, a) => d !== "" && a.indexOf(d) === i)];
    for (const dex of dexes) {
      const ch = await ctx.sdkInfo.clearinghouseState({ user, ...(dex ? { dex } : {}) } as never).catch(() => null);
      for (const p of ch?.assetPositions ?? []) if (num(p.position.szi) !== 0) left.push(p.position.coin);
    }
    const orders = await dumpOpenOrders(user).catch(() => []);
    cleanupLog.push(`remaining positions: [${left.join(",")}], open orders: ${orders.length}`);
    if (left.length > 0 || orders.length > 0) out(`  ${tag("FAIL")} account NOT flat: positions ${left.join(",") || "-"}, open orders ${orders.length}. Close them manually on testnet.`);
    else out(`  ${tag("PASS")} account is flat, no open orders`);
  } catch (e) {
    cleanupLog.push(`cleanup error: ${errText(e)}`);
    out(`  ${tag("FAIL")} cleanup error: ${errText(e)}`);
  }
  if (accountB && !keepFunds) {
    try {
      const ch = await ctx.sdkInfo.clearinghouseState({ user: accountB.address });
      const amt = Math.floor(num(ch.withdrawable) * 100) / 100;
      if (amt >= 1) {
        const ex = new ExchangeClient({ transport: new HttpTransport({ isTestnet: true }), wallet: accountB, signatureChainId: TESTNET_SIG_CHAIN });
        await ex.usdSend({ destination: user, amount: String(amt) });
        cleanupLog.push(`returned $${amt} from account B`);
      }
    } catch (e) {
      cleanupLog.push(`return funds from B: ${errText(e)}`);
    }
  }
}

const isEntry = process.argv[1] !== undefined && /hl-testnet-verify\.mts$/.test(process.argv[1].replace(/\\/g, "/"));
if (isEntry) {
  main().catch((e: unknown) => {
    if (e instanceof Refusal) {
      console.error(`REFUSED: ${e.message}`);
      process.exit(2);
    }
    console.error(`FATAL: ${errText(e)}`);
    process.exit(1);
  });
}

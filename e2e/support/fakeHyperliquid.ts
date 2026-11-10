/**
 * A deterministic fake Hyperliquid TESTNET for browser tests.
 *
 * It answers `POST https://api.hyperliquid-testnet.xyz/info` and `/exchange`
 * (via `page.route`) and the websocket (via `page.routeWebSocket`), keeps a tiny
 * account in memory (positions, resting orders, fills, agents, builder-fee
 * approval) and RECORDS every exchange action so tests can assert on exactly
 * what the app sent.
 *
 * It is a model of Hyperliquid, not Hyperliquid: where real behaviour is still
 * unverified (see docs/TESTNET_CHECKLIST.md) the fake picks the documented or
 * most likely behaviour and says so in a comment. Nothing here talks to a real
 * network.
 */
import { recoverTypedDataAddress, type Hex } from "viem";
import type { Page, Route, WebSocketRoute } from "@playwright/test";

export const REST_ORIGIN = "https://api.hyperliquid-testnet.xyz";
export const WS_URL_RE = /^wss:\/\/api\.hyperliquid-testnet\.xyz\/ws/;

interface FakeAsset {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
  marginMode?: string;
  mid: number;
}
interface FakeDex {
  name: string; // "" = core
  assets: FakeAsset[];
}

export const FAKE_DEXES: readonly FakeDex[] = [
  {
    name: "",
    assets: [
      { name: "BTC", szDecimals: 5, maxLeverage: 40, mid: 60_000 },
      { name: "ETH", szDecimals: 4, maxLeverage: 25, mid: 3_000 },
    ],
  },
  {
    name: "xyz",
    assets: [
      // HIP-3 markets are isolated-only.
      { name: "xyz:EUR", szDecimals: 1, maxLeverage: 20, onlyIsolated: true, marginMode: "strictIsolated", mid: 1.15 },
      { name: "xyz:GOLD", szDecimals: 3, maxLeverage: 20, onlyIsolated: true, marginMode: "strictIsolated", mid: 2_650 },
      { name: "xyz:TSLA", szDecimals: 2, maxLeverage: 10, onlyIsolated: true, marginMode: "strictIsolated", mid: 250 },
    ],
  },
];
const CATEGORY_LABELS: ReadonlyArray<[string, string]> = [
  ["xyz:EUR", "fx"],
  ["xyz:GOLD", "commodities"],
  ["xyz:TSLA", "stocks"],
];

const assetIdOf = (dexIndex: number, i: number): number => (dexIndex === 0 ? i : 100_000 + dexIndex * 10_000 + i);
const dexIndexByAsset = new Map<number, { dex: FakeDex; asset: FakeAsset }>();
FAKE_DEXES.forEach((dex, di) => dex.assets.forEach((asset, i) => dexIndexByAsset.set(assetIdOf(di, i), { dex, asset })));
const findAsset = (coin: string): { dex: FakeDex; asset: FakeAsset } | undefined => {
  for (const d of FAKE_DEXES) {
    const a = d.assets.find((x) => x.name === coin);
    if (a) return { dex: d, asset: a };
  }
  return undefined;
};

// ── recording ─────────────────────────────────────────────────────────────

export interface WireOrder {
  a: number;
  b: boolean;
  p: string;
  s: string;
  r: boolean;
  t: { limit?: { tif: string }; trigger?: { isMarket: boolean; triggerPx: string; tpsl: "tp" | "sl" } };
  c?: string;
}
export interface OrderActionBody {
  type: "order";
  orders: WireOrder[];
  grouping: "na" | "normalTpsl" | "positionTpsl";
  builder?: { b: string; f: number };
}
export interface RecordedExchange {
  seq: number;
  at: number;
  action: { type: string } & Record<string, unknown>;
  nonce: number;
  hasSignature: boolean;
  /** For user-signed actions: whether the signature recovers to the expected wallet. */
  signer?: string;
  signatureValid?: boolean;
  response: unknown;
}

export interface FakeOptions {
  /** The wallet the test signs with; user-signed actions must recover to it. */
  walletAddress: string;
  /** Free USDC on the core dex. */
  balance?: number;
  /** When false the fake accepts builder fees that were never approved. Default true (HL enforces it). */
  enforceBuilderApproval?: boolean;
}

interface Position {
  coin: string;
  szi: number;
  entryPx: number;
  leverage: { type: "cross" | "isolated"; value: number };
}
interface RestingOrder {
  oid: number;
  coin: string;
  isBuy: boolean;
  sz: number;
  limitPx: number;
  reduceOnly: boolean;
  cloid?: string;
  trigger?: { px: number; tpsl: "tp" | "sl"; isMarket: boolean };
  positionTpsl: boolean;
  ts: number;
}
interface Fill {
  coin: string;
  px: string;
  sz: string;
  side: "A" | "B";
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
  feeToken: string;
  builderFee?: string;
}

const TAKER_FEE = 0.00045;
const hex = (n: number): string => `0x${n.toString(16).padStart(64, "0")}`;
const str = (n: number, d = 8): string => Number(n.toFixed(d)).toString();
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});

// ── typed data (user-signed actions) ──────────────────────────────────────

const USER_SIGNED_TYPES: Record<string, { primary: string; fields: Array<{ name: string; type: string }> }> = {
  approveAgent: {
    primary: "HyperliquidTransaction:ApproveAgent",
    fields: [
      { name: "hyperliquidChain", type: "string" },
      { name: "agentAddress", type: "address" },
      { name: "agentName", type: "string" },
      { name: "nonce", type: "uint64" },
    ],
  },
  approveBuilderFee: {
    primary: "HyperliquidTransaction:ApproveBuilderFee",
    fields: [
      { name: "hyperliquidChain", type: "string" },
      { name: "maxFeeRate", type: "string" },
      { name: "builder", type: "address" },
      { name: "nonce", type: "uint64" },
    ],
  },
};

async function verifyUserSigned(action: Record<string, unknown>, nonce: number, sig: { r: Hex; s: Hex; v: number }): Promise<string | undefined> {
  const spec = USER_SIGNED_TYPES[String(action.type)];
  if (!spec) return undefined;
  const message: Record<string, unknown> = { ...action, nonce };
  const signature = (sig.r + sig.s.slice(2) + sig.v.toString(16).padStart(2, "0")) as Hex;
  try {
    return await recoverTypedDataAddress({
      domain: {
        name: "HyperliquidSignTransaction",
        version: "1",
        chainId: parseInt(String(action.signatureChainId), 16),
        verifyingContract: "0x0000000000000000000000000000000000000000",
      },
      types: { [spec.primary]: spec.fields },
      primaryType: spec.primary,
      message,
      signature,
    } as never);
  } catch {
    return undefined;
  }
}

// ── the fake ──────────────────────────────────────────────────────────────

export class FakeHyperliquid {
  readonly exchange: RecordedExchange[] = [];
  readonly info: Array<Record<string, unknown>> = [];
  readonly wsSubscriptions: Array<Record<string, unknown>> = [];

  private seq = 0;
  private oid = 1000;
  private tid = 1;
  private readonly agents = new Map<string, { name: string; validUntil: number | null }>();
  private maxBuilderFeeTenths = 0;
  private positions = new Map<string, Position>();
  private leverage = new Map<string, { type: "cross" | "isolated"; value: number }>();
  private resting: RestingOrder[] = [];
  private fills: Fill[] = [];
  private balance: number;
  private sockets = new Set<{ ws: WebSocketRoute; subs: Array<Record<string, unknown>>; timer: ReturnType<typeof setInterval> }>();
  private nextOrderError: string | null = null;

  constructor(private readonly opts: FakeOptions) {
    this.balance = opts.balance ?? 10_000;
  }

  // ── test controls / inspection ──

  /** The next `order` action is refused with this top-level error (`status: "err"`). */
  failNextOrder(message: string): void {
    this.nextOrderError = message;
  }
  /** Pretend the user already approved a builder fee (tenths of a bp). */
  setApprovedBuilderFee(tenthsBp: number): void {
    this.maxBuilderFeeTenths = tenthsBp;
  }
  /** Drop the builder approval (what happens when the operator raises the fee). */
  revokeBuilderApproval(): void {
    this.maxBuilderFeeTenths = 0;
  }
  orderActions(): OrderActionBody[] {
    return this.exchange.filter((e) => e.action.type === "order").map((e) => e.action as unknown as OrderActionBody);
  }
  actionsOfType(type: string): RecordedExchange[] {
    return this.exchange.filter((e) => e.action.type === type);
  }
  position(coin: string): Position | undefined {
    return this.positions.get(coin);
  }
  restingOrders(): readonly RestingOrder[] {
    return this.resting;
  }
  allFills(): readonly Fill[] {
    return this.fills;
  }
  midOf(coin: string): number {
    return findAsset(coin)?.asset.mid ?? 0;
  }

  dispose(): void {
    for (const s of this.sockets) clearInterval(s.timer);
    this.sockets.clear();
  }

  // ── Playwright wiring ──

  async install(page: Page): Promise<void> {
    await page.route(`${REST_ORIGIN}/**`, (route) => this.handleRoute(route));
    await page.routeWebSocket(WS_URL_RE, (ws) => this.handleSocket(ws));
  }

  private async handleRoute(route: Route): Promise<void> {
    const req = route.request();
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    };
    if (req.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const url = new URL(req.url());
    let body: unknown;
    try {
      body = req.postDataJSON();
    } catch {
      body = {};
    }
    let payload: unknown;
    if (url.pathname === "/info") payload = this.handleInfo(rec(body));
    else if (url.pathname === "/exchange") payload = await this.handleExchange(rec(body));
    else {
      await route.fulfill({ status: 404, headers: cors, body: "not found" });
      return;
    }
    await route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(payload) });
  }

  // ── info ──

  private metaFor(dexName: string): { universe: unknown[]; collateralToken: number } {
    const dex = FAKE_DEXES.find((d) => d.name === dexName) ?? FAKE_DEXES[0];
    return {
      universe: (dex?.assets ?? []).map((a) => ({
        name: a.name,
        szDecimals: a.szDecimals,
        maxLeverage: a.maxLeverage,
        ...(a.onlyIsolated ? { onlyIsolated: true, marginMode: a.marginMode } : {}),
      })),
      collateralToken: 0,
    };
  }

  private midsFor(dexName: string): Record<string, string> {
    const dex = FAKE_DEXES.find((d) => d.name === dexName);
    const out: Record<string, string> = {};
    for (const a of dex?.assets ?? []) out[a.name] = String(a.mid);
    return out;
  }

  private stateFor(dexName: string): unknown {
    const dex = FAKE_DEXES.find((d) => d.name === dexName);
    const coins = new Set((dex?.assets ?? []).map((a) => a.name));
    const assetPositions = [...this.positions.values()]
      .filter((p) => coins.has(p.coin) && p.szi !== 0)
      .map((p) => {
        const mid = this.midOf(p.coin);
        const ntl = Math.abs(p.szi) * mid;
        return {
          type: "oneWay",
          position: {
            coin: p.coin,
            szi: str(p.szi),
            leverage: p.leverage.type === "cross" ? { type: "cross", value: p.leverage.value } : { type: "isolated", value: p.leverage.value, rawUsd: str(ntl / p.leverage.value) },
            entryPx: str(p.entryPx),
            positionValue: str(ntl),
            unrealizedPnl: str((mid - p.entryPx) * p.szi),
            returnOnEquity: "0.0",
            liquidationPx: null,
            marginUsed: str(ntl / p.leverage.value),
            maxLeverage: findAsset(p.coin)?.asset.maxLeverage ?? 20,
            cumFunding: { allTime: "0.0", sinceOpen: "0.0", sinceChange: "0.0" },
          },
        };
      });
    const used = assetPositions.reduce((s, p) => s + Number(p.position.marginUsed), 0);
    const ntl = assetPositions.reduce((s, p) => s + Number(p.position.positionValue), 0);
    const core = dexName === "";
    const accountValue = core ? this.balance : used; // HIP-3 dexes hold isolated margin only
    const ms = { accountValue: str(accountValue), totalNtlPos: str(ntl), totalRawUsd: str(accountValue), totalMarginUsed: str(used) };
    return {
      marginSummary: ms,
      crossMarginSummary: ms,
      crossMaintenanceMarginUsed: "0.0",
      withdrawable: str(core ? Math.max(0, this.balance - used) : 0),
      assetPositions,
      time: Date.now(),
    };
  }

  private openOrdersFor(dexName: string): unknown[] {
    const dex = FAKE_DEXES.find((d) => d.name === dexName);
    const coins = new Set((dex?.assets ?? []).map((a) => a.name));
    return this.resting
      .filter((o) => coins.has(o.coin))
      .map((o) => this.orderRow(o));
  }

  private orderRow(o: RestingOrder): Record<string, unknown> {
    const isTrigger = o.trigger !== undefined;
    return {
      coin: o.coin,
      side: o.isBuy ? "B" : "A",
      limitPx: str(o.limitPx),
      sz: str(o.sz),
      origSz: str(o.sz),
      oid: o.oid,
      timestamp: o.ts,
      triggerCondition: isTrigger ? `Price ${o.isBuy === (o.trigger?.tpsl === "sl") ? "above" : "below"} ${str(o.trigger?.px ?? 0)}` : "N/A",
      isTrigger,
      triggerPx: str(o.trigger?.px ?? 0),
      children: [],
      isPositionTpsl: o.positionTpsl,
      reduceOnly: o.reduceOnly,
      orderType: isTrigger ? (o.trigger?.tpsl === "tp" ? "Take Profit Market" : "Stop Market") : "Limit",
      tif: isTrigger ? null : "Gtc",
      ...(o.cloid ? { cloid: o.cloid } : {}),
    };
  }

  private candles(coin: string, interval: string, startTime: number, endTime: number): unknown[] {
    const unit: Record<string, number> = { "1m": 60e3, "3m": 180e3, "5m": 300e3, "15m": 900e3, "30m": 1800e3, "1h": 3600e3, "2h": 7200e3, "4h": 14_400e3, "8h": 28_800e3, "12h": 43_200e3, "1d": 86_400e3, "3d": 259_200e3, "1w": 604_800e3, "1M": 2_592_000e3 };
    const step = unit[interval] ?? 3600e3;
    const mid = this.midOf(coin) || 1;
    const end = Math.min(endTime || Date.now(), Date.now());
    const lastOpen = Math.floor(end / step) * step;
    const n = Math.min(300, Math.max(1, Math.floor((lastOpen - Math.max(startTime, lastOpen - 300 * step)) / step) + 1));
    const out: unknown[] = [];
    for (let k = n - 1; k >= 0; k--) {
      const t = lastOpen - k * step;
      const phase = (t / step) % 1000;
      const base = mid * (1 + 0.004 * Math.sin(phase / 6));
      const open = base * (1 + 0.0007 * Math.sin(phase));
      const close = base * (1 + 0.0007 * Math.cos(phase));
      const high = Math.max(open, close) * 1.0006;
      const low = Math.min(open, close) * 0.9994;
      out.push({ t, T: t + step - 1, s: coin, i: interval, o: str(open, 6), c: str(close, 6), h: str(high, 6), l: str(low, 6), v: str(100 + (phase % 50), 2), n: 10 + (phase % 7) });
    }
    return out;
  }

  private handleInfo(body: Record<string, unknown>): unknown {
    this.info.push(body);
    const type = String(body.type);
    const dex = typeof body.dex === "string" ? body.dex : "";
    switch (type) {
      case "perpDexs":
        return [null, { name: "xyz", fullName: "XYZ (fake)", deployer: "0x1111111111111111111111111111111111111111" }];
      case "perpCategories":
        return CATEGORY_LABELS;
      case "meta":
        return this.metaFor(dex);
      case "metaAndAssetCtxs":
        return [
          this.metaFor(dex),
          (FAKE_DEXES.find((d) => d.name === dex)?.assets ?? []).map((a) => ({ funding: "0.0000125", openInterest: "1000", prevDayPx: str(a.mid * 0.99), dayNtlVlm: "1000000", markPx: str(a.mid), midPx: str(a.mid), oraclePx: str(a.mid) })),
        ];
      case "allMids":
        return this.midsFor(dex);
      case "candleSnapshot": {
        const req = rec(body.req);
        return this.candles(String(req.coin), String(req.interval), Number(req.startTime ?? 0), Number(req.endTime ?? Date.now()));
      }
      case "l2Book": {
        const mid = this.midOf(String(body.coin));
        return { coin: body.coin, time: Date.now(), levels: [[{ px: str(mid * 0.9999), sz: "10", n: 3 }], [{ px: str(mid * 1.0001), sz: "10", n: 3 }]] };
      }
      case "clearinghouseState":
        return this.stateFor(dex);
      case "allDexsClearinghouseState":
        return { user: body.user, clearinghouseStates: FAKE_DEXES.map((d) => [d.name, this.stateFor(d.name)]) };
      case "openOrders":
      case "frontendOpenOrders":
        return this.openOrdersFor(dex);
      case "userFills":
        return [...this.fills].reverse();
      case "userFillsByTime":
        return this.fills.filter((f) => f.time >= Number(body.startTime ?? 0));
      case "orderStatus":
        return this.orderStatus(body.oid);
      case "activeAssetData": {
        const coin = String(body.coin);
        const a = findAsset(coin)?.asset;
        const lev = this.leverage.get(coin) ?? { type: "cross" as const, value: a?.maxLeverage ?? 20 };
        return { user: body.user, coin, leverage: lev, maxTradeSzs: ["1000", "1000"], availableToTrade: [str(this.balance), str(this.balance)], markPx: str(a?.mid ?? 0) };
      }
      case "extraAgents":
        return [...this.agents.entries()].map(([address, v]) => ({ address, name: v.name, validUntil: v.validUntil }));
      case "maxBuilderFee":
        return this.maxBuilderFeeTenths;
      case "userAbstraction":
        return "default";
      case "spotClearinghouseState":
        return { balances: [{ coin: "USDC", token: 0, total: "0.0", hold: "0.0", entryNtl: "0.0" }] };
      case "userRole":
        return { role: "user" };
      default:
        return {};
    }
  }

  private orderStatus(oidOrCloid: unknown): unknown {
    const rest = this.resting.find((o) => o.oid === Number(oidOrCloid) || (o.cloid !== undefined && o.cloid === oidOrCloid));
    if (rest) return { status: "order", order: { order: this.orderRow(rest), status: "open", statusTimestamp: Date.now() } };
    const f = this.fills.find((x) => x.oid === Number(oidOrCloid));
    if (f) {
      const row = { coin: f.coin, side: f.side, limitPx: f.px, sz: "0.0", origSz: f.sz, oid: f.oid, timestamp: f.time, triggerCondition: "N/A", isTrigger: false, triggerPx: "0.0", children: [], isPositionTpsl: false, reduceOnly: false, orderType: "Limit", tif: "Ioc" };
      return { status: "order", order: { order: row, status: "filled", statusTimestamp: f.time } };
    }
    return { status: "unknownOid" };
  }

  // ── exchange ──

  private async handleExchange(body: Record<string, unknown>): Promise<unknown> {
    const action = rec(body.action) as { type: string } & Record<string, unknown>;
    const nonce = Number(body.nonce ?? 0);
    const sig = rec(body.signature);
    const entry: RecordedExchange = {
      seq: ++this.seq,
      at: Date.now(),
      action,
      nonce,
      hasSignature: typeof sig.r === "string" && typeof sig.s === "string",
      response: undefined,
    };
    const ok = { status: "ok", response: { type: "default" } };
    let response: unknown = ok;

    switch (action.type) {
      case "approveAgent": {
        entry.signer = await verifyUserSigned(action, nonce, sig as never);
        entry.signatureValid = entry.signer?.toLowerCase() === this.opts.walletAddress.toLowerCase();
        if (!entry.signatureValid) {
          response = { status: "err", response: "User or API Wallet does not exist." };
          break;
        }
        const name = String(action.agentName ?? "");
        const m = /valid_until (\d+)/.exec(name);
        // Same base name replaces the previous agent (HL behaviour assumed; checklist item).
        const base = name.replace(/ valid_until \d+$/, "");
        for (const [addr, v] of this.agents) if (v.name.replace(/ valid_until \d+$/, "") === base) this.agents.delete(addr);
        this.agents.set(String(action.agentAddress).toLowerCase(), { name, validUntil: m ? Number(m[1]) : null });
        break;
      }
      case "approveBuilderFee": {
        entry.signer = await verifyUserSigned(action, nonce, sig as never);
        entry.signatureValid = entry.signer?.toLowerCase() === this.opts.walletAddress.toLowerCase();
        if (!entry.signatureValid) {
          response = { status: "err", response: "User or API Wallet does not exist." };
          break;
        }
        const pct = parseFloat(String(action.maxFeeRate));
        this.maxBuilderFeeTenths = Math.round(pct * 1000);
        break;
      }
      case "updateLeverage": {
        const hit = dexIndexByAsset.get(Number(action.asset));
        if (!hit) {
          response = { status: "err", response: "Invalid asset" };
          break;
        }
        if (action.isCross === true && hit.asset.onlyIsolated) {
          response = { status: "err", response: "Cross margin is not allowed for this asset." };
          break;
        }
        this.leverage.set(hit.asset.name, { type: action.isCross === true ? "cross" : "isolated", value: Number(action.leverage) });
        break;
      }
      case "order":
        response = this.handleOrder(action as unknown as OrderActionBody);
        break;
      case "cancel": {
        const cancels = (Array.isArray(action.cancels) ? action.cancels : []) as Array<{ a: number; o: number }>;
        const statuses = cancels.map((c) => {
          const i = this.resting.findIndex((o) => o.oid === c.o);
          if (i < 0) return { error: "Order was never placed, already canceled, or filled." };
          this.resting.splice(i, 1);
          return "success";
        });
        response = { status: "ok", response: { type: "cancel", data: { statuses } } };
        this.pushOrderUpdates();
        break;
      }
      case "cancelByCloid": {
        const cancels = (Array.isArray(action.cancels) ? action.cancels : []) as Array<{ asset: number; cloid: string }>;
        const statuses = cancels.map((c) => {
          const i = this.resting.findIndex((o) => o.cloid === c.cloid);
          if (i < 0) return { error: "Order was never placed, already canceled, or filled." };
          this.resting.splice(i, 1);
          return "success";
        });
        response = { status: "ok", response: { type: "cancel", data: { statuses } } };
        this.pushOrderUpdates();
        break;
      }
      case "modify": {
        const w = rec(action.order) as unknown as WireOrder;
        const i = this.resting.findIndex((o) => o.oid === Number(action.oid));
        const cur = this.resting[i];
        if (!cur) {
          response = { status: "err", response: "Cannot modify canceled or filled order" };
          break;
        }
        // Real HL may assign a new oid on modify (checklist item); the fake keeps it.
        cur.limitPx = Number(w.p);
        cur.sz = Number(w.s);
        response = ok;
        break;
      }
      default:
        break;
    }
    entry.response = response;
    this.exchange.push(entry);
    return response;
  }

  private handleOrder(action: OrderActionBody): unknown {
    if (this.nextOrderError) {
      const message = this.nextOrderError;
      this.nextOrderError = null;
      return { status: "err", response: message };
    }
    const enforce = this.opts.enforceBuilderApproval !== false;
    if (action.builder && enforce && this.maxBuilderFeeTenths < action.builder.f) {
      // Wording per community reports; the real text is a TESTNET_CHECKLIST item.
      return { status: "err", response: "Builder fee has not been approved." };
    }
    const statuses: unknown[] = [];
    let parentFilled = true;
    action.orders.forEach((w, idx) => {
      const hit = dexIndexByAsset.get(w.a);
      if (!hit) {
        statuses.push({ error: "Order has invalid asset." });
        return;
      }
      const coin = hit.asset.name;
      const sz = Number(w.s);
      const px = Number(w.p);
      const mid = hit.asset.mid;
      if (w.t.trigger) {
        // Children of a normalTpsl group only exist if the parent filled.
        if (action.grouping === "normalTpsl" && idx > 0 && !parentFilled) {
          statuses.push({ error: "Order could not immediately match against any resting orders." });
          return;
        }
        const o: RestingOrder = {
          oid: ++this.oid, coin, isBuy: w.b, sz, limitPx: px, reduceOnly: w.r, cloid: w.c,
          trigger: { px: Number(w.t.trigger.triggerPx), tpsl: w.t.trigger.tpsl, isMarket: w.t.trigger.isMarket },
          positionTpsl: action.grouping === "positionTpsl", ts: Date.now(),
        };
        this.resting.push(o);
        statuses.push({ resting: { oid: o.oid, ...(w.c ? { cloid: w.c } : {}) } });
        return;
      }
      const tif = w.t.limit?.tif ?? "Gtc";
      const crosses = w.b ? px >= mid : px <= mid;
      if (tif === "Ioc" || (tif === "Gtc" && crosses)) {
        if (!crosses) {
          statuses.push({ error: "Order could not immediately match against any resting orders. asset=" + String(w.a) });
          if (idx === 0) parentFilled = false;
          return;
        }
        if (!w.r && sz * mid < 10) {
          statuses.push({ error: "Order must have minimum value of $10." });
          if (idx === 0) parentFilled = false;
          return;
        }
        const fill = this.applyFill(coin, w.b, sz, mid, action.builder?.f, w.r);
        if (!fill) {
          statuses.push({ error: "Reduce only order would increase position." });
          if (idx === 0) parentFilled = false;
          return;
        }
        statuses.push({ filled: { totalSz: fill.sz, avgPx: fill.px, oid: fill.oid, ...(w.c ? { cloid: w.c } : {}) } });
        return;
      }
      if (tif === "Alo" && crosses) {
        statuses.push({ error: "Post only order would have immediately matched, bbo was " + String(mid) });
        return;
      }
      if (!w.r && sz * px < 10) {
        statuses.push({ error: "Order must have minimum value of $10." });
        return;
      }
      const o: RestingOrder = { oid: ++this.oid, coin, isBuy: w.b, sz, limitPx: px, reduceOnly: w.r, cloid: w.c, positionTpsl: false, ts: Date.now() };
      this.resting.push(o);
      statuses.push({ resting: { oid: o.oid, ...(w.c ? { cloid: w.c } : {}) } });
    });
    this.pushAfterTrade();
    return { status: "ok", response: { type: "order", data: { statuses } } };
  }

  private applyFill(coin: string, isBuy: boolean, sz: number, px: number, builderF: number | undefined, reduceOnly: boolean): Fill | null {
    const cur = this.positions.get(coin);
    const startSzi = cur?.szi ?? 0;
    const delta = isBuy ? sz : -sz;
    if (reduceOnly) {
      if (startSzi === 0 || Math.sign(delta) === Math.sign(startSzi)) return null;
    }
    const fillSz = reduceOnly ? Math.min(sz, Math.abs(startSzi)) : sz;
    const signed = isBuy ? fillSz : -fillSz;
    let closedPnl = 0;
    let next = startSzi + signed;
    if (Math.abs(next) < 1e-12) next = 0;
    const sameDir = startSzi === 0 || Math.sign(startSzi) === Math.sign(signed);
    let entryPx = cur?.entryPx ?? px;
    if (sameDir) {
      entryPx = (Math.abs(startSzi) * entryPx + fillSz * px) / (Math.abs(startSzi) + fillSz);
    } else {
      const closing = Math.min(Math.abs(startSzi), fillSz);
      closedPnl = (px - entryPx) * closing * Math.sign(startSzi);
      if (next !== 0 && Math.sign(next) !== Math.sign(startSzi)) entryPx = px; // flipped
    }
    const lev = cur?.leverage ?? this.leverage.get(coin) ?? { type: "cross" as const, value: findAsset(coin)?.asset.maxLeverage ?? 20 };
    if (next === 0) this.positions.delete(coin);
    else this.positions.set(coin, { coin, szi: next, entryPx, leverage: lev });
    const notional = fillSz * px;
    this.balance += closedPnl - notional * TAKER_FEE;
    // Closing a position releases its trigger orders when flat.
    if (next === 0) this.resting = this.resting.filter((o) => !(o.coin === coin && o.reduceOnly));
    const oid = ++this.oid;
    const fill: Fill = {
      coin, px: str(px), sz: str(fillSz), side: isBuy ? "B" : "A", time: Date.now(), startPosition: str(startSzi),
      dir: startSzi === 0 || Math.sign(startSzi) === Math.sign(signed) ? (isBuy ? "Open Long" : "Open Short") : isBuy ? "Close Short" : "Close Long",
      closedPnl: str(closedPnl), hash: hex(oid), oid, crossed: true, fee: str(notional * TAKER_FEE, 6), tid: this.tid++, feeToken: "USDC",
      ...(builderF ? { builderFee: str((notional * builderF) / 100_000, 6) } : {}),
    };
    this.fills.push(fill);
    return fill;
  }

  // ── websocket ──

  private handleSocket(ws: WebSocketRoute): void {
    const entry = { ws, subs: [] as Array<Record<string, unknown>>, timer: setInterval(() => this.tickSocket(entry), 700) };
    this.sockets.add(entry);
    ws.onClose(() => {
      clearInterval(entry.timer);
      this.sockets.delete(entry);
    });
    ws.onMessage((raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = rec(JSON.parse(String(raw)));
      } catch {
        return;
      }
      if (msg.method === "ping") {
        ws.send(JSON.stringify({ channel: "pong" }));
        return;
      }
      const sub = rec(msg.subscription);
      if (msg.method === "subscribe") {
        entry.subs.push(sub);
        this.wsSubscriptions.push(sub);
        ws.send(JSON.stringify({ channel: "subscriptionResponse", data: { method: "subscribe", subscription: sub } }));
        this.pushSnapshot(entry, sub);
      } else if (msg.method === "unsubscribe") {
        entry.subs = entry.subs.filter((s) => JSON.stringify(s) !== JSON.stringify(sub));
        ws.send(JSON.stringify({ channel: "subscriptionResponse", data: { method: "unsubscribe", subscription: sub } }));
      }
    });
  }

  private send(entry: { ws: WebSocketRoute }, channel: string, data: unknown): void {
    try {
      entry.ws.send(JSON.stringify({ channel, data }));
    } catch {
      /* socket closed */
    }
  }

  private bboFrame(coin: string): unknown {
    const mid = this.midOf(coin);
    return { coin, time: Date.now(), bbo: [{ px: str(mid * 0.9999), sz: "10", n: 2 }, { px: str(mid * 1.0001), sz: "10", n: 2 }] };
  }

  private pushSnapshot(entry: { ws: WebSocketRoute }, sub: Record<string, unknown>): void {
    const user = String(sub.user ?? "").toLowerCase();
    switch (sub.type) {
      case "userFills":
        this.send(entry, "userFills", { isSnapshot: true, user, fills: [] });
        break;
      case "orderUpdates":
        break;
      case "allDexsClearinghouseState":
        this.send(entry, "allDexsClearinghouseState", { user, clearinghouseStates: FAKE_DEXES.map((d) => [d.name, this.stateFor(d.name)]) });
        break;
      case "bbo":
        this.send(entry, "bbo", this.bboFrame(String(sub.coin)));
        break;
      default:
        break;
    }
  }

  private tickSocket(entry: { ws: WebSocketRoute; subs: Array<Record<string, unknown>> }): void {
    for (const sub of entry.subs) {
      if (sub.type === "bbo") this.send(entry, "bbo", this.bboFrame(String(sub.coin)));
      else if (sub.type === "allMids") {
        const dex = typeof sub.dex === "string" ? sub.dex : "";
        this.send(entry, "allMids", { ...(dex ? { dex } : {}), mids: this.midsFor(dex) });
      } else if (sub.type === "candle") {
        const coin = String(sub.coin);
        const interval = String(sub.interval);
        const last = this.candles(coin, interval, 0, Date.now()).at(-1);
        if (last) this.send(entry, "candle", last);
      }
    }
  }

  private subsOfType(type: string): Array<{ ws: WebSocketRoute; sub: Record<string, unknown> }> {
    const out: Array<{ ws: WebSocketRoute; sub: Record<string, unknown> }> = [];
    for (const s of this.sockets) for (const sub of s.subs) if (sub.type === type) out.push({ ws: s.ws, sub });
    return out;
  }

  private pushAfterTrade(): void {
    const last = this.fills.at(-1);
    for (const { ws, sub } of this.subsOfType("userFills")) {
      if (last) this.send({ ws }, "userFills", { isSnapshot: false, user: String(sub.user).toLowerCase(), fills: [last] });
    }
    for (const { ws, sub } of this.subsOfType("allDexsClearinghouseState")) {
      this.send({ ws }, "allDexsClearinghouseState", { user: String(sub.user).toLowerCase(), clearinghouseStates: FAKE_DEXES.map((d) => [d.name, this.stateFor(d.name)]) });
    }
    this.pushOrderUpdates();
  }

  private pushOrderUpdates(): void {
    for (const { ws } of this.subsOfType("orderUpdates")) {
      this.send({ ws }, "orderUpdates", this.resting.map((o) => ({ order: { coin: o.coin, side: o.isBuy ? "B" : "A", limitPx: str(o.limitPx), sz: str(o.sz), oid: o.oid, timestamp: o.ts, origSz: str(o.sz), reduceOnly: o.reduceOnly }, status: "open", statusTimestamp: Date.now() })));
    }
  }
}


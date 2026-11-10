import type { InfoClient } from "@nktkas/hyperliquid";
import type { HlInfoApi } from "./exchange.ts";
import { TradeError } from "./orders.ts";
import type { HlMarket, MarketRegistry } from "./types.ts";
import type { Page } from "../adapter/types.ts";
import type { Account, ClosedPosition, Order, Position } from "../services/schemas.ts";

/**
 * Account, position, order and history reads, plus the pure mappers from
 * Hyperliquid's wire shapes to the terminal's schemas. All reads use the MAIN
 * wallet address (never the agent's).
 */

export type ClearinghouseState = Awaited<ReturnType<InfoClient["clearinghouseState"]>>;
export type FrontendOpenOrder = Awaited<ReturnType<InfoClient["frontendOpenOrders"]>>[number];
export type UserFill = Awaited<ReturnType<InfoClient["userFills"]>>[number];

export interface DexState {
  dex: string;
  state: ClearinghouseState;
}

const num = (s: string | number | null | undefined): number => {
  const n = typeof s === "number" ? s : Number(s ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ── Account ───────────────────────────────────────────────────────────────

export interface AccountSummary {
  /** Account value including unrealised PnL, summed over every dex. */
  equity: number;
  /** Equity minus unrealised PnL: the cash balance before open positions mark to market. */
  balance: number;
  margin: number;
  /** Hyperliquid's `withdrawable`, summed over dexes. */
  freeMargin: number;
  unrealizedPnl: number;
}

/**
 * Collateral of a unified account. There the perp clearinghouse reports only the
 * slice of collateral allocated to margin (and `withdrawable` ~ 0), while the
 * real balance is the spot USDC balance shared by every dex.
 */
export interface UnifiedCollateral {
  /** Spot USDC total (includes what is held as margin; excludes unrealised PnL). */
  total: number;
  /** Hyperliquid's `tokenToAvailableAfterMaintenance` for USDC. */
  available: number;
}

export function summarizeStates(states: readonly DexState[], collateral?: UnifiedCollateral | null): AccountSummary {
  let equity = 0;
  let margin = 0;
  let freeMargin = 0;
  let unrealizedPnl = 0;
  for (const { state } of states) {
    equity += num(state.marginSummary.accountValue);
    margin += num(state.marginSummary.totalMarginUsed);
    freeMargin += num(state.withdrawable);
    for (const p of state.assetPositions) unrealizedPnl += num(p.position.unrealizedPnl);
  }
  if (collateral) {
    return {
      equity: collateral.total + unrealizedPnl,
      balance: collateral.total,
      margin,
      freeMargin: collateral.available,
      unrealizedPnl,
    };
  }
  return { equity, balance: equity - unrealizedPnl, margin, freeMargin, unrealizedPnl };
}

export function buildAccount(address: string, summary: AccountSummary, startingBalance: number, now = new Date()): Account {
  const iso = now.toISOString();
  return {
    id: address,
    userId: address,
    templateId: "hyperliquid",
    label: `Hyperliquid ${address.slice(0, 6)}…${address.slice(-4)}`,
    status: "ACTIVE",
    balance: summary.balance,
    equity: summary.equity,
    margin: summary.margin,
    freeMargin: summary.freeMargin,
    phase: "LIVE",
    startDate: iso,
    createdAt: iso,
    updatedAt: iso,
    isHftMode: false,
    template: { name: "Hyperliquid", startingBalance, instrumentType: "CRYPTO" },
  };
}

// ── Positions ─────────────────────────────────────────────────────────────

export interface Protection {
  takeProfit: number | null;
  stopLoss: number | null;
  tpOids: number[];
  slOids: number[];
}

function triggerKind(o: Pick<FrontendOpenOrder, "orderType">): "tp" | "sl" | null {
  if (o.orderType.startsWith("Take Profit")) return "tp";
  if (o.orderType.startsWith("Stop")) return "sl";
  return null;
}

/** Reduce-only trigger orders on `coin` that protect a long/short position (TP and SL). */
export function protectionFor(orders: readonly FrontendOpenOrder[], coin: string, isLong: boolean): Protection {
  const out: Protection = { takeProfit: null, stopLoss: null, tpOids: [], slOids: [] };
  const exitSide = isLong ? "A" : "B";
  const mine = orders
    .filter((o) => o.coin === coin && o.isTrigger && (o.reduceOnly || o.isPositionTpsl) && o.side === exitSide)
    .sort((a, b) => b.timestamp - a.timestamp);
  for (const o of mine) {
    const kind = triggerKind(o);
    if (kind === "tp") {
      out.tpOids.push(o.oid);
      out.takeProfit ??= num(o.triggerPx);
    } else if (kind === "sl") {
      out.slOids.push(o.oid);
      out.stopLoss ??= num(o.triggerPx);
    }
  }
  return out;
}

/** Remembers when each position was first seen (HL's state has no open time). */
export class OpenedAtTracker {
  private seen = new Map<string, { side: string; iso: string }>();
  touch(coin: string, side: string, iso: string): string {
    const prev = this.seen.get(coin);
    if (prev && prev.side === side) return prev.iso;
    this.seen.set(coin, { side, iso });
    return iso;
  }
  /** Drop coins that are no longer open. */
  prune(openCoins: ReadonlySet<string>): void {
    for (const coin of this.seen.keys()) if (!openCoins.has(coin)) this.seen.delete(coin);
  }
  set(coin: string, side: string, iso: string): void {
    this.seen.set(coin, { side, iso });
  }
}

/**
 * Hyperliquid-specific position detail layered on the shared `Position`.
 * Optional so every consumer of plain `Position` keeps working.
 */
export interface HlPositionExtras {
  /** Exchange-reported liquidation price; null/absent when HL reports none. */
  liquidationPx?: number | null;
  /** Funding since the position opened, USD, as reported by Hyperliquid (cumFunding.sinceOpen). */
  fundingSinceOpen?: number;
  marginMode?: "cross" | "isolated";
  leverage?: number;
}
export type HlPosition = Position & HlPositionExtras;

export function mapPositions(
  address: string,
  states: readonly DexState[],
  mids: ReadonlyMap<string, number>,
  orders: readonly FrontendOpenOrder[],
  openedAt: OpenedAtTracker,
  now = new Date(),
): HlPosition[] {
  const out: HlPosition[] = [];
  const iso = now.toISOString();
  for (const { state } of states) {
    for (const { position: p } of state.assetPositions) {
      const szi = num(p.szi);
      if (szi === 0) continue;
      const isLong = szi > 0;
      const side = isLong ? "LONG" : "SHORT";
      const prot = protectionFor(orders, p.coin, isLong);
      const mid = mids.get(p.coin);
      out.push({
        id: p.coin,
        accountId: address,
        symbolName: p.coin,
        side,
        quantity: Math.abs(szi),
        entryPrice: num(p.entryPx),
        ...(mid !== undefined ? { currentPrice: mid } : {}),
        unrealizedPnl: num(p.unrealizedPnl),
        margin: num(p.marginUsed),
        contractSize: 1,
        openedAt: openedAt.touch(p.coin, side, iso),
        takeProfit: prot.takeProfit,
        stopLoss: prot.stopLoss,
        liquidationPx: p.liquidationPx == null ? null : num(p.liquidationPx),
        // Exactly as Hyperliquid reports it (cumFunding.sinceOpen); sign convention is HL's.
        fundingSinceOpen: num(p.cumFunding.sinceOpen),
        marginMode: p.leverage.type,
        leverage: p.leverage.value,
      });
    }
  }
  openedAt.prune(new Set(out.map((p) => p.id)));
  return out;
}

// ── Orders ────────────────────────────────────────────────────────────────

/** Fields shared by `FrontendOpenOrder` and the websocket `OpenOrder`. */
export interface OpenOrderLike {
  coin: string;
  side: "B" | "A";
  limitPx: string;
  sz: string;
  oid: number;
  timestamp: number;
  origSz: string;
  triggerPx?: string;
  isTrigger?: boolean;
  isPositionTpsl?: boolean;
  reduceOnly?: boolean;
  orderType?: string;
  children?: readonly OpenOrderLike[];
}

export function mapOpenOrder(address: string, o: OpenOrderLike, status = "PENDING"): Order {
  const isTrigger = o.isTrigger === true;
  const orderType = o.orderType ?? (isTrigger ? "Stop Market" : "Limit");
  const isMarketType = orderType.endsWith("Market") && orderType !== "Limit";
  let takeProfit: number | null = null;
  let stopLoss: number | null = null;
  for (const c of o.children ?? []) {
    const kind = c.orderType?.startsWith("Take Profit") ? "tp" : c.orderType?.startsWith("Stop") ? "sl" : null;
    if (kind === "tp") takeProfit = num(c.triggerPx);
    if (kind === "sl") stopLoss = num(c.triggerPx);
  }
  const kind = isTrigger ? triggerKind({ orderType: orderType as FrontendOpenOrder["orderType"] }) : null;
  const comment = o.isPositionTpsl
    ? kind === "tp"
      ? "Position take profit"
      : "Position stop loss"
    : isTrigger && o.reduceOnly
      ? kind === "tp"
        ? "Take profit"
        : "Stop loss"
      : null;
  // One malformed timestamp must not make the whole order list throw.
  const ts = new Date(Number.isFinite(o.timestamp) ? o.timestamp : Date.now());
  const created = (Number.isNaN(ts.getTime()) ? new Date() : ts).toISOString();
  const quantity = num(o.origSz) || num(o.sz);
  return {
    id: String(o.oid),
    accountId: address,
    symbolName: o.coin,
    side: o.side === "B" ? "BUY" : "SELL",
    type: isTrigger ? "STOP" : isMarketType ? "MARKET" : "LIMIT",
    quantity,
    price: isTrigger && isMarketType ? null : num(o.limitPx),
    stopPrice: isTrigger ? num(o.triggerPx) : null,
    takeProfit,
    stopLoss,
    status,
    filledQuantity: Math.max(0, quantity - num(o.sz)),
    avgFillPrice: null,
    comment,
    createdAt: created,
    updatedAt: created,
  };
}

// ── Closed positions (from fills) ─────────────────────────────────────────

export function isClosingFill(f: UserFill): boolean {
  return num(f.closedPnl) !== 0 || (f.dir ?? "").startsWith("Close");
}

/**
 * Collapse closing fills of the same order into one ClosedPosition. `commission`
 * is Hyperliquid's own `fee`; the platform (builder) fee is reported separately as `platformFee`. `realizedPnl`
 * is HL's `closedPnl` as reported (gross of fees).
 */
export type HlClosedPosition = ClosedPosition & {
  /**
   * Sum of the fills' `builderFee` (the platform fee), USD. Hyperliquid documents it as an
   * additional fee on top of `fee`, so total close-side cost is `commission + platformFee`.
   */
  platformFee?: number;
};

export function mapClosedPositions(address: string, fills: readonly UserFill[]): HlClosedPosition[] {
  const groups = new Map<string, UserFill[]>();
  for (const f of fills) {
    if (!isClosingFill(f)) continue;
    const key = `${f.coin}:${f.oid}`;
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  const out: HlClosedPosition[] = [];
  for (const [key, group] of groups) {
    group.sort((a, b) => a.time - b.time || a.tid - b.tid);
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last) continue;
    let qty = 0;
    let notional = 0;
    let pnl = 0;
    let fee = 0;
    let platformFee = 0;
    for (const f of group) {
      const sz = num(f.sz);
      qty += sz;
      notional += sz * num(f.px);
      pnl += num(f.closedPnl);
      fee += num(f.fee);
      platformFee += num(f.builderFee);
    }
    if (!(qty > 0)) continue;
    const exit = notional / qty;
    // A sell closes a long; a buy closes a short.
    const closedLong = first.side === "A";
    const entry = closedLong ? exit - pnl / qty : exit + pnl / qty;
    const closedAt = new Date(last.time).toISOString();
    out.push({
      id: key,
      accountId: address,
      symbolName: first.coin,
      side: closedLong ? "LONG" : "SHORT",
      quantity: qty,
      entryPrice: entry,
      exitPrice: exit,
      realizedPnl: pnl,
      commission: fee,
      platformFee,
      swap: 0,
      // HL fills don't carry the position's open time; the close time is the best honest value.
      openedAt: new Date(first.time).toISOString(),
      closedAt,
      isPartialClose: Math.abs(num(first.startPosition)) - qty > 1e-9,
    });
  }
  return out.sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
}

// ── Reader ────────────────────────────────────────────────────────────────

export interface AccountReaderOptions {
  info: HlInfoApi;
  registry: MarketRegistry;
  pageSize?: number;
  now?: () => Date;
}

export interface AccountReader {
  dexes(): string[];
  /**
   * Clearinghouse state per dex. HIP-3 dexes are best-effort by default; pass
   * `strict` when silently omitting one would be harmful (e.g. closing everything).
   */
  states(address: string, opts?: { strict?: boolean }): Promise<DexState[]>;
  /** Unified-account collateral, or null for a standard account / when it can't be determined. */
  collateral(address: string): Promise<UnifiedCollateral | null>;
  openOrders(address: string): Promise<FrontendOpenOrder[]>;
  mid(market: HlMarket): Promise<number>;
  midsByCoin(dexes: readonly string[]): Promise<Map<string, number>>;
  getAccount(address: string): Promise<Account>;
  getPositions(address: string): Promise<Position[]>;
  getOrders(address: string, status?: string): Promise<Order[]>;
  getClosedPositions(address: string, page?: number): Promise<Page<ClosedPosition>>;
  /** Raw signed position size for a coin, or 0. */
  positionSize(address: string, market: HlMarket): Promise<number>;
  openedAt: OpenedAtTracker;
}

const OPEN_STATUSES = new Set(["PENDING", "NEW", "OPEN"]);

export function createAccountReader(opts: AccountReaderOptions): AccountReader {
  const { info, registry } = opts;
  const pageSize = opts.pageSize ?? 20;
  const now = opts.now ?? (() => new Date());
  const openedAt = new OpenedAtTracker();
  const startingBalances = new Map<string, number>();

  const dexes = (): string[] => {
    const set = new Set<string>([""]);
    for (const m of registry.markets()) set.add(m.dex);
    return [...set];
  };

  /** Core dex must succeed; HIP-3 dexes are best-effort so one flaky dex can't blank the account. */
  async function perDex<T>(fn: (dex: string) => Promise<T>, strict = false): Promise<Array<{ dex: string; value: T }>> {
    const list = dexes();
    const settled = await Promise.allSettled(list.map((d) => fn(d)));
    const out: Array<{ dex: string; value: T }> = [];
    settled.forEach((r, i) => {
      const dex = list[i] ?? "";
      if (r.status === "fulfilled") out.push({ dex, value: r.value });
      else if (dex === "" || strict) throw r.reason;
    });
    return out;
  }

  const states = async (address: string, o?: { strict?: boolean }): Promise<DexState[]> => {
    const rows = await perDex(
      (dex) => info.clearinghouseState({ user: address as `0x${string}`, ...(dex ? { dex } : {}) }),
      o?.strict === true,
    );
    return rows.map((r) => ({ dex: r.dex, state: r.value }));
  };

  const openOrders = async (address: string): Promise<FrontendOpenOrder[]> => {
    const rows = await perDex((dex) =>
      info.frontendOpenOrders({ user: address as `0x${string}`, ...(dex ? { dex } : {}) }),
    );
    return rows.flatMap((r) => r.value);
  };

  const unified = new Map<string, boolean>();
  const collateral = async (address: string): Promise<UnifiedCollateral | null> => {
    const user = address as `0x${string}`;
    let isUnified = unified.get(address);
    if (isUnified === undefined) {
      try {
        isUnified = (await info.userAbstraction({ user })) === "unifiedAccount";
        unified.set(address, isUnified);
      } catch {
        return null; // unknown: fall back to the perp view rather than fail the account read
      }
    }
    if (!isUnified) return null;
    const spot = await info.spotClearinghouseState({ user });
    const usdc = spot.balances.find((b) => b.coin === "USDC");
    const avail = spot.tokenToAvailableAfterMaintenance?.find(([t]) => t === 0)?.[1];
    return { total: num(usdc?.total), available: num(avail) };
  };

  const midsByCoin = async (list: readonly string[]): Promise<Map<string, number>> => {
    const out = new Map<string, number>();
    const settled = await Promise.allSettled(list.map((dex) => info.allMids(dex ? { dex } : {})));
    for (const r of settled) {
      if (r.status !== "fulfilled") continue;
      for (const [coin, px] of Object.entries(r.value)) {
        const n = Number(px);
        if (Number.isFinite(n) && n > 0) out.set(coin, n);
      }
    }
    return out;
  };

  const mid = async (market: HlMarket): Promise<number> => {
    try {
      const mids = await info.allMids(market.dex ? { dex: market.dex } : {});
      const n = Number(mids[market.coin]);
      if (Number.isFinite(n) && n > 0) return n;
    } catch {
      /* fall through to the order book */
    }
    try {
      const book = await info.l2Book({ coin: market.coin });
      const bid = Number(book?.levels[0]?.[0]?.px);
      const ask = Number(book?.levels[1]?.[0]?.px);
      if (bid > 0 && ask > 0) return (bid + ask) / 2;
      if (bid > 0 || ask > 0) return Math.max(bid || 0, ask || 0);
    } catch {
      /* handled below */
    }
    throw new TradeError(`Couldn't get a live price for ${market.symbol}. Try again in a moment.`, "network");
  };

  return {
    dexes,
    states,
    openOrders,
    mid,
    midsByCoin,
    collateral,
    openedAt,

    async getAccount(address) {
      const [st, col] = await Promise.all([states(address), collateral(address)]);
      const summary = summarizeStates(st, col);
      if (!startingBalances.has(address)) startingBalances.set(address, summary.equity);
      return buildAccount(address, summary, startingBalances.get(address) ?? summary.equity, now());
    },

    async getPositions(address) {
      const [st, orders] = await Promise.all([states(address), openOrders(address)]);
      const open = st.flatMap((s) => s.state.assetPositions.filter((p) => num(p.position.szi) !== 0));
      const withPos = [...new Set(open.map((p) => registry.bySymbol(p.position.coin)?.dex ?? ""))];
      const mids = await midsByCoin(withPos);
      return mapPositions(address, st, mids, orders, openedAt, now());
    },

    async getOrders(address, status) {
      if (status && !OPEN_STATUSES.has(status.toUpperCase())) return []; // only open orders are queryable
      return (await openOrders(address)).sort((a, b) => b.timestamp - a.timestamp).map((o) => mapOpenOrder(address, o));
    },

    async getClosedPositions(address, page = 1) {
      const fills = await info.userFills({ user: address as `0x${string}` });
      const all = mapClosedPositions(address, fills);
      const p = Math.max(1, Math.floor(page));
      return {
        data: all.slice((p - 1) * pageSize, p * pageSize),
        total: all.length,
        page: p,
        pageSize,
        totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
      };
    },

    async positionSize(address, market) {
      const r = await info.clearinghouseState({
        user: address as `0x${string}`,
        ...(market.dex ? { dex: market.dex } : {}),
      });
      const found = r.assetPositions.find((p) => p.position.coin === market.coin);
      return found ? num(found.position.szi) : 0;
    },
  };
}

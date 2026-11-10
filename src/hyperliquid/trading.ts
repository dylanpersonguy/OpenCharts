import type { OrderUpdatesWsEvent } from "@nktkas/hyperliquid";
import type { Page, TradingEvent, TradingGateway, Unsubscribe } from "../adapter/types.ts";
import type { Account, ClosedPosition, Order, Position } from "../services/schemas.ts";
import {
  createAccountReader,
  mapOpenOrder,
  mapPositions,
  protectionFor,
  summarizeStates,
  type AccountReader,
  type UnifiedCollateral,
  type DexState,
  type FrontendOpenOrder,
} from "./accountState.ts";
import { getBuilderParam, type Address, type BuilderParam, type HlNetwork } from "./config.ts";
import {
  apiResponseOf,
  classifyFailure,
  createSdkExchange,
  createSdkInfo,
  createSdkStreams,
  ExchangeRunner,
  toTradeError,
  type ExchangeApi,
  type ExchangeFactory,
  type HlInfoApi,
  type HlStreams,
  type StreamHandle,
  type StreamsFactory,
} from "./exchange.ts";
import {
  builderField,
  closeWire,
  DEFAULT_SLIPPAGE,
  defaultLeverageFor,
  formatPx,
  formatSz,
  humanizeHlError,
  newCloid,
  orderEventType,
  parseOrderResponse,
  planClose,
  planOrder,
  positionTpslWire,
  slippagePx,
  TradeError,
  validateLeverage,
  validateTpSl,
  type Cloid,
  type HlPlaceOrderInput,
  type OrderAction,
  type OrderPlan,
  type OrderWire,
  type StatusOutcome,
} from "./orders.ts";
import { hlSession } from "./session.ts";
import type { HlMarket, MarketRegistry } from "./types.ts";

export interface HyperliquidTradingOptions {
  registry: MarketRegistry;
  /** Info API override (tests / shared client). Defaults to an SDK HTTP client for the session network. */
  info?: HlInfoApi;
  /** Builds the signing client from the agent account. Defaults to the SDK ExchangeClient. */
  exchangeFactory?: ExchangeFactory;
  /** Builds the websocket client. Defaults to the SDK SubscriptionClient. */
  streamsFactory?: StreamsFactory;
  /** Market-order slippage (fraction). Default 0.03. */
  slippage?: number;
  /** Leverage applied before the first order on a market with none chosen. Default 5. */
  defaultLeverage?: number;
  /** Prefer cross margin where the market allows it. Default true. */
  preferCross?: boolean;
  /** Builder fee source; defaults to the configured, kill-switchable `getBuilderParam`. */
  getBuilder?: () => BuilderParam | undefined;
  runner?: ExchangeRunner;
  sleep?: (ms: number) => Promise<void>;
  /** REST polling cadence used when the websocket can't be established. Default 5000. */
  pollIntervalMs?: number;
}

export interface LeverageInfo {
  leverage: number;
  isCross: boolean;
  maxLeverage: number;
}

export interface HyperliquidTrading extends TradingGateway {
  placeOrder(input: HlPlaceOrderInput): Promise<Order>;
  setLeverage(symbol: string, leverage: number, isCross: boolean): Promise<void>;
  getLeverage(symbol: string): Promise<LeverageInfo>;
  dispose(): void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const num = (s: string | number | undefined | null): number => {
  const n = Number(s ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const OID_RE = /^\d+$/;
const CLOID_RE = /^0x[0-9a-fA-F]{32}$/;

export function createHyperliquidTrading(opts: HyperliquidTradingOptions): HyperliquidTrading {
  const { registry } = opts;
  const slippage = opts.slippage ?? DEFAULT_SLIPPAGE;
  const defaultLeverage = opts.defaultLeverage ?? 5;
  const preferCross = opts.preferCross ?? true;
  const getBuilder = opts.getBuilder ?? (() => getBuilderParam());
  const runner = opts.runner ?? new ExchangeRunner();
  const sleep = opts.sleep ?? defaultSleep;
  const exchangeFactory = opts.exchangeFactory ?? createSdkExchange;
  const streamsFactory = opts.streamsFactory ?? createSdkStreams;
  const pollIntervalMs = opts.pollIntervalMs ?? 5000;

  // ── Session / clients ──────────────────────────────────────────────────

  const infoByNetwork = new Map<HlNetwork, HlInfoApi>();
  const getInfo = (network: HlNetwork = hlSession.getState().network): HlInfoApi => {
    if (opts.info) return opts.info;
    let i = infoByNetwork.get(network);
    if (!i) {
      i = createSdkInfo(network);
      infoByNetwork.set(network, i);
    }
    return i;
  };

  const readers = new Map<HlNetwork, AccountReader>();
  const getReader = (): AccountReader => {
    const network = hlSession.getState().network;
    let r = readers.get(network);
    if (!r) {
      r = createAccountReader({ info: getInfo(network), registry });
      readers.set(network, r);
    }
    return r;
  };

  const exchanges = new Map<string, ExchangeApi>();
  function ready(): { address: Address; exchange: ExchangeApi } {
    let session;
    try {
      session = hlSession.getState().requireReady();
    } catch (e) {
      throw new TradeError(e instanceof Error ? e.message : "Connect your wallet to trade.", "not_ready");
    }
    const network = hlSession.getState().network;
    const key = `${network}:${session.agent.address}`;
    let ex = exchanges.get(key);
    if (!ex) {
      ex = exchangeFactory(session.agent.account, network);
      exchanges.set(key, ex);
    }
    return { address: session.address, exchange: ex };
  }

  /** Read-only calls only need a connected wallet, not a ready trading session. */
  const readAddress = (): Address | null => hlSession.getState().address;

  async function ensureMarkets(): Promise<void> {
    if (registry.markets().length === 0) await registry.load();
  }

  async function marketFor(symbol: string): Promise<HlMarket> {
    await ensureMarkets();
    const m = registry.bySymbol(symbol);
    if (!m) throw new TradeError(`Unknown market "${symbol}".`, "unknown_market");
    return m;
  }

  // ── Submission with reconciliation ─────────────────────────────────────

  /** Look an order up by client id and express it as the status the exchange would have returned. */
  async function recoverByCloid(address: Address, cloid: Cloid): Promise<StatusOutcome | null> {
    const info = getInfo();
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(400 * (attempt + 1));
      try {
        const st = await info.orderStatus({ user: address, oid: cloid });
        if (st.status !== "order") continue;
        const o = st.order.order;
        const s = st.order.status;
        if (s === "open" || s === "triggered") return { kind: "resting", oid: o.oid, cloid };
        if (s === "filled") {
          // The fill price isn't in the order record (limitPx is the slippage bound, not the
          // average): report 0 = unknown rather than a misleading price.
          return { kind: "filled", oid: o.oid, totalSz: num(o.origSz) - num(o.sz) || num(o.origSz), avgPx: 0, cloid };
        }
        return { kind: "error", message: humanizeHlError(s) };
      } catch {
        /* keep trying */
      }
    }
    return null;
  }

  /**
   * Send an `order` action exactly once. A refusal returns its per-order
   * statuses; a transport failure (outcome unknown) is reconciled by cloid
   * instead of being resent, so a flaky network can never double-submit.
   */
  async function submit(
    exchange: ExchangeApi,
    address: Address,
    action: OrderAction,
  ): Promise<StatusOutcome[]> {
    try {
      const resp = await runner.run(() => exchange.order(action));
      const parsed = parseOrderResponse(resp);
      if (parsed.error) throw new TradeError(parsed.error, parsed.errorCode ?? "exchange");
      return parsed.statuses;
    } catch (e) {
      if (e instanceof TradeError) throw e;
      const kind = classifyFailure(e);
      if (kind === "rejected") {
        const parsed = parseOrderResponse(apiResponseOf(e));
        if (parsed.error) throw new TradeError(parsed.error, parsed.errorCode ?? "exchange");
        if (parsed.statuses.length > 0) return parsed.statuses;
        throw toTradeError(e);
      }
      if (kind !== "ambiguous") throw toTradeError(e);
      // Outcome unknown: reconcile every order we gave a cloid.
      const out: StatusOutcome[] = [];
      let confirmedAny = false;
      for (const wire of action.orders) {
        if (!wire.c) {
          out.push({ kind: "waiting", reason: "trigger" });
          continue;
        }
        const found = await recoverByCloid(address, wire.c as Cloid);
        if (found) confirmedAny = true;
        out.push(found ?? { kind: "error", message: "Order not found on Hyperliquid." });
      }
      if (!confirmedAny) {
        throw new TradeError(
          "Lost connection while sending the order. It wasn't found on Hyperliquid, so it was most likely not placed. Check your open orders before trying again.",
          "unconfirmed",
        );
      }
      return out;
    }
  }

  /** Throw the first per-order error in a batch. */
  function assertNoErrors(statuses: readonly StatusOutcome[], coin?: string): void {
    for (const s of statuses) {
      if (s.kind === "error") throw new TradeError(coin ? `${coin}: ${s.message}` : s.message, s.code ?? "exchange");
    }
  }

  // ── Leverage ───────────────────────────────────────────────────────────

  const leverageDone = new Set<string>();
  const levKey = (address: string, m: HlMarket): string =>
    `${hlSession.getState().network}:${address}:${m.symbol}`;

  async function sendLeverage(exchange: ExchangeApi, m: HlMarket, leverage: number, isCross: boolean): Promise<void> {
    await runner.run(() => exchange.updateLeverage({ asset: m.assetId, isCross, leverage }));
  }

  async function ensureLeverage(
    exchange: ExchangeApi,
    address: Address,
    m: HlMarket,
    want?: { leverage?: number; isCross?: boolean },
  ): Promise<void> {
    const key = levKey(address, m);
    const explicit = want?.leverage !== undefined;
    if (leverageDone.has(key) && !explicit) return;
    const reader = getReader();
    // If we can't tell whether a position is open we must not touch leverage: a failed read is
    // not "no position".
    let szi: number;
    try {
      szi = await reader.positionSize(address, m);
    } catch (e) {
      if (explicit) throw toTradeError(e);
      return;
    }
    let current: { type: "cross" | "isolated"; value: number } | null = null;
    try {
      current = (await getInfo().activeAssetData({ user: address, coin: m.coin })).leverage;
    } catch (e) {
      // Unknown current leverage: never overwrite it with a guess.
      if (explicit) throw toTradeError(e);
      return;
    }

    let target: { leverage: number; isCross: boolean };
    if (explicit) {
      const isCross = want?.isCross ?? (!m.onlyIsolated && preferCross);
      validateLeverage(m, want?.leverage ?? 1, isCross);
      target = { leverage: want?.leverage ?? 1, isCross };
      if (szi !== 0) {
        // Margin mode can't change under an open position; leverage within a mode can.
        if (current.type === "cross" !== isCross) {
          throw new TradeError(
            `You hold a ${m.symbol} position in ${current.type} margin; close it before switching margin mode.`,
          );
        }
      }
    } else {
      if (szi !== 0) {
        leverageDone.add(key); // someone chose this leverage; never change it under a position
        return;
      }
      target = defaultLeverageFor(m, { defaultLeverage, preferCross });
      // A value other than the market maximum means someone already chose it, and an isolated
      // setting on a market that could be cross is a deliberate choice: respect both.
      if (current.value !== m.maxLeverage || (current.type === "isolated" && target.isCross)) {
        leverageDone.add(key);
        return;
      }
    }
    if (current.value === target.leverage && (current.type === "cross") === target.isCross) {
      leverageDone.add(key);
      return;
    }
    try {
      await sendLeverage(exchange, m, target.leverage, target.isCross);
      leverageDone.add(key);
    } catch (e) {
      if (explicit) throw toTradeError(e);
      // A failed *default* must not block trading; the account's existing leverage still applies.
    }
  }

  // ── Order bookkeeping ──────────────────────────────────────────────────

  /** order id (oid or cloid) -> market symbol, learned from our own placements and lookups. */
  const orderCoins = new Map<string, string>();
  const inflight = new Map<string, Promise<Order>>();

  async function lookupOrder(
    address: Address,
    orderId: string,
  ): Promise<{ order: FrontendOpenOrder; status: string } | null> {
    const oid: number | Cloid | null = OID_RE.test(orderId) ? Number(orderId) : CLOID_RE.test(orderId) ? (orderId as Cloid) : null;
    if (oid === null) throw new TradeError(`"${orderId}" is not a valid order id.`);
    const st = await getInfo().orderStatus({ user: address, oid });
    if (st.status !== "order") return null;
    orderCoins.set(orderId, st.order.order.coin);
    return { order: st.order.order, status: st.order.status };
  }

  function orderFromOutcome(
    address: Address,
    input: HlPlaceOrderInput,
    plan: OrderPlan,
    market: HlMarket,
    entry: StatusOutcome,
    note: string | null,
  ): Order {
    const nowIso = new Date().toISOString();
    const oid = entry.kind === "resting" || entry.kind === "filled" ? String(entry.oid) : plan.cloid;
    orderCoins.set(oid, market.symbol);
    const filled = entry.kind === "filled";
    return {
      id: oid,
      accountId: address,
      symbolName: market.symbol,
      side: input.side,
      type: input.type === "STOP_LIMIT" ? "STOP" : input.type,
      quantity: plan.sizeNum,
      price: input.type === "MARKET" ? null : (input.price ?? null),
      stopPrice: input.stopPrice ?? null,
      takeProfit: input.takeProfit ?? null,
      stopLoss: input.stopLoss ?? null,
      status: filled ? "FILLED" : "PENDING",
      filledQuantity: filled ? entry.totalSz : 0,
      avgFillPrice: filled && entry.avgPx > 0 ? entry.avgPx : null,
      comment: note,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  async function doPlace(input: HlPlaceOrderInput): Promise<Order> {
    const { address, exchange } = ready();
    const market = await marketFor(input.symbol);
    const reader = getReader();
    const mid = input.type === "MARKET" ? await reader.mid(market) : 0;
    const plan = planOrder(input, { market, mid, slippage, builder: getBuilder() });
    await ensureLeverage(
      exchange,
      address,
      market,
      input.leverage !== undefined ? { leverage: input.leverage, isCross: input.isCross } : undefined,
    );
    const statuses = await submit(exchange, address, plan.action);
    const [entry, ...children] = statuses;
    if (!entry) throw new TradeError("Hyperliquid returned no status for the order.", "exchange");
    if (entry.kind === "error") throw new TradeError(entry.message, entry.code ?? "exchange");
    const childError = children.find((c): c is Extract<StatusOutcome, { kind: "error" }> => c.kind === "error");
    const note = childError ? `Order placed, but take profit / stop loss was not attached: ${childError.message}` : null;
    return orderFromOutcome(address, input, plan, market, entry, note);
  }

  function placeOrder(input: HlPlaceOrderInput): Promise<Order> {
    const key = JSON.stringify([
      input.symbol, input.side, input.type, input.quantity, input.price, input.stopPrice,
      input.takeProfit, input.stopLoss, input.postOnly, input.reduceOnly,
    ]);
    const existing = inflight.get(key);
    if (existing) return existing; // a double-click must not become two orders
    const p = doPlace(input).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  async function modifyOrder(
    orderId: string,
    mod: { price?: number; stopPrice?: number; quantity?: number; takeProfit?: number | null; stopLoss?: number | null },
  ): Promise<Order> {
    const { address, exchange } = ready();
    if (mod.takeProfit !== undefined || mod.stopLoss !== undefined) {
      throw new TradeError("Change take profit and stop loss on the open position, not on a pending order.");
    }
    const found = await lookupOrder(address, orderId);
    if (!found || found.status !== "open") throw new TradeError("That order is no longer open.");
    const o = found.order;
    const market = await marketFor(o.coin);
    const isBuy = o.side === "B";
    const size = formatSz(mod.quantity ?? num(o.sz), market.szDecimals);
    if (!(Number(size) > 0)) throw new TradeError("Order size must be greater than zero.");
    const cloid = o.cloid ?? newCloid();
    const isMarketTrigger = o.isTrigger && o.orderType.endsWith("Market");
    const triggerPx = mod.stopPrice ?? num(o.triggerPx);
    const base = { a: market.assetId, b: isBuy, s: size, r: o.reduceOnly, c: cloid };
    let wire: OrderWire;
    if (o.isTrigger) {
      const tpsl = o.orderType.startsWith("Take Profit") ? "tp" : "sl";
      wire = {
        ...base,
        p: isMarketTrigger
          ? slippagePx(triggerPx, isBuy, slippage, market.szDecimals)
          : formatPx(mod.price ?? num(o.limitPx), market.szDecimals),
        t: { trigger: { isMarket: isMarketTrigger, triggerPx: formatPx(triggerPx, market.szDecimals), tpsl } },
      };
    } else {
      wire = {
        ...base,
        p: formatPx(mod.price ?? num(o.limitPx), market.szDecimals),
        t: { limit: { tif: o.tif === "Alo" || o.tif === "Ioc" ? o.tif : "Gtc" } },
      };
    }
    // `modify` carries no builder field (SDK schema): see report. It replaces the order in place.
    try {
      await runner.run(() => exchange.modify({ oid: o.oid, order: wire }));
    } catch (e) {
      throw toTradeError(e);
    }
    const after = await lookupOrder(address, cloid);
    if (after) return mapOpenOrder(address, after.order, after.status === "open" ? "PENDING" : after.status.toUpperCase());
    return mapOpenOrder(address, { ...o, sz: size, limitPx: String(wire.p) });
  }

  async function cancelBatch(exchange: ExchangeApi, cancels: Array<{ a: number; o: number }>): Promise<void> {
    for (let i = 0; i < cancels.length; i += 100) {
      const chunk = cancels.slice(i, i + 100);
      try {
        await runner.run(() => exchange.cancel({ cancels: chunk }));
      } catch (e) {
        // The SDK throws if ANY cancel in the chunk errored (HL still processed the rest). An
        // order that is already gone has reached the desired end state, so keep going.
        if (!isAlreadyGone(e)) throw toTradeError(e);
      }
    }
  }

  const isAlreadyGone = (e: unknown): boolean =>
    /already (filled|cancelled|canceled)|never placed/i.test(e instanceof Error ? e.message : "");

  async function cancelOrder(orderId: string): Promise<void> {
    const { address, exchange } = ready();
    let coin = orderCoins.get(orderId);
    if (!coin) {
      const found = await lookupOrder(address, orderId);
      if (!found || found.status !== "open") return; // nothing left to cancel
      coin = found.order.coin;
    }
    const market = await marketFor(coin);
    try {
      if (OID_RE.test(orderId)) {
        await runner.run(() => exchange.cancel({ cancels: [{ a: market.assetId, o: Number(orderId) }] }));
      } else {
        await runner.run(() => exchange.cancelByCloid({ cancels: [{ asset: market.assetId, cloid: orderId as Cloid }] }));
      }
    } catch (e) {
      const err = toTradeError(e);
      // Cancelling something already gone has reached the desired end state.
      if (isAlreadyGone(e)) return;
      throw err;
    }
  }

  async function cancelAllOrders(): Promise<void> {
    const { address, exchange } = ready();
    await ensureMarkets();
    const open = await getReader().openOrders(address);
    const cancels: Array<{ a: number; o: number }> = [];
    for (const o of open) {
      const m = registry.bySymbol(o.coin);
      if (m) cancels.push({ a: m.assetId, o: o.oid });
    }
    if (cancels.length > 0) await cancelBatch(exchange, cancels);
  }

  const closing = new Map<string, Promise<void>>();
  /** A double-click on Close must be one request, not two (a partial close would otherwise run twice). */
  function once(key: string, run: () => Promise<void>): Promise<void> {
    const existing = closing.get(key);
    if (existing) return existing;
    const p = run().finally(() => closing.delete(key));
    closing.set(key, p);
    return p;
  }

  const closePosition = (positionId: string, quantity?: number): Promise<void> =>
    once(`${positionId}|${quantity ?? ""}`, () => doClosePosition(positionId, quantity));
  const closeAllPositions = (): Promise<void> => once("*all*", doCloseAll);

  async function doClosePosition(positionId: string, quantity?: number): Promise<void> {
    const { address, exchange } = ready();
    const market = await marketFor(positionId);
    const reader = getReader();
    const szi = await reader.positionSize(address, market);
    if (szi === 0) throw new TradeError(`You have no open ${market.symbol} position.`);
    const mid = await reader.mid(market);
    const plan = planClose({ market, mid, szi, quantity, slippage, builder: getBuilder() });
    assertNoErrors(await submit(exchange, address, plan.action), market.symbol);
  }

  async function doCloseAll(): Promise<void> {
    const { address, exchange } = ready();
    await ensureMarkets();
    const reader = getReader();
    // Strict: a dex that failed to load must fail the call, not be silently left open.
    const states = await reader.states(address, { strict: true });
    const open = states.flatMap((s) =>
      s.state.assetPositions.map((p) => ({ coin: p.position.coin, szi: num(p.position.szi) })).filter((p) => p.szi !== 0),
    );
    if (open.length === 0) return;
    const mids = await reader.midsByCoin(reader.dexes());
    const wires: OrderWire[] = [];
    const skipped: string[] = [];
    const coins: string[] = [];
    for (const p of open) {
      const market = registry.bySymbol(p.coin);
      const mid = mids.get(p.coin);
      if (!market || mid === undefined) {
        skipped.push(p.coin);
        continue;
      }
      wires.push(closeWire({ market, mid, szi: p.szi, slippage }).wire);
      coins.push(p.coin);
    }
    let unapproved = false;
    const failures: string[] = skipped.map((c) => `${c}: no live price`);
    if (wires.length > 0) {
      const action: OrderAction = { orders: wires, grouping: "na", ...builderField(getBuilder()) };
      const statuses = await submit(exchange, address, action);
      statuses.forEach((s, i) => {
        if (s.kind === "error" && s.code === "builder-fee-unapproved") unapproved = true;
        if (s.kind === "error") failures.push(`${coins[i] ?? "?"}: ${s.message}`);
      });
    }
    if (failures.length > 0) throw new TradeError(`Couldn't close every position. ${failures.join("; ")}`, unapproved ? "builder-fee-unapproved" : "exchange");
  }

  async function modifyPosition(
    positionId: string,
    mod: { takeProfit?: number | null; stopLoss?: number | null },
  ): Promise<Position> {
    const { address, exchange } = ready();
    const market = await marketFor(positionId);
    const reader = getReader();
    const szi = await reader.positionSize(address, market);
    if (szi === 0) throw new TradeError(`You have no open ${market.symbol} position.`);
    const isLong = szi > 0;
    const mid = await reader.mid(market);
    validateTpSl(isLong, mid, mod.takeProfit ?? undefined, mod.stopLoss ?? undefined);

    const orders = await reader.openOrders(address);
    const prot = protectionFor(orders, market.coin, isLong);
    const wires: OrderWire[] = [];
    if (typeof mod.takeProfit === "number") wires.push(positionTpslWire(market, szi, "tp", mod.takeProfit, slippage));
    if (typeof mod.stopLoss === "number") wires.push(positionTpslWire(market, szi, "sl", mod.stopLoss, slippage));

    // Place the replacement first so the position is never unprotected; only then drop the old ones.
    if (wires.length > 0) {
      const action: OrderAction = { orders: wires, grouping: "positionTpsl", ...builderField(getBuilder()) };
      assertNoErrors(await submit(exchange, address, action), market.symbol);
    }
    const stale = [
      ...(mod.takeProfit !== undefined ? prot.tpOids : []),
      ...(mod.stopLoss !== undefined ? prot.slOids : []),
    ];
    if (stale.length > 0) await cancelBatch(exchange, stale.map((o) => ({ a: market.assetId, o })));

    const positions = await reader.getPositions(address);
    const updated = positions.find((p) => p.id === market.coin);
    if (!updated) throw new TradeError(`${market.symbol} position is no longer open.`);
    return updated;
  }

  async function setLeverage(symbol: string, leverage: number, isCross: boolean): Promise<void> {
    const { address, exchange } = ready();
    const market = await marketFor(symbol);
    validateLeverage(market, leverage, isCross);
    try {
      await sendLeverage(exchange, market, leverage, isCross);
    } catch (e) {
      throw toTradeError(e);
    }
    leverageDone.add(levKey(address, market));
  }

  async function getLeverage(symbol: string): Promise<LeverageInfo> {
    const address = readAddress();
    if (!address) throw new TradeError("Connect your wallet first.", "not_ready");
    const market = await marketFor(symbol);
    const r = await getInfo().activeAssetData({ user: address, coin: market.coin });
    return { leverage: r.leverage.value, isCross: r.leverage.type === "cross", maxLeverage: market.maxLeverage };
  }

  // ── Reads ──────────────────────────────────────────────────────────────

  const withAddress = async <T>(empty: T, fn: (a: Address) => Promise<T>): Promise<T> => {
    const a = readAddress();
    if (!a) return empty;
    await ensureMarkets();
    return fn(a);
  };

  const getAccounts = (): Promise<Account[]> =>
    withAddress<Account[]>([], async (a) => [await getReader().getAccount(a)]);
  const getPositions = (): Promise<Position[]> => withAddress<Position[]>([], (a) => getReader().getPositions(a));
  const getOrders = (_accountId: string, status?: string): Promise<Order[]> =>
    withAddress<Order[]>([], (a) => getReader().getOrders(a, status));
  const getClosedPositions = (_accountId: string, page = 1): Promise<Page<ClosedPosition>> =>
    withAddress<Page<ClosedPosition>>(
      { data: [], total: 0, page, pageSize: 20, totalPages: 1 },
      (a) => getReader().getClosedPositions(a, page),
    );

  // ── Live events ────────────────────────────────────────────────────────

  const handlers = new Set<(e: TradingEvent) => void>();
  const emit = (e: TradingEvent): void => {
    for (const h of [...handlers]) {
      try {
        h(e);
      } catch {
        /* one bad listener must not break the others */
      }
    }
  };

  interface Live {
    key: string;
    address: Address;
    network: HlNetwork;
    streams: HlStreams | null;
    handles: StreamHandle[];
    offReconnect: (() => void) | null;
    timer: ReturnType<typeof setInterval> | null;
    debounce: ReturnType<typeof setTimeout> | null;
    positions: Map<string, Position>;
    account: string;
    ordersCache: FrontendOpenOrder[];
    mids: Map<string, number>;
    openOids: Map<number, FrontendOpenOrder>;
    seenStatus: Set<string>;
    dead: boolean;
    /** Monotonic clock ordering REST snapshots and websocket pushes; stale results are dropped. */
    clock: number;
    applied: number;
    collateral: UnifiedCollateral | null;
  }
  let live: Live | null = null;
  let offSession: (() => void) | null = null;

  const positionSig = (p: Position): string =>
    [p.quantity, p.entryPrice, p.unrealizedPnl.toFixed(6), p.takeProfit, p.stopLoss, p.side].join("|");

  function applyStates(l: Live, states: DexState[], silent: boolean, missing: ReadonlySet<string> = new Set()): void {
    const tracker = getReader().openedAt;
    const next = mapPositions(l.address, states, l.mids, l.ordersCache, tracker);
    const nextById = new Map<string, Position>();
    // A dex that failed to load this tick says nothing about its positions: keep them rather than
    // announcing a close that never happened.
    if (missing.size > 0) {
      for (const [id, prev] of l.positions) {
        if (missing.has(registry.bySymbol(id)?.dex ?? "")) nextById.set(id, prev);
      }
    }
    for (const p of next) {
      // A tick without a fresh mid keeps the last known price instead of blanking it.
      const prev = l.positions.get(p.id);
      const withPrice = p.currentPrice === undefined && prev?.currentPrice !== undefined ? { ...p, currentPrice: prev.currentPrice } : p;
      nextById.set(p.id, withPrice);
    }
    if (!silent) {
      for (const [id, p] of nextById) {
        const prev = l.positions.get(id);
        if (!prev) emit({ type: "position.opened", accountId: l.address, positionId: id, entity: p });
        else if (positionSig(prev) !== positionSig(p)) {
          emit({
            type: "position.updated",
            accountId: l.address,
            positionId: id,
            entity: p,
            unrealizedPnl: p.unrealizedPnl,
            quantity: p.quantity,
            averagePrice: p.entryPrice,
          });
        }
      }
      for (const id of l.positions.keys()) {
        if (!nextById.has(id)) emit({ type: "position.closed", accountId: l.address, positionId: id });
      }
    }
    l.positions = nextById;

    if (missing.size > 0) return; // partial data would understate the account
    const s = summarizeStates(states, l.collateral);
    const sig = [s.equity, s.balance, s.freeMargin, s.margin].map((n) => n.toFixed(6)).join("|");
    if (sig !== l.account) {
      const first = l.account === "";
      l.account = sig;
      if (!silent && !first) {
        emit({
          type: "account.updated",
          accountId: l.address,
          equity: s.equity,
          balance: s.balance,
          freeMargin: s.freeMargin,
          marginUsed: s.margin,
        });
      }
    }
  }

  /** Full REST refresh of positions + account (and the order set used for TP/SL). */
  async function syncState(l: Live, silent = false): Promise<void> {
    const token = ++l.clock;
    try {
      await ensureMarkets();
      const reader = getReader();
      const [states, orders, collateral] = await Promise.all([
        reader.states(l.address),
        reader.openOrders(l.address),
        reader.collateral(l.address).catch(() => l.collateral),
      ]);
      if (l.dead) return;
      l.ordersCache = orders;
      l.collateral = collateral;
      const dexes = new Set<string>();
      for (const s of states) for (const p of s.state.assetPositions) dexes.add(registry.bySymbol(p.position.coin)?.dex ?? s.dex);
      const mids = await reader.midsByCoin([...dexes]).catch(() => new Map<string, number>());
      if (l.dead) return;
      for (const [k, v] of mids) l.mids.set(k, v);
      // A newer snapshot (another sync, or a websocket push) already landed: this one is stale.
      if (token < l.applied) return;
      l.applied = token;
      const present = new Set(states.map((x) => x.dex));
      applyStates(l, states, silent, new Set(reader.dexes().filter((d) => !present.has(d))));
    } catch {
      /* transient; the next tick or reconnect re-syncs */
    }
  }

  function scheduleSync(l: Live): void {
    if (l.debounce) return;
    l.debounce = setTimeout(() => {
      l.debounce = null;
      void syncState(l);
    }, 250);
  }

  function emitOrder(l: Live, type: NonNullable<ReturnType<typeof orderEventType>>, o: Parameters<typeof mapOpenOrder>[1], status: string): void {
    emit({ type, accountId: l.address, orderId: String(o.oid), entity: mapOpenOrder(l.address, o, status) });
  }

  function onOrderUpdates(l: Live, events: OrderUpdatesWsEvent): void {
    if (l.dead) return;
    let touchedTrigger = false;
    for (const u of events) {
      const type = orderEventType(u.status);
      if (!type) continue;
      const dedupe = `${u.order.oid}:${u.status}`;
      if (l.seenStatus.has(dedupe)) continue;
      l.seenStatus.add(dedupe);
      if (l.seenStatus.size > 2000) l.seenStatus = new Set([...l.seenStatus].slice(-1000));
      const label = type === "order.placed" ? "PENDING" : type === "order.filled" ? "FILLED" : type === "order.rejected" ? "REJECTED" : "CANCELED";
      emitOrder(l, type, u.order, label);
      if (type === "order.placed") l.openOids.set(u.order.oid, u.order as unknown as FrontendOpenOrder);
      else l.openOids.delete(u.order.oid);
      if ((u.order as { reduceOnly?: boolean }).reduceOnly) touchedTrigger = true;
    }
    if (touchedTrigger) scheduleSync(l);
  }

  /** Reconcile the open-order set by REST: covers reconnect gaps and the polling fallback. */
  async function pollOrders(l: Live, silent = false): Promise<void> {
    try {
      const orders = await getReader().openOrders(l.address);
      if (l.dead) return;
      const nextIds = new Set(orders.map((o) => o.oid));
      if (!silent) {
        for (const o of orders) if (!l.openOids.has(o.oid)) emitOrder(l, "order.placed", o, "PENDING");
        for (const [oid, old] of l.openOids) {
          if (nextIds.has(oid)) continue;
          let type: NonNullable<ReturnType<typeof orderEventType>> = "order.canceled";
          try {
            const st = await getInfo().orderStatus({ user: l.address, oid });
            if (st.status === "order") type = orderEventType(st.order.status) ?? "order.canceled";
          } catch {
            /* default to canceled */
          }
          emitOrder(l, type, old, type === "order.filled" ? "FILLED" : type === "order.rejected" ? "REJECTED" : "CANCELED");
        }
      }
      l.openOids = new Map(orders.map((o) => [o.oid, o]));
      l.ordersCache = orders;
    } catch {
      /* try again next tick */
    }
  }

  function stopLive(): void {
    const l = live;
    live = null;
    if (!l) return;
    l.dead = true;
    if (l.timer) clearInterval(l.timer);
    if (l.debounce) clearTimeout(l.debounce);
    l.offReconnect?.();
    for (const h of l.handles) void h.unsubscribe().catch(() => undefined);
    l.streams?.close();
  }

  function startPolling(l: Live): void {
    if (l.timer || l.dead) return;
    l.timer = setInterval(() => {
      void syncState(l);
      void pollOrders(l);
    }, pollIntervalMs);
  }

  async function startLive(address: Address, network: HlNetwork): Promise<void> {
    const key = `${network}:${address}`;
    if (live?.key === key) return;
    stopLive();
    const l: Live = {
      key, address, network, streams: null, handles: [], offReconnect: null, timer: null, debounce: null,
      positions: new Map(), account: "", ordersCache: [], mids: new Map(), openOids: new Map(),
      seenStatus: new Set(), dead: false, clock: 0, applied: 0, collateral: null,
    };
    live = l;
    await syncState(l, true); // seed baselines without emitting
    await pollOrders(l, true);
    if (l.dead) return;
    try {
      const streams = streamsFactory(network);
      l.streams = streams;
      l.offReconnect = streams.onReconnect(() => {
        void syncState(l);
        void pollOrders(l);
      });
      l.handles = await Promise.all([
        streams.orderUpdates(address, (e) => onOrderUpdates(l, e)),
        streams.userFills(address, (e) => {
          if (!l.dead && e.isSnapshot !== true) scheduleSync(l);
        }),
        streams.allDexsClearinghouseState(address, (e) => {
          if (l.dead) return;
          l.applied = ++l.clock; // supersedes any REST snapshot still in flight
          applyStates(l, e.clearinghouseStates.map(([dex, state]) => ({ dex, state })), false);
        }),
      ]);
      if (l.dead) for (const h of l.handles) void h.unsubscribe().catch(() => undefined);
    } catch {
      startPolling(l); // websocket unavailable: degrade to REST polling
    }
  }

  function syncLiveWithSession(): void {
    if (handlers.size === 0) return;
    const { address, network } = hlSession.getState();
    if (!address) {
      stopLive();
      return;
    }
    void startLive(address, network);
  }

  function subscribe(handler: (e: TradingEvent) => void): Unsubscribe {
    handlers.add(handler);
    if (!offSession) {
      let last = hlSession.getState();
      offSession = hlSession.subscribe((s) => {
        if (s.address !== last.address || s.network !== last.network) syncLiveWithSession();
        last = s;
      });
    }
    syncLiveWithSession();
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        stopLive();
        offSession?.();
        offSession = null;
      }
    };
  }

  function dispose(): void {
    handlers.clear();
    stopLive();
    offSession?.();
    offSession = null;
    inflight.clear();
    closing.clear();
    exchanges.clear(); // drop references to the agent signing accounts
  }

  return {
    getAccounts,
    getPositions,
    getOrders,
    getClosedPositions,
    placeOrder,
    modifyOrder,
    cancelOrder,
    cancelAllOrders,
    closePosition,
    closeAllPositions,
    modifyPosition,
    subscribe,
    setLeverage,
    getLeverage,
    dispose,
  };
}

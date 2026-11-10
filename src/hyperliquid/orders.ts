import type { ExchangeClient } from "@nktkas/hyperliquid";
import { MAX_PERP_BUILDER_FEE_TENTHS_BP, type BuilderParam } from "./config.ts";
import type { HlMarket } from "./types.ts";
import type { PlaceOrderInput } from "../services/schemas.ts";

/**
 * Pure order construction for Hyperliquid: price/size formatting, mapping a
 * terminal `PlaceOrderInput` onto the wire `order` action, and parsing /
 * humanising exchange responses. Nothing in here touches the network or the
 * session, so it is exhaustively unit-testable.
 */

/** The `order` action body the SDK accepts (before it adds nonce and signature). */
export type OrderAction = Parameters<ExchangeClient["order"]>[0];
export type OrderWire = OrderAction["orders"][number];
export type Cloid = `0x${string}`;

export const DEFAULT_SLIPPAGE = 0.03;
/** Hyperliquid rejects non-reduce-only orders worth less than this (USD). */
export const MIN_ORDER_NOTIONAL_USD = 10;
/** Perps: at most 5 significant figures and (6 - szDecimals) decimal places. */
const MAX_PERP_DECIMALS = 6;
const MAX_SIG_FIGS = 5;

// ── Errors ────────────────────────────────────────────────────────────────

export type TradeErrorCode =
  | "validation"
  | "min_notional"
  | "unknown_market"
  | "not_ready"
  | "exchange"
  | "network"
  | "rate_limit"
  | "unconfirmed"
  | "builder-fee-unapproved";

/** Every failure the trading gateway reports. `message` is safe to show verbatim. */
export class TradeError extends Error {
  readonly code: TradeErrorCode;
  constructor(message: string, code: TradeErrorCode = "validation") {
    super(message);
    this.name = "TradeError";
    this.code = code;
  }
}

const BUILDER_UNAPPROVED_RE = /builder fee has not been approved|builder.*(not approved|approve)/i;

/** Stable machine-readable code for a raw Hyperliquid error, decided BEFORE the text is humanised. */
export function codeForHlError(raw: string): TradeErrorCode {
  return BUILDER_UNAPPROVED_RE.test(raw) ? "builder-fee-unapproved" : "exchange";
}

/** True for any TradeError caused by the user not having approved the builder fee. */
export function isBuilderFeeUnapprovedError(err: unknown): boolean {
  return err instanceof TradeError && err.code === "builder-fee-unapproved";
}

// ── Number formatting ─────────────────────────────────────────────────────

export type Rounding = "nearest" | "up" | "down";

/** Round `v` (already scaled to an integer grid) while ignoring float noise like 12345.000000001. */
function roundGrid(v: number, mode: Rounding): number {
  const r = Math.round(v);
  if (Math.abs(v - r) < 1e-9 * Math.max(1, Math.abs(v))) return r;
  if (mode === "up") return Math.ceil(v);
  if (mode === "down") return Math.floor(v);
  return r;
}

function stripZeros(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/**
 * Format a price to Hyperliquid's tick rules: at most 5 significant figures and
 * at most (6 - szDecimals) decimals; integer prices are always valid.
 * `rounding` lets marketable prices round in the aggressive direction.
 */
export function formatPx(price: number, szDecimals: number, rounding: Rounding = "nearest"): string {
  if (!Number.isFinite(price) || price <= 0) throw new TradeError("Price must be a positive number.");
  const maxDecimals = Math.max(0, MAX_PERP_DECIMALS - szDecimals);
  const intDigits = Math.floor(Math.log10(price)) + 1;
  const decimals = Math.min(maxDecimals, Math.max(0, MAX_SIG_FIGS - intDigits));
  const scale = 10 ** decimals;
  const rounded = roundGrid(price * scale, rounding) / scale;
  if (!(rounded > 0)) throw new TradeError("Price is below the smallest tick for this market.");
  return stripZeros(rounded.toFixed(decimals));
}

/** Format a size, always rounding DOWN to `szDecimals` (never over-sizes an order). */
export function formatSz(size: number, szDecimals: number): string {
  if (!Number.isFinite(size) || size < 0) throw new TradeError("Size must be a positive number.");
  const scale = 10 ** szDecimals;
  const rounded = roundGrid(size * scale, "down") / scale;
  return stripZeros(rounded.toFixed(szDecimals));
}

/** Marketable limit price: `ref` pushed `slippage` through the book, rounded aggressively. */
export function slippagePx(ref: number, isBuy: boolean, slippage: number, szDecimals: number): string {
  if (!(slippage > 0 && slippage <= 0.5)) {
    throw new TradeError("Slippage must be between 0 and 50%.");
  }
  const px = isBuy ? ref * (1 + slippage) : ref * (1 - slippage);
  return formatPx(px, szDecimals, isBuy ? "up" : "down");
}

/** Smallest size (at `szDecimals`) whose notional at `ref` reaches the $10 minimum. */
export function minSizeFor(ref: number, szDecimals: number): number {
  const scale = 10 ** szDecimals;
  return Math.ceil(roundGrid((MIN_ORDER_NOTIONAL_USD / ref) * scale, "up")) / scale;
}

/** 16 random bytes as `0x` + 32 hex, the Hyperliquid client order id format. */
export function newCloid(): Cloid {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const BUILDER_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** The builder object for an action: capped at the perps maximum no matter what config says. */
export function builderField(builder: BuilderParam | undefined): { builder?: { b: `0x${string}`; f: number } } {
  // An injected builder source is not trusted to be well-formed: HL wants a lowercase 20-byte address
  // and an integer fee, and a malformed value must degrade to "no fee", never to a rejected order.
  if (!builder || !BUILDER_ADDRESS_RE.test(builder.b)) return {};
  const f = Math.min(Math.floor(Number(builder.f)), MAX_PERP_BUILDER_FEE_TENTHS_BP);
  if (!Number.isFinite(f) || f <= 0) return {};
  return { builder: { b: builder.b.toLowerCase() as `0x${string}`, f } };
}

// ── Planning ──────────────────────────────────────────────────────────────

/** Terminal-side extras beyond `PlaceOrderInput`; all optional so a plain input is valid. */
export interface HlOrderExtras {
  /** LIMIT only: add-liquidity-only (Alo) so the order never takes. */
  postOnly?: boolean;
  /** Only reduce an existing position. Exempt from the $10 minimum. */
  reduceOnly?: boolean;
  /** Market-order slippage as a fraction (default 0.03). */
  slippage?: number;
  /** Leverage to set before this order, if the market has none configured yet. */
  leverage?: number;
  /** Margin mode for `leverage`. Defaults to cross unless the market is isolated-only. */
  isCross?: boolean;
}
export type HlPlaceOrderInput = PlaceOrderInput & HlOrderExtras;

export interface PlanContext {
  market: HlMarket;
  /** Current mid price; required for MARKET and used as the reference for validation. */
  mid: number;
  slippage?: number;
  builder?: BuilderParam;
  cloid?: Cloid;
}

export interface OrderPlan {
  action: OrderAction;
  /** Client order id of the ENTRY order (index 0). */
  cloid: Cloid;
  /** Size string as sent. */
  size: string;
  sizeNum: number;
  /** Price the order will rest/execute around, used for notional checks and the returned Order. */
  refPrice: number;
  notional: number;
  hasTpsl: boolean;
}

function isPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function triggerWire(
  market: HlMarket,
  isBuy: boolean,
  triggerPx: number,
  size: string,
  tpsl: "tp" | "sl",
  slippage: number,
  reduceOnly: boolean,
): OrderWire {
  return {
    a: market.assetId,
    b: isBuy,
    p: slippagePx(triggerPx, isBuy, slippage, market.szDecimals),
    s: size,
    r: reduceOnly,
    t: { trigger: { isMarket: true, triggerPx: formatPx(triggerPx, market.szDecimals), tpsl } },
  };
}

/** Throws when TP/SL sit on the wrong side of the reference price. */
export function validateTpSl(
  isBuy: boolean,
  ref: number,
  takeProfit: number | null | undefined,
  stopLoss: number | null | undefined,
): void {
  if (takeProfit != null) {
    if (!isPositive(takeProfit)) throw new TradeError("Take profit must be a positive price.");
    if (isBuy ? takeProfit <= ref : takeProfit >= ref) {
      throw new TradeError(
        `Take profit must be ${isBuy ? "above" : "below"} the entry price (${ref}) for a ${isBuy ? "long" : "short"}.`,
      );
    }
  }
  if (stopLoss != null) {
    if (!isPositive(stopLoss)) throw new TradeError("Stop loss must be a positive price.");
    if (isBuy ? stopLoss >= ref : stopLoss <= ref) {
      throw new TradeError(
        `Stop loss must be ${isBuy ? "below" : "above"} the entry price (${ref}) for a ${isBuy ? "long" : "short"}.`,
      );
    }
  }
}

/**
 * Map a terminal order onto a Hyperliquid `order` action.
 *
 *   MARKET      -> Ioc limit at mid +/- slippage
 *   LIMIT       -> Gtc (Alo with postOnly)
 *   STOP        -> trigger order, isMarket, tpsl "sl"
 *   STOP_LIMIT  -> trigger order, limit, tpsl "sl"
 *   + TP / SL   -> reduce-only trigger children, grouping "normalTpsl"
 *
 * The builder object (our fee) is placed on the action, so it covers the entry
 * and any grouped children in one signature.
 */
export function planOrder(input: HlPlaceOrderInput, ctx: PlanContext): OrderPlan {
  const { market } = ctx;
  const slippage = input.slippage ?? ctx.slippage ?? DEFAULT_SLIPPAGE;
  const isBuy = input.side === "BUY";
  const reduceOnly = input.reduceOnly === true;

  if (!isPositive(input.quantity)) throw new TradeError("Order size must be greater than zero.");
  const size = formatSz(input.quantity, market.szDecimals);
  const sizeNum = Number(size);
  if (!(sizeNum > 0)) {
    const step = 10 ** -market.szDecimals;
    throw new TradeError(
      `Size ${input.quantity} is below the smallest increment for ${market.displayName || market.symbol} (${step.toFixed(market.szDecimals)}).`,
    );
  }

  let refPrice: number;
  let entry: OrderWire;
  const common = { a: market.assetId, b: isBuy, s: size, r: reduceOnly, c: ctx.cloid ?? newCloid() };
  const cloid = common.c;

  switch (input.type) {
    case "MARKET": {
      if (!isPositive(ctx.mid)) {
        throw new TradeError(`No live price for ${market.symbol} yet, so a market order can't be priced. Try again in a moment.`);
      }
      refPrice = ctx.mid;
      entry = { ...common, p: slippagePx(ctx.mid, isBuy, slippage, market.szDecimals), t: { limit: { tif: "Ioc" } } };
      break;
    }
    case "LIMIT": {
      if (!isPositive(input.price)) throw new TradeError("A limit order needs a price.");
      refPrice = Number(formatPx(input.price, market.szDecimals));
      entry = {
        ...common,
        p: formatPx(input.price, market.szDecimals),
        t: { limit: { tif: input.postOnly ? "Alo" : "Gtc" } },
      };
      break;
    }
    case "STOP": {
      if (!isPositive(input.stopPrice)) throw new TradeError("A stop order needs a trigger (stop) price.");
      refPrice = Number(formatPx(input.stopPrice, market.szDecimals));
      entry = {
        ...common,
        p: slippagePx(input.stopPrice, isBuy, slippage, market.szDecimals),
        t: { trigger: { isMarket: true, triggerPx: formatPx(input.stopPrice, market.szDecimals), tpsl: "sl" } },
      };
      break;
    }
    case "STOP_LIMIT": {
      if (!isPositive(input.stopPrice)) throw new TradeError("A stop-limit order needs a trigger (stop) price.");
      if (!isPositive(input.price)) throw new TradeError("A stop-limit order needs a limit price.");
      refPrice = Number(formatPx(input.price, market.szDecimals));
      entry = {
        ...common,
        p: formatPx(input.price, market.szDecimals),
        t: { trigger: { isMarket: false, triggerPx: formatPx(input.stopPrice, market.szDecimals), tpsl: "sl" } },
      };
      break;
    }
    default:
      throw new TradeError(`Unsupported order type: ${String((input as { type: unknown }).type)}.`);
  }

  const notional = sizeNum * refPrice;
  if (!reduceOnly && notional < MIN_ORDER_NOTIONAL_USD) {
    const minSize = minSizeFor(refPrice, market.szDecimals);
    throw new TradeError(
      `Order value $${notional.toFixed(2)} is below Hyperliquid's $${MIN_ORDER_NOTIONAL_USD} minimum. Increase the size to at least ${minSize} ${market.displayName || market.symbol}.`,
      "min_notional",
    );
  }

  const hasTpsl = input.takeProfit != null || input.stopLoss != null;
  if (hasTpsl && reduceOnly) {
    throw new TradeError("Take profit / stop loss can't be attached to a reduce-only order.");
  }
  validateTpSl(isBuy, refPrice, input.takeProfit, input.stopLoss);

  const orders: OrderWire[] = [entry];
  if (input.takeProfit != null) orders.push(triggerWire(market, !isBuy, input.takeProfit, size, "tp", slippage, true));
  if (input.stopLoss != null) orders.push(triggerWire(market, !isBuy, input.stopLoss, size, "sl", slippage, true));

  return {
    action: { orders, grouping: hasTpsl ? "normalTpsl" : "na", ...builderField(ctx.builder) },
    cloid,
    size,
    sizeNum,
    refPrice,
    notional,
    hasTpsl,
  };
}

export interface ClosePlanContext {
  market: HlMarket;
  mid: number;
  /** Signed position size (`szi`): >0 long, <0 short. */
  szi: number;
  /** Partial close size; omitted closes the whole position. */
  quantity?: number;
  slippage?: number;
  builder?: BuilderParam;
  cloid?: Cloid;
}

/** The single reduce-only wire order that closes (part of) a position. */
export function closeWire(ctx: Omit<ClosePlanContext, "builder">): { wire: OrderWire; size: string; cloid: Cloid } {
  const { market, szi } = ctx;
  if (!isPositive(ctx.mid)) {
    throw new TradeError(`No live price for ${market.symbol} yet, so the position can't be closed at market. Try again in a moment.`);
  }
  const open = Math.abs(szi);
  if (!(open > 0)) throw new TradeError(`You have no open ${market.symbol} position.`);
  let target = open;
  if (ctx.quantity !== undefined) {
    if (!isPositive(ctx.quantity)) throw new TradeError("Close size must be greater than zero.");
    target = Math.min(ctx.quantity, open);
  }
  // A full close sends the exact position size; partials round down to the size grid.
  const size = target === open ? stripZeros(open.toFixed(Math.max(market.szDecimals, 0))) : formatSz(target, market.szDecimals);
  if (!(Number(size) > 0)) throw new TradeError("Close size is below the smallest increment for this market.");
  const isBuy = szi < 0; // closing a short buys
  const cloid = ctx.cloid ?? newCloid();
  return {
    size,
    cloid,
    wire: {
      a: market.assetId,
      b: isBuy,
      p: slippagePx(ctx.mid, isBuy, ctx.slippage ?? DEFAULT_SLIPPAGE, market.szDecimals),
      s: size,
      r: true,
      t: { limit: { tif: "Ioc" } },
      c: cloid,
    },
  };
}

export function planClose(ctx: ClosePlanContext): { action: OrderAction; size: string; cloid: Cloid } {
  const { wire, size, cloid } = closeWire(ctx);
  return { action: { orders: [wire], grouping: "na", ...builderField(ctx.builder) }, size, cloid };
}

/** Reduce-only market-style trigger for a position-level TP or SL. */
export function positionTpslWire(
  market: HlMarket,
  szi: number,
  kind: "tp" | "sl",
  triggerPx: number,
  slippage = DEFAULT_SLIPPAGE,
): OrderWire {
  if (!isPositive(triggerPx)) throw new TradeError(`${kind === "tp" ? "Take profit" : "Stop loss"} must be a positive price.`);
  const open = Math.abs(szi);
  if (!(open > 0)) throw new TradeError(`You have no open ${market.symbol} position.`);
  return triggerWire(market, szi < 0, triggerPx, stripZeros(open.toFixed(market.szDecimals)), kind, slippage, true);
}

/** TP/SL sanity relative to the position entry. */
export function validatePositionTpSl(
  isLong: boolean,
  entry: number,
  takeProfit: number | null | undefined,
  stopLoss: number | null | undefined,
): void {
  validateTpSl(isLong, entry, takeProfit, stopLoss);
}

/** Validate a leverage / margin-mode request against the market's constraints. */
export function validateLeverage(market: HlMarket, leverage: number, isCross: boolean): void {
  if (!Number.isInteger(leverage) || leverage < 1) {
    throw new TradeError("Leverage must be a whole number of at least 1x.");
  }
  if (leverage > market.maxLeverage) {
    throw new TradeError(`${market.displayName || market.symbol} allows at most ${market.maxLeverage}x leverage.`);
  }
  if (isCross && market.onlyIsolated) {
    throw new TradeError(`${market.displayName || market.symbol} only supports isolated margin.`);
  }
}

/** Default margin mode and leverage for a market that has nothing configured. */
export function defaultLeverageFor(
  market: HlMarket,
  opts: { defaultLeverage: number; preferCross: boolean },
): { leverage: number; isCross: boolean } {
  return {
    leverage: Math.max(1, Math.min(market.maxLeverage, opts.defaultLeverage)),
    isCross: !market.onlyIsolated && opts.preferCross,
  };
}

// ── Response parsing ──────────────────────────────────────────────────────

export type StatusOutcome =
  | { kind: "resting"; oid: number; cloid?: string }
  | { kind: "filled"; oid: number; totalSz: number; avgPx: number; cloid?: string }
  | { kind: "waiting"; reason: "fill" | "trigger" }
  | { kind: "error"; message: string; code?: TradeErrorCode };

export interface ParsedOrderResponse {
  statuses: StatusOutcome[];
  /** Set when the whole request was refused (`{status:"err"}`), not an individual order. */
  error?: string;
  errorCode?: TradeErrorCode;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Parse an `order`/`batchModify` response, or the `response` carried by an SDK ApiRequestError. */
export function parseOrderResponse(resp: unknown): ParsedOrderResponse {
  if (!isRecord(resp)) return { statuses: [], error: "Unexpected response from Hyperliquid." };
  if (resp.status === "err") {
    const rawErr = typeof resp.response === "string" ? resp.response : "Order rejected.";
    return { statuses: [], error: humanizeHlError(rawErr), errorCode: codeForHlError(rawErr) };
  }
  const response = resp.response;
  const data = isRecord(response) && isRecord(response.data) ? response.data : undefined;
  const raw = data?.statuses;
  if (!Array.isArray(raw)) return { statuses: [] };
  const statuses = raw.map((s): StatusOutcome => {
    if (s === "waitingForFill") return { kind: "waiting", reason: "fill" };
    if (s === "waitingForTrigger") return { kind: "waiting", reason: "trigger" };
    if (isRecord(s)) {
      if (typeof s.error === "string") return { kind: "error", message: humanizeHlError(s.error), code: codeForHlError(s.error) };
      const filled = s.filled;
      if (isRecord(filled)) {
        return {
          kind: "filled",
          oid: Number(filled.oid),
          totalSz: Number(filled.totalSz),
          avgPx: Number(filled.avgPx),
          ...(typeof filled.cloid === "string" ? { cloid: filled.cloid } : {}),
        };
      }
      const resting = s.resting;
      if (isRecord(resting)) {
        return {
          kind: "resting",
          oid: Number(resting.oid),
          ...(typeof resting.cloid === "string" ? { cloid: resting.cloid } : {}),
        };
      }
    }
    return { kind: "error", message: "Unrecognised order status from Hyperliquid." };
  });
  return { statuses };
}

const ERROR_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/insufficient margin/i, "Not enough margin for this order. Reduce the size, lower the leverage, or add funds."],
  [/minimum value of \$?10|min(imum)? (order )?value/i, `Order value is below Hyperliquid's $${MIN_ORDER_NOTIONAL_USD} minimum. Increase the size.`],
  [/reduce only order would increase|reduce only.*(increase|would)/i, "Reduce-only order rejected: it would increase your position."],
  [/too far from.*(oracle|reference)|more than \d+% away|price.*away from.*(reference|oracle)/i, "Price is too far from the market price. Use a price closer to the current market."],
  [/could not immediately match|no liquidity/i, "No liquidity at this price right now, so the order was not filled. Try again or use a wider slippage."],
  [/post only order would have immediately matched|bad alo/i, "Post-only order would have matched immediately and was rejected. Use a price that rests on the book."],
  [/invalid price|tick|price must be divisible/i, "Price isn't valid for this market's tick size."],
  [/invalid size|size.*(too small|zero)|order has zero size|sz decimals/i, "Order size isn't valid for this market (too small or too many decimals)."],
  [/too many cumulative requests|rate limit|too many requests/i, "Hyperliquid is rate-limiting requests. Wait a few seconds and try again."],
  [/user or api wallet.*does not exist|api wallet.*not|agent.*(not found|expired|invalid)/i, "Your trading key is no longer authorised. Re-enable trading from the wallet menu."],
  [/builder fee has not been approved|builder.*(not approved|approve)/i, "The trading fee hasn't been approved yet. Approve it from the wallet menu to place orders."],
  [/cannot place more than|too many open orders|tooManyOpenOrders/i, "You have too many open orders on Hyperliquid. Cancel some and try again."],
  [/isolated.*(only|required)|cross margin.*not allowed|cannot (use|set) cross/i, "This market only supports isolated margin."],
  [/leverage.*(exceed|too high|above)|max leverage/i, "Leverage is higher than this market allows."],
  [/open interest|oi cap|perpMaxPosition|max position/i, "The market has reached its open-interest or position cap. Reduce the size."],
  [/already canceled|never placed|already filled|cannot modify (canceled|filled)/i, "That order is already filled or cancelled."],
  [/trigger.*(price|px)|invalid tp\/sl|badTriggerPx/i, "Stop/take-profit trigger price isn't valid for the current market price."],
  [/insufficient spot balance|insufficient balance/i, "Insufficient balance."],
  [/not enough.*(available|free)/i, "Not enough free balance for this action."],
];

/** Redact anything that looks like a hex secret/signature before it reaches a user or a log. */
export function redactSecrets(s: string): string {
  return s.replace(/0x[0-9a-fA-F]{64,}/g, "[redacted]");
}

/** Turn a Hyperliquid error string into a message a trader can act on. */
export function humanizeHlError(raw: string): string {
  const clean = redactSecrets(raw).trim();
  for (const [re, message] of ERROR_RULES) {
    if (re.test(clean)) return message;
  }
  return clean.length > 0 ? `Hyperliquid rejected the order: ${clean.slice(0, 200)}` : "Hyperliquid rejected the order.";
}

/** Order-status strings from `orderStatus` / `orderUpdates` -> terminal event type. */
export function orderEventType(
  status: string,
): "order.placed" | "order.filled" | "order.canceled" | "order.rejected" | null {
  if (status === "open") return "order.placed";
  if (status === "filled") return "order.filled";
  if (status === "triggered") return null; // becomes a market order; its fill is reported separately
  if (/Rejected$/.test(status) || status === "rejected") return "order.rejected";
  if (/Canceled$/.test(status) || status === "canceled" || status === "scheduledCancel") return "order.canceled";
  return null;
}

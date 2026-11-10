import { useEffect, useId, useMemo, useState } from "react";
import { TrendingDown, TrendingUp, Zap, Volume2, VolumeX, AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { DisconnectedTradingBanner } from "../../components/ConnectionIndicator.tsx";
import { usePlaceOrder } from "../../services/queries.ts";
import { toast } from "../../services/toast.ts";
import { cn, formatCurrency } from "../../lib/utils.ts";
import type { OrderPanelProps } from "../../pages/trading/OrderPanel.tsx";
import { useMarketRiskNotice } from "../compliance/index.ts";
import { getBuilderParam } from "../config.ts";
import { isBuilderFeeApprovalError } from "../feeConfig.ts";
import { formatFeeDisclosure, formatRoundTripDisclosure, formatUsd, hip3FeeMultiplier } from "../fees.ts";
import { ConnectButton } from "../onboarding/index.ts";
import { DEFAULT_SLIPPAGE, type HlPlaceOrderInput } from "../orders.ts";
import { useHlSession } from "../session.ts";
import type { HlMarket } from "../types.ts";
import { getHlRegistry, getHlTrading } from "./mode.ts";
import { formatPrice } from "./format.ts";
import { MIN_ORDER_USD, baseUnit, checkSize, estimateTicket, floorSize } from "./orderMath.ts";
import { useHlUi } from "./uiStore.ts";

type Side = "BUY" | "SELL";
type OrderType = "MARKET" | "LIMIT" | "STOP";

const DEFAULT_LEVERAGE = 5;
const QUICK_USD = [25, 100, 500] as const;
const label = "text-[10px] text-muted-foreground uppercase tracking-wider";
const input = "w-full mt-1 text-sm font-mono";

const positive = (s: string): number | null => {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

function useMarket(symbol: string): HlMarket | null {
  const [, force] = useState(0);
  const registry = getHlRegistry();
  const market = registry?.bySymbol(symbol) ?? null;
  // The registry loads asynchronously; re-check once if the market is not there yet.
  useEffect(() => {
    if (market || !registry) return;
    let live = true;
    registry
      .load()
      .then(() => live && force((n) => n + 1))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [market, registry, symbol]);
  return market;
}

/** Margin mode + leverage controls, wired to `trading.setLeverage`. */
function LeverageControls(props: {
  market: HlMarket;
  leverage: number;
  isCross: boolean;
  applied: { leverage: number; isCross: boolean } | null;
  ready: boolean;
  onLeverage: (n: number) => void;
  onCross: (cross: boolean) => void;
  onApply: () => void;
  applying: boolean;
}) {
  const { market, leverage, isCross, applied, ready } = props;
  const id = useId();
  // Free-form text while typing; clamped only once it is a valid leverage (so "1" then "2" can become 12).
  const [draft, setDraft] = useState<string | null>(null);
  const isolatedOnly = market.onlyIsolated;
  const dirty = !applied || applied.leverage !== leverage || applied.isCross !== isCross;
  const isolatedWhy = market.marginMode === "strictIsolated"
    ? "This market only allows isolated margin, and margin cannot be removed once added."
    : "This market only allows isolated margin.";

  return (
    <fieldset className="space-y-1" data-testid="leverage-controls">
      <legend className={label}>Margin &amp; leverage</legend>
      <div className="grid grid-cols-2 gap-1" role="group" aria-label="Margin mode">
        <button
          type="button"
          aria-pressed={!isCross}
          onClick={() => props.onCross(false)}
          className={cn(
            "rounded border border-border px-1 py-1 text-[10px]",
            !isCross ? "bg-primary text-primary-foreground border-primary" : "hover:bg-secondary",
          )}
        >
          Isolated
        </button>
        <button
          type="button"
          aria-pressed={isCross}
          disabled={isolatedOnly}
          title={isolatedOnly ? isolatedWhy : "Share margin across all your cross positions"}
          onClick={() => props.onCross(true)}
          className={cn(
            "rounded border border-border px-1 py-1 text-[10px] disabled:cursor-not-allowed disabled:opacity-50",
            isCross ? "bg-primary text-primary-foreground border-primary" : "hover:bg-secondary",
          )}
        >
          Cross
        </button>
      </div>
      {isolatedOnly && (
        <p className="text-[10px] text-muted-foreground" data-testid="isolated-only-note">
          {isolatedWhy}
        </p>
      )}
      <div className="flex items-center gap-2">
        <input
          id={`${id}-range`}
          type="range"
          min={1}
          max={market.maxLeverage}
          step={1}
          value={leverage}
          aria-label="Leverage"
          onChange={(e) => {
            setDraft(null);
            props.onLeverage(Number(e.target.value));
          }}
          className="flex-1"
        />
        <input
          type="text"
          inputMode="numeric"
          value={draft ?? String(leverage)}
          aria-label="Leverage multiplier"
          onChange={(e) => {
            const text = e.target.value.replace(/[^0-9]/g, "");
            setDraft(text);
            const n = Number(text);
            if (text !== "" && n >= 1) props.onLeverage(Math.min(market.maxLeverage, n));
          }}
          onBlur={() => setDraft(null)}
          className="w-14 text-center text-sm font-mono"
        />
        <span className="text-xs text-muted-foreground">x</span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Max {market.maxLeverage}x</span>
        {ready && dirty && (
          <button
            type="button"
            onClick={props.onApply}
            disabled={props.applying}
            className="rounded bg-secondary px-2 py-0.5 text-foreground hover:bg-border disabled:opacity-50"
          >
            {props.applying ? "Applying…" : "Apply"}
          </button>
        )}
      </div>
    </fieldset>
  );
}

export function HlOrderPanel({
  symbol,
  tick,
  accountId,
  oneClick,
  onToggleOneClick,
  onConfirmOrder,
  isFeedConnected = true,
  soundMuted,
  onToggleMute,
  onOrderSuccess,
}: OrderPanelProps) {
  const uid = useId();
  const status = useHlSession((s) => s.status);
  const openSetup = useHlUi((s) => s.openSetup);
  const market = useMarket(symbol);
  const riskNotice = useMarketRiskNotice(symbol);
  const placeOrder = usePlaceOrder();

  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [postOnly, setPostOnly] = useState(false);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [leverageState, setLeverage] = useState(DEFAULT_LEVERAGE);
  const [crossState, setCross] = useState(true);
  const [applied, setApplied] = useState<{ leverage: number; isCross: boolean } | null>(null);
  const [applying, setApplying] = useState(false);

  const ready = status === "ready";
  const maxLev = market?.maxLeverage ?? 1;
  const leverage = Math.min(Math.max(1, leverageState), maxLev);
  const isCross = market?.onlyIsolated ? false : crossState;
  const unit = market ? baseUnit(market) : "";
  // Hyperliquid's own fee for this market: 1x core, 2x HIP-3 (deployer scale 1), 0.2x in growth mode.
  const feeMult = market ? (market.hlFeeMultiplier ?? (market.dex === "" ? 1 : hip3FeeMultiplier({}))) : 1;

  // Read the leverage the exchange already has for this market (per user).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loadKey = ready && market ? `${symbol}` : null;
  if (loadKey !== loadedFor) {
    setLoadedFor(loadKey);
    setApplied(null);
  }
  useEffect(() => {
    const trading = getHlTrading();
    if (!loadKey || !trading) return;
    let live = true;
    trading
      .getLeverage(loadKey)
      .then((l) => {
        if (!live) return;
        setLeverage(l.leverage);
        setCross(l.isCross);
        setApplied({ leverage: l.leverage, isCross: l.isCross });
      })
      .catch(() => undefined); // not fatal: the user can still set and apply one
    return () => {
      live = false;
    };
  }, [loadKey]);

  const priceNum = positive(price);
  const stopNum = positive(stopPrice);
  const refPrice =
    orderType === "LIMIT" && priceNum
      ? priceNum
      : orderType === "STOP" && stopNum
        ? stopNum
        : tick
          ? side === "BUY"
            ? tick.ask
            : tick.bid
          : null;

  const sizeCheck = useMemo(
    () => (market ? checkSize(size, market, refPrice, reduceOnly) : { size: null, notional: null, error: null }),
    [market, size, refPrice, reduceOnly],
  );
  const builderTenths = getBuilderParam()?.f ?? 0;
  const estimate = useMemo(
    () =>
      market && sizeCheck.size && refPrice
        ? estimateTicket({
            side,
            size: sizeCheck.size,
            price: refPrice,
            leverage,
            maxLeverage: market.maxLeverage,
            isCross,
            isMaker: orderType === "LIMIT" && postOnly,
            builderFeeTenthsBp: builderTenths,
            hlFeeMultiplier: feeMult,
            ...(market.marginTiers ? { marginTiers: market.marginTiers } : {}),
          })
        : null,
    [market, sizeCheck.size, refPrice, side, leverage, isCross, orderType, postOnly, builderTenths, feeMult],
  );
  // With nothing typed yet, still show the rate card (amounts at $0).
  const rateCard = useMemo(
    () =>
      estimateTicket({
        side,
        size: 0,
        price: 1,
        leverage: 1,
        maxLeverage: 1,
        isCross: true,
        isMaker: orderType === "LIMIT" && postOnly,
        builderFeeTenthsBp: builderTenths,
        hlFeeMultiplier: feeMult,
      }),
    [side, orderType, postOnly, builderTenths, feeMult],
  );

  const priceError =
    orderType === "LIMIT" && !priceNum ? "Enter a limit price." : orderType === "STOP" && !stopNum ? "Enter a trigger price." : null;
  const canSubmit =
    ready && !!accountId && !!market && sizeCheck.size !== null && !sizeCheck.error && !priceError && isFeedConnected;

  const applyLeverage = async (): Promise<boolean> => {
    const trading = getHlTrading();
    if (!trading || !market) return false;
    setApplying(true);
    try {
      await trading.setLeverage(symbol, leverage, isCross);
      setApplied({ leverage, isCross });
      toast.success("Leverage updated", `${market.displayName || symbol}: ${isCross ? "cross" : "isolated"} ${leverage}x`);
      return true;
    } catch (err) {
      toast.error("Could not change leverage", err instanceof Error ? err.message : "Request failed");
      return false;
    } finally {
      setApplying(false);
    }
  };

  const handleSubmit = () => {
    if (!canSubmit || !market || !accountId || sizeCheck.size === null) return;
    const order: HlPlaceOrderInput = {
      accountId,
      symbol,
      side,
      type: orderType,
      quantity: sizeCheck.size,
      ...(orderType === "LIMIT" && priceNum ? { price: priceNum } : {}),
      ...(orderType === "STOP" && stopNum ? { stopPrice: stopNum } : {}),
      ...(positive(takeProfit) ? { takeProfit: positive(takeProfit) as number } : {}),
      ...(positive(stopLoss) ? { stopLoss: positive(stopLoss) as number } : {}),
      ...(orderType === "LIMIT" && postOnly ? { postOnly: true } : {}),
      ...(reduceOnly ? { reduceOnly: true } : {}),
      leverage,
      isCross,
    };

    const doSubmit = async () => {
      // What you see is what you get: make the exchange's leverage match the ticket first.
      const needsSync = !applied || applied.leverage !== leverage || applied.isCross !== isCross;
      if (needsSync && !reduceOnly && !(await applyLeverage())) throw new Error("Leverage was not updated.");
      return placeOrder.mutateAsync(order, {
        onSuccess: () => {
          toast.success("Order sent", `${side} ${size} ${unit} ${market.displayName || symbol} (${orderType})`);
          onOrderSuccess?.();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Failed to place order";
          // A rejected builder fee opens the "fee settings changed" dialog; no extra toast needed.
          if (!isBuilderFeeApprovalError(msg)) toast.error("Order failed", msg);
        },
      });
    };

    if (oneClick && orderType === "MARKET") {
      doSubmit().catch(() => undefined);
      return;
    }

    const rows: Array<{ label: string; value: string; hint?: string; tone?: "warning" }> = [];
    if (estimate) {
      rows.push({ label: "Order value", value: formatCurrency(estimate.notional), hint: `${size} ${unit}` });
      rows.push({
        label: "Margin mode",
        value: `${isCross ? "Cross" : "Isolated"} ${leverage}x`,
      });
      rows.push({ label: "Margin required", value: `~${formatCurrency(estimate.marginRequired)}` });
      rows.push({
        label: "Est. fees (this order)",
        value: `~${formatUsd(estimate.fees.total)}`,
        hint: `platform ${formatUsd(estimate.fees.builderFee)} + exchange ~${formatUsd(estimate.fees.hlFee)}`,
      });
      rows.push({
        label: "Est. fees (open + close)",
        value: `~${formatUsd(estimate.roundTrip.total)}`,
        hint: "platform fee applies on both",
      });
      rows.push(
        estimate.liquidationPx
          ? { label: "Est. liquidation", value: formatPrice(estimate.liquidationPx), hint: "estimate", tone: "warning" }
          : { label: "Liquidation", value: isCross ? "Depends on your whole account (cross)" : "n/a" },
      );
    }
    if (reduceOnly) rows.push({ label: "Reduce only", value: "Yes" });
    if (orderType === "LIMIT" && postOnly) rows.push({ label: "Post only", value: "Yes" });
    if (orderType === "MARKET") {
      rows.push({
        label: "Max slippage",
        value: `${(DEFAULT_SLIPPAGE * 100).toFixed(0)}%`,
        hint: "market orders may fill away from the quote",
      });
    }
    const confirmable = { ...order, _submit: doSubmit, details: rows, notice: riskNotice?.body };
    if (onConfirmOrder) {
      onConfirmOrder(confirmable);
      return;
    }
    doSubmit().catch(() => undefined);
  };

  const sideBtn = side === "BUY" ? "buy" : "sell";
  let primary: React.ReactNode;
  if (status === "disconnected" || status === "connecting" || status === "error") {
    primary = (
      <div className="[&>div]:w-full [&_button]:w-full" data-testid="connect-cta">
        <ConnectButton />
      </div>
    );
  } else if (status === "needs-agent" || status === "needs-builder-approval") {
    primary = (
      <Button className="w-full" onClick={() => openSetup("trade")}>
        Enable trading
      </Button>
    );
  } else {
    primary = (
      <Button
        variant={sideBtn}
        className="w-full"
        onClick={handleSubmit}
        loading={placeOrder.isPending || applying}
        disabled={!canSubmit || placeOrder.isPending || applying}
      >
        {!isFeedConnected
          ? "Disconnected — Trading Disabled"
          : !accountId
            ? "Loading account…"
            : `${side === "BUY" ? "Buy" : "Sell"}${market ? ` ${size || ""} ${unit}` : ""}`.replace(/\s+/g, " ").trim()}
      </Button>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="order-form">
      <div className="flex items-center justify-between border-b border-border bg-secondary px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">New Order</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={soundMuted ? "Unmute trade sounds" : "Mute trade sounds"}
            className="flex items-center rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground hover:bg-secondary"
          >
            {soundMuted ? <VolumeX className="h-2.5 w-2.5" /> : <Volume2 className="h-2.5 w-2.5" />}
          </button>
          <button
            type="button"
            onClick={onToggleOneClick}
            aria-pressed={!!oneClick}
            title="One-click trading: skip confirmation for market orders"
            className={cn(
              "flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-medium",
              oneClick ? "border-buy/30 bg-buy/15 text-buy" : "border-border text-muted-foreground hover:bg-secondary",
            )}
          >
            <Zap className="h-2.5 w-2.5" />
            1-Click
          </button>
          <span className="text-xs font-semibold">{market?.displayName || symbol}</span>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-1">
          <Button variant={side === "BUY" ? "buy" : "outline"} size="sm" onClick={() => setSide("BUY")} className="text-xs">
            <TrendingUp className="mr-1 h-3 w-3" />
            BUY {tick ? formatPrice(tick.ask) : ""}
          </Button>
          <Button variant={side === "SELL" ? "sell" : "outline"} size="sm" onClick={() => setSide("SELL")} className="text-xs">
            <TrendingDown className="mr-1 h-3 w-3" />
            SELL {tick ? formatPrice(tick.bid) : ""}
          </Button>
        </div>

        <div>
          <span className={label}>Order type</span>
          <div className="mt-1 grid grid-cols-3 gap-1" role="group" aria-label="Order type">
            {(["MARKET", "LIMIT", "STOP"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={t === orderType}
                onClick={() => setOrderType(t)}
                className={cn(
                  "rounded border border-border px-1 py-1 text-[10px]",
                  t === orderType ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {orderType === "LIMIT" && (
          <div>
            <label htmlFor={`${uid}-price`} className={label}>
              Limit price
            </label>
            <input
              id={`${uid}-price`}
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={tick ? formatPrice(side === "BUY" ? tick.ask : tick.bid) : ""}
              className={input}
            />
            <label className="mt-1 flex items-center gap-1.5 text-[11px]">
              <input type="checkbox" checked={postOnly} onChange={(e) => setPostOnly(e.target.checked)} />
              Post only
              <span className="text-muted-foreground">(never takes liquidity; cancelled instead of filling immediately)</span>
            </label>
          </div>
        )}

        {orderType === "STOP" && (
          <div>
            <label htmlFor={`${uid}-stop`} className={label}>
              Trigger price
            </label>
            <input
              id={`${uid}-stop`}
              type="text"
              inputMode="decimal"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              className={input}
            />
          </div>
        )}

        <div>
          <label htmlFor={`${uid}-size`} className={label}>
            Size {unit && `(${unit})`}
          </label>
          <input
            id={`${uid}-size`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            aria-invalid={!!sizeCheck.error}
            aria-describedby={`${uid}-size-help`}
            placeholder={market ? `min $${MIN_ORDER_USD}` : ""}
            className={cn(input, sizeCheck.error && "border-destructive")}
          />
          <div className="mt-1 flex gap-1">
            {QUICK_USD.map((usd) => (
              <button
                key={usd}
                type="button"
                disabled={!market || !refPrice}
                onClick={() => market && refPrice && setSize(String(floorSize(usd / refPrice, market.szDecimals)))}
                className="flex-1 rounded border border-border py-0.5 text-[10px] hover:bg-secondary disabled:opacity-40"
              >
                ${usd}
              </button>
            ))}
          </div>
          <p id={`${uid}-size-help`} className="mt-1 min-h-4 text-[11px]" data-testid="size-help">
            {sizeCheck.error ? (
              <span role="alert" className="text-destructive">
                {sizeCheck.error}
              </span>
            ) : sizeCheck.size && sizeCheck.notional !== null ? (
              <span className="text-muted-foreground">
                {sizeCheck.size} {unit} = <span className="font-mono">{formatCurrency(sizeCheck.notional)}</span> notional
              </span>
            ) : (
              <span className="text-muted-foreground">
                {market ? `Up to ${market.szDecimals} decimals. Minimum order $${MIN_ORDER_USD}.` : "Loading market…"}
              </span>
            )}
          </p>
          {priceError && size && <p className="text-[11px] text-destructive">{priceError}</p>}
        </div>

        <label className="flex items-center gap-1.5 text-[11px]">
          <input type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} />
          Reduce only
          <span className="text-muted-foreground">(can only shrink an open position)</span>
        </label>

        {market && (
          <LeverageControls
            market={market}
            leverage={leverage}
            isCross={isCross}
            applied={applied}
            ready={ready}
            onLeverage={setLeverage}
            onCross={setCross}
            onApply={() => void applyLeverage()}
            applying={applying}
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`${uid}-tp`} className={label}>
              Take profit
            </label>
            <input id={`${uid}-tp`} type="text" inputMode="decimal" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor={`${uid}-sl`} className={label}>
              Stop loss
            </label>
            <input id={`${uid}-sl`} type="text" inputMode="decimal" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className={input} />
          </div>
        </div>

        <div
          className="space-y-1 rounded border border-border/50 bg-secondary/50 p-2 text-[10px]"
          data-testid="fee-disclosure"
          aria-live="polite"
        >
          <p>{formatFeeDisclosure((estimate ?? rateCard).fees)}</p>
          <p className="text-muted-foreground">
            {builderTenths > 0
              ? "The platform fee is charged on every fill: when you open a position and again when you close it."
              : "No platform fee. Hyperliquid's own fees apply on open and close."}
          </p>
          {estimate && <p className="text-muted-foreground">{formatRoundTripDisclosure(estimate.roundTrip)}</p>}
          {market && market.dex !== "" && (
            <p className="text-muted-foreground" data-testid="hip3-fee-note">
              Third-party (HIP-3) market: {Number(feeMult.toFixed(2))}x the standard Hyperliquid rate
              {feeMult < 1 ? " (growth mode: protocol fees reduced 90%)" : ""}. Your tier, staking and referral discounts may lower it.
            </p>
          )}
        </div>

        {estimate && (
          <div className="space-y-1 rounded bg-secondary p-2 text-[10px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Margin required</span>
              <span className="font-mono">~{formatCurrency(estimate.marginRequired)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Est. liquidation</span>
              <span className="font-mono">
                {estimate.liquidationPx ? formatPrice(estimate.liquidationPx) : isCross ? "Account-wide (cross)" : "--"}
              </span>
            </div>
          </div>
        )}

        {riskNotice && (
          <p className="flex items-start gap-1 text-[10px] text-amber-500" data-testid="risk-notice">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span>{riskNotice.title}: {riskNotice.body}</span>
          </p>
        )}

        {!isFeedConnected && <DisconnectedTradingBanner />}
        {primary}
      </div>
    </div>
  );
}

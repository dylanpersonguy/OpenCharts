import { useState } from "react";
import {
  Minus,
  Plus,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Zap,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useAuthStore } from "../../services/store.tsx";
import { usePlaceOrder } from "../../services/queries.ts";
import { readTraderPrefs } from "../../hooks/useTraderPreferences.ts";
import { Button } from "../../components/ui/button.tsx";
import { DisconnectedTradingBanner } from "../../components/ConnectionIndicator.tsx";
import type { PlaceOrderInput } from "../../services/schemas.ts";
import { toast } from "../../services/toast.ts";
import { formatCurrency, formatNumber, cn } from "../../lib/utils.ts";

type ConfirmableOrder = PlaceOrderInput & { _submit: () => Promise<unknown> };

export interface OrderPanelProps {
  symbol: string;
  symbolInfo?: {
    name?: string;
    description?: string;
    pipSize?: number;
    pricescale?: number;
    contractSize?: number;
    marginPercent?: number;
    commission?: number;
    [k: string]: unknown;
  };
  tick?: { bid: number; ask: number; timestamp: number };
  accountId: string | null;
  oneClick?: boolean;
  onToggleOneClick?: () => void;
  onConfirmOrder?: (order: ConfirmableOrder) => void;
  accountBalance?: number;
  isFeedConnected?: boolean;
  soundMuted?: boolean;
  onToggleMute?: () => void;
  onOrderSuccess?: () => void;
}

export function OrderPanel({
  symbol,
  symbolInfo,
  tick,
  accountId,
  oneClick,
  onToggleOneClick,
  onConfirmOrder,
  accountBalance,
  isFeedConnected = true,
  soundMuted,
  onToggleMute,
  onOrderSuccess,
}: OrderPanelProps) {
  const isDemo = useAuthStore((s) => s.isDemo);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP">("MARKET");
  const [quantity, setQuantity] = useState(() => {
    const prefs = readTraderPrefs();
    const raw = prefs.defaultQty;
    if (raw) {
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n > 0) return String(Math.round(n * 100) / 100);
    }
    return "0.1";
  });
  const [price, setPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");

  const placeOrder = usePlaceOrder();

  const handleSubmit = () => {
    if (!isFeedConnected) {
      toast.warning("No Data Feed", "Cannot place orders while disconnected from the data feed");
      return;
    }
    if (!accountId) {
      toast.warning("No Account", "Please select a trading account first");
      return;
    }
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      toast.warning("Invalid Quantity", "Quantity must be a positive number");
      return;
    }
    if (qty > 1000) {
      toast.warning("Invalid Quantity", "Maximum quantity is 1000 lots");
      return;
    }
    if (orderType === "LIMIT" && (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0)) {
      toast.warning("Missing Price", "Limit orders require a valid price");
      return;
    }
    if (
      orderType === "STOP" &&
      (!stopPrice || isNaN(parseFloat(stopPrice)) || parseFloat(stopPrice) <= 0)
    ) {
      toast.warning("Missing Stop Price", "Stop orders require a valid stop price");
      return;
    }
    const effectiveType = orderType;

    const input: PlaceOrderInput = {
      accountId,
      symbol,
      side,
      type: effectiveType as PlaceOrderInput["type"],
      quantity: qty,
    };

    if (orderType === "LIMIT" && price) input.price = parseFloat(price);
    if (orderType === "STOP" && stopPrice) input.stopPrice = parseFloat(stopPrice);
    if (takeProfit) input.takeProfit = parseFloat(takeProfit) || undefined;
    if (stopLoss) input.stopLoss = parseFloat(stopLoss) || undefined;

    const doSubmit = () =>
      placeOrder.mutateAsync(input, {
        onSuccess: () => {
          toast.success("Order Sent", `${side} ${qty} ${symbol} (${effectiveType})`);
          onOrderSuccess?.();
        },
        onError: (err: unknown) => {
          const e = err as {
            error?: { code?: string; message?: string };
            message?: string;
            code?: string;
          };
          const code = e?.error?.code ?? e?.code;
          const msg = e?.error?.message || e?.message || "Failed to place order";
          if (code === "ACCOUNT_PASSED") {
            toast.success("Account Passed!", msg);
          } else if (code === "ACCOUNT_FAILED") {
            toast.error("Account Failed", msg);
          } else if (code === "REQUEST_TIMEOUT") {
            toast.error(
              "Order Timed Out",
              "The server didn't respond in time. Check your connection and try again.",
            );
          } else {
            toast.error("Order Failed", msg);
          }
        },
      });

    if (oneClick && orderType === "MARKET") {
      doSubmit().catch(() => {});
      return;
    }

    if (onConfirmOrder) {
      onConfirmOrder({
        accountId,
        symbol,
        side,
        type: effectiveType,
        quantity: qty,
        price: input.price,
        stopPrice: input.stopPrice,
        takeProfit: input.takeProfit,
        stopLoss: input.stopLoss,
        _submit: doSubmit,
      });
      return;
    }

    doSubmit();
  };

  const quickQty = [0.01, 0.05, 0.1, 0.5, 1.0];

  return (
    <div className="flex flex-col h-full" data-testid="order-form">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          New Order
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleMute}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium border transition-colors",
              !soundMuted
                ? "bg-accent/15 text-accent border-accent/30"
                : "text-muted-foreground border-border hover:bg-secondary",
            )}
            title={soundMuted ? "Unmute trade sounds" : "Mute trade sounds"}
          >
            {soundMuted ? <VolumeX className="h-2.5 w-2.5" /> : <Volume2 className="h-2.5 w-2.5" />}
          </button>
          <button
            onClick={onToggleOneClick}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium border transition-colors",
              oneClick
                ? "bg-buy/15 text-buy border-buy/30"
                : "text-muted-foreground border-border hover:bg-secondary",
            )}
            title="One-click trading: skip confirmation for market orders"
          >
            <Zap className="h-2.5 w-2.5" />
            1-Click
          </button>
          <span className="text-xs font-semibold">{symbol}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Side */}
        <div className="grid grid-cols-2 gap-1">
          <Button
            variant={side === "BUY" ? "buy" : "outline"}
            size="sm"
            onClick={() => setSide("BUY")}
            className="text-xs"
          >
            <TrendingUp className="h-3 w-3 mr-1" />
            BUY {tick ? formatNumber(tick.ask, 5) : ""}
          </Button>
          <Button
            variant={side === "SELL" ? "sell" : "outline"}
            size="sm"
            onClick={() => setSide("SELL")}
            className="text-xs"
          >
            <TrendingDown className="h-3 w-3 mr-1" />
            SELL {tick ? formatNumber(tick.bid, 5) : ""}
          </Button>
        </div>

        {/* Order Type */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Order Type
          </label>
          <div className="grid grid-cols-3 gap-1 mt-1">
            {(["MARKET", "LIMIT", "STOP"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setOrderType(t)}
                className={cn(
                  "px-1 py-1 text-[10px] rounded border border-border",
                  t === orderType
                    ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-secondary",
                )}
              >
                {t.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        {/* Quantity */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Volume (lots)
          </label>
          <div className="flex items-center gap-1 mt-1">
            <button
              onClick={() =>
                setQuantity((v) => String(Math.max(0.01, parseFloat(v) - 0.01).toFixed(2)))
              }
              className="px-2 py-1 rounded bg-secondary hover:bg-border"
            >
              <Minus className="h-3 w-3" />
            </button>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="flex-1 text-center text-sm font-mono"
              step="0.01"
              min="0.01"
            />
            <button
              onClick={() => setQuantity((v) => String((parseFloat(v) + 0.01).toFixed(2)))}
              className="px-2 py-1 rounded bg-secondary hover:bg-border"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <div className="flex gap-1 mt-1">
            {quickQty.map((q) => (
              <button
                key={q}
                onClick={() => setQuantity(String(q))}
                className={cn(
                  "flex-1 text-[10px] py-0.5 rounded border border-border",
                  parseFloat(quantity) === q ? "bg-secondary" : "hover:bg-secondary/50",
                )}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {orderType === "LIMIT" && (
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Price
            </label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={tick ? formatNumber(side === "BUY" ? tick.ask : tick.bid, 5) : ""}
              className="w-full mt-1 text-sm font-mono"
              step="0.00001"
            />
          </div>
        )}

        {orderType === "STOP" && (
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Stop Price
            </label>
            <input
              type="number"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              className="w-full mt-1 text-sm font-mono"
              step="0.00001"
            />
          </div>
        )}

        {/* TP / SL */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Take Profit
            </label>
            <input
              type="number"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              className="w-full mt-1 text-sm font-mono"
              step="0.00001"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Stop Loss
            </label>
            <input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              className="w-full mt-1 text-sm font-mono"
              step="0.00001"
            />
          </div>
        </div>

        {/* Risk-per-trade display */}
        {(() => {
          const slVal = parseFloat(stopLoss);
          const tpVal = parseFloat(takeProfit);
          const qtyVal = parseFloat(quantity) || 0;
          const contractSize = symbolInfo?.contractSize || 100000;
          const currentPrice = tick ? (side === "BUY" ? tick.ask : tick.bid) : null;

          if (!currentPrice || !slVal || qtyVal <= 0) return null;

          const slDistance = Math.abs(currentPrice - slVal);
          const riskDollar = slDistance * qtyVal * contractSize;
          const balance = accountBalance || 0;
          const riskPct = balance > 0 ? (riskDollar / balance) * 100 : 0;
          const tpDollar = tpVal ? Math.abs(tpVal - currentPrice) * qtyVal * contractSize : null;
          const rrRatio = tpDollar && riskDollar > 0 ? tpDollar / riskDollar : null;

          const riskColor =
            riskPct > 5 ? "text-destructive" : riskPct > 2 ? "text-warning" : "text-buy";

          return (
            <div className="bg-secondary/50 rounded p-2 text-[10px] space-y-1 border border-border/50">
              <div className="flex items-center gap-1 mb-1">
                <AlertTriangle className={cn("h-3 w-3", riskColor)} />
                <span className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground">
                  Risk Analysis
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Risk Amount</span>
                <span className={cn("font-mono font-semibold", riskColor)}>
                  {formatCurrency(riskDollar)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Risk % of Balance</span>
                <span className={cn("font-mono font-semibold", riskColor)}>
                  {riskPct.toFixed(2)}%
                </span>
              </div>
              {tpDollar != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reward</span>
                  <span className="font-mono text-buy">{formatCurrency(tpDollar)}</span>
                </div>
              )}
              {rrRatio != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">R:R Ratio</span>
                  <span
                    className={cn(
                      "font-mono font-semibold",
                      rrRatio >= 2 ? "text-buy" : rrRatio >= 1 ? "text-foreground" : "text-sell",
                    )}
                  >
                    1:{rrRatio.toFixed(2)}
                  </span>
                </div>
              )}
              {riskPct > 5 && (
                <div className="text-destructive text-[9px] flex items-center gap-1 mt-1">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  High risk — exceeds 5% of balance
                </div>
              )}
            </div>
          );
        })()}

        {/* Margin info */}
        {symbolInfo && tick && (
          <div className="bg-secondary rounded p-2 text-[10px] space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Contract Size</span>
              <span>{symbolInfo.contractSize?.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Margin Required</span>
              <span>
                {formatCurrency(
                  (parseFloat(quantity) || 0) *
                    (symbolInfo.contractSize ?? 0) *
                    (side === "BUY" ? tick.ask : tick.bid) *
                    ((symbolInfo.marginPercent ?? 0) / 100),
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Commission</span>
              <span>
                {formatCurrency((symbolInfo.commission ?? 0) * (parseFloat(quantity) || 0))}
              </span>
            </div>
          </div>
        )}

        {isDemo && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded p-2 text-center">
            <p className="text-amber-400 text-[10px] font-semibold uppercase tracking-wider">
              Demo Mode
            </p>
            <p className="text-muted-foreground text-[10px] mt-0.5">
              Trading is disabled in demo mode
            </p>
          </div>
        )}
        {!isDemo && !isFeedConnected && <DisconnectedTradingBanner />}
        <Button
          variant={side === "BUY" ? "buy" : "sell"}
          className="w-full"
          onClick={handleSubmit}
          loading={placeOrder.isPending}
          disabled={!accountId || placeOrder.isPending || isDemo || !isFeedConnected}
        >
          {isDemo
            ? "Demo — Trading Disabled"
            : !isFeedConnected
              ? "Disconnected — Trading Disabled"
              : placeOrder.isPending
                ? "Placing…"
                : `${side === "BUY" ? "Buy" : "Sell"} ${quantity} ${symbol}`}
        </Button>

        {placeOrder.isError && (
          <p className="text-destructive text-xs mt-1 p-1.5 bg-destructive/10 rounded">
            {(placeOrder.error as { message?: string } | null)?.message || "Order failed"}
          </p>
        )}
        {placeOrder.isSuccess && (
          <p className="text-buy text-xs mt-1 p-1.5 bg-buy/10 rounded">Order placed successfully</p>
        )}
      </div>
    </div>
  );
}

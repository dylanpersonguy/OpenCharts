import { useState } from "react";
import { api } from "../../../services/api.ts";
import type { PlaceOrderInput, Position } from "../../../services/schemas.ts";
import { toast } from "../../../services/toast.ts";
import { MarketClosedBanner } from "../../trading/MarketClosedBanner.tsx";
import {
  ChartArea,
  type TerminalTradingApi,
  TradingDialogsHost,
  useTerminalTrading,
} from "../../trading/useTerminalTrading.tsx";
import { getPipDigits } from "../../trading/utils.ts";
import { ThemeBottomPanel, ThemeChartToolbar, ThemeSplitter } from "../theme-chrome.tsx";
import { fmtSigned, useDarkThemeScope } from "../theme-kit.tsx";
import "./helm.css";

/* ── Marquee ticker (duplicated track for seamless loop) ────── */

function MarqueeTicker({ t }: { t: TerminalTradingApi }) {
  return (
    <div className="hm-marquee shrink-0">
      <div className="hm-marquee-track">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex" aria-hidden={copy === 1}>
            {t.symbols.map((s) => {
              const tick = t.ticks[s.name];
              return (
                <button
                  key={`${copy}-${s.name}`}
                  type="button"
                  tabIndex={copy === 1 ? -1 : 0}
                  className="hm-tick"
                  data-active={s.name === t.selectedSymbol}
                  onClick={() => t.setSelectedSymbol(s.name)}
                >
                  {s.name}
                  <span className="tabular-nums">
                    {tick ? tick.bid.toFixed(getPipDigits(s, s.name)) : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Positions rail (custom compact cards) ──────────────────── */

function PositionCard({ p, onModify }: { p: Position; onModify: (p: Position) => void }) {
  const pnl = p.unrealizedPnl ?? 0;
  return (
    <button
      type="button"
      onClick={() => onModify(p)}
      className="w-full border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold">{p.symbolName}</span>
        <span className={`text-[10px] font-bold ${p.side === "LONG" ? "hm-pos" : "hm-neg"}`}>
          {p.side} {p.quantity}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between tabular-nums">
        <span className="text-[10px] text-muted-foreground">@ {p.entryPrice}</span>
        <span className={`text-xs font-bold ${pnl >= 0 ? "hm-pos" : "hm-neg"}`}>
          {fmtSigned(pnl)}
        </span>
      </div>
    </button>
  );
}

function PositionsRail({ t }: { t: TerminalTradingApi }) {
  return (
    <aside className="hm-panel hm-reveal w-[240px] shrink-0">
      <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
        <span className="hm-label">Open Positions</span>
        <span className="text-[10px] font-bold tabular-nums">{t.positions.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {t.positions.length === 0 ? (
          <p className="px-3 py-5 text-[11px] text-muted-foreground">Flat — no exposure.</p>
        ) : (
          t.positions.map((p) => (
            <PositionCard key={p.id} p={p} onModify={t.setModifyingPosition} />
          ))
        )}
      </div>
      <div className="border-t border-border px-3 py-2 text-right">
        <span className="hm-label">Total </span>
        <span
          className={`text-xs font-bold tabular-nums ${t.positionPnl >= 0 ? "hm-pos" : "hm-neg"}`}
        >
          {fmtSigned(t.positionPnl)}
        </span>
      </div>
    </aside>
  );
}

/* ── Trade console (full-width market-order bar) ────────────── */

const QTY_PRESETS = [0.01, 0.1, 0.5, 1];

function useConsoleOrder(t: TerminalTradingApi, side: "BUY" | "SELL", qty: number) {
  return () => {
    if (!t.activeAccountId) {
      toast.warning("No Account", "Select an account before placing orders");
      return;
    }
    const input: PlaceOrderInput = {
      accountId: t.activeAccountId,
      symbol: t.selectedSymbol,
      side,
      type: "MARKET",
      quantity: qty,
    };
    t.setConfirmOrder({
      symbol: t.selectedSymbol,
      side,
      type: "MARKET",
      quantity: qty,
      _submit: () => api.placeOrder(input),
    });
  };
}

function TradeConsole({ t }: { t: TerminalTradingApi }) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [qty, setQty] = useState(0.1);
  const digits = Math.max(2, t.pipDigits);
  const execute = useConsoleOrder(t, side, qty);
  const stepQty = (dir: 1 | -1) =>
    setQty((q) => Math.max(0.01, Math.round((q + dir * 0.01) * 100) / 100));

  return (
    <div className="hm-console hm-reveal shrink-0">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="hm-side"
          data-side="buy"
          data-active={side === "BUY"}
          onClick={() => setSide("BUY")}
        >
          Buy
        </button>
        <button
          type="button"
          className="hm-side"
          data-side="sell"
          data-active={side === "SELL"}
          onClick={() => setSide("SELL")}
        >
          Sell
        </button>
      </div>

      <div className="flex flex-col justify-center gap-1">
        <span className="hm-label">Size (lots)</span>
        <div className="flex items-center gap-1">
          <button type="button" className="hm-step" onClick={() => stepQty(-1)}>
            −
          </button>
          <span className="w-14 text-center text-sm font-bold tabular-nums">{qty.toFixed(2)}</span>
          <button type="button" className="hm-step" onClick={() => stepQty(1)}>
            +
          </button>
          {QTY_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className="hm-preset"
              data-active={qty === p}
              onClick={() => setQty(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-5">
        <div className="text-right">
          <div className="hm-label">Bid / Ask</div>
          <div className="text-sm font-bold tabular-nums">
            <span className="hm-neg">{t.tick ? t.tick.bid.toFixed(digits) : "—"}</span>
            <span className="text-muted-foreground"> / </span>
            <span className="hm-pos">{t.tick ? t.tick.ask.toFixed(digits) : "—"}</span>
          </div>
        </div>
        <button type="button" className="hm-execute" onClick={execute}>
          Execute {side}
        </button>
      </div>
    </div>
  );
}

/**
 * Helm trading desk — carbon cockpit.
 * Marquee ticker · chart · positions rail · blotter · full-width
 * market-order console with side selector and lot stepper.
 */
export function HelmTradingPage() {
  useDarkThemeScope("helm");
  const t = useTerminalTrading("hmBottomPanelHeight");

  return (
    <div className="hm-page">
      <MarqueeTicker t={t} />

      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <div className="hm-panel hm-reveal min-w-0 flex-1">
          <ThemeChartToolbar t={t} />
          <MarketClosedBanner symbolInfo={t.symbolInfo} />
          <div className="relative min-h-[160px] flex-1">
            <ChartArea t={t} isDark={true} />
          </div>
        </div>
        <PositionsRail t={t} />
      </div>

      <ThemeSplitter
        t={t}
        handleClass="h-1 w-12 rounded-full bg-border transition-colors group-hover:bg-accent/60"
      />
      <div className="hm-panel mx-2 mb-2 shrink-0">
        <ThemeBottomPanel t={t} />
      </div>

      <TradeConsole t={t} />
      <TradingDialogsHost t={t} />
    </div>
  );
}

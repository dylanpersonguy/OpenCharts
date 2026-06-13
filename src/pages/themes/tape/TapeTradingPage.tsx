import { DOMPanel } from "../../trading/DOMPanel.tsx";
import { MarketClosedBanner } from "../../trading/MarketClosedBanner.tsx";
import { OrderPanel } from "../../trading/OrderPanel.tsx";
import {
  type BottomTabId,
  ChartArea,
  type TerminalTradingApi,
  TradingDialogsHost,
  useTerminalTrading,
} from "../../trading/useTerminalTrading.tsx";
import { getPipDigits } from "../../trading/utils.ts";
import { ThemeBottomPanel, ThemeChartToolbar, ThemeSplitter } from "../theme-chrome.tsx";
import { fmtSigned, useDarkThemeScope } from "../theme-kit.tsx";
import "./tape.css";

/* ── Quote board: dense all-symbols strip ───────────────────── */

function QuoteBoard({ t }: { t: TerminalTradingApi }) {
  return (
    <div className="tp-reveal flex overflow-x-auto border-b border-border bg-card shrink-0">
      {t.symbols.map((s) => {
        const tick = t.ticks[s.name];
        const digits = getPipDigits(s, s.name);
        return (
          <button
            key={s.name}
            type="button"
            className="tp-quote shrink-0"
            data-active={s.name === t.selectedSymbol}
            onClick={() => t.setSelectedSymbol(s.name)}
          >
            <div className="font-bold">{s.name}</div>
            <div className="flex gap-2 tabular-nums">
              <span className="tp-bid">{tick ? tick.bid.toFixed(digits) : "—"}</span>
              <span className="tp-ask">{tick ? tick.ask.toFixed(digits) : "—"}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ── Titled tiles ───────────────────────────────────────────── */

function TileTitle({ code, label, right }: { code: string; label: string; right?: string }) {
  return (
    <div className="tp-titlebar">
      <span>
        {code} · {label}
      </span>
      {right && <span>{right}</span>}
    </div>
  );
}

function StatusReadout({ t }: { t: TerminalTradingApi }) {
  return (
    <span>
      EQ {(t.account?.equity ?? 0).toFixed(2)} · P&L {fmtSigned(t.positionPnl)} ·{" "}
      {t.isFeedConnected ? "LIVE" : "OFFLINE"}
      <span className="tp-cursor">▊</span>
    </span>
  );
}

/* ── Function-key bar driving the blotter tabs ──────────────── */

const F_KEYS: { code: string; label: string; tab: BottomTabId }[] = [
  { code: "F1", label: "Positions", tab: "positions" },
  { code: "F2", label: "Orders", tab: "orders" },
  { code: "F3", label: "History", tab: "history" },
  { code: "F4", label: "Journal", tab: "journal" },
  { code: "F5", label: "Calendar", tab: "calendar" },
  { code: "F6", label: "News", tab: "news" },
];

function FKeyBar({ t }: { t: TerminalTradingApi }) {
  return (
    <div className="flex shrink-0 border-t border-border bg-card">
      {F_KEYS.map((k) => (
        <button
          key={k.code}
          type="button"
          className="tp-fkey"
          data-active={t.bottomTab === k.tab}
          onClick={() => t.setBottomTab(k.tab)}
        >
          <span className="tp-fkey-code">{k.code}</span>
          {k.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Tape trading desk — phosphor terminal mosaic.
 * Quote board · titled chart tile · depth + ticket stacked · F-key blotter.
 */
export function TapeTradingPage() {
  useDarkThemeScope("tape");
  const t = useTerminalTrading("tpBottomPanelHeight");

  return (
    <div className="tp-page">
      <QuoteBoard t={t} />

      <div className="flex min-h-0 flex-1 gap-px p-px">
        <div className="tp-tile tp-reveal min-w-0 flex-1">
          <TileTitle code="GP" label={`Price Graph — ${t.selectedSymbol}`} />
          <ThemeChartToolbar t={t} />
          <MarketClosedBanner symbolInfo={t.symbolInfo} />
          <div className="relative min-h-[160px] flex-1">
            <ChartArea t={t} isDark={true} />
          </div>
        </div>

        <div className="flex w-[300px] shrink-0 flex-col gap-px xl:w-[336px]">
          <div className="tp-tile flex-1 min-h-0">
            <TileTitle code="MD" label="Market Depth" />
            <DOMPanel symbol={t.selectedSymbol} tick={t.tick} />
          </div>
          <div className="tp-tile flex-[1.4] min-h-0">
            <TileTitle code="OT" label="Order Ticket" />
            <OrderPanel
              symbol={t.selectedSymbol}
              symbolInfo={t.symbolInfo}
              tick={t.tick}
              accountId={t.activeAccountId}
              oneClick={t.oneClick}
              onToggleOneClick={t.toggleOneClick}
              onConfirmOrder={t.setConfirmOrder}
              accountBalance={t.account?.balance}
              isFeedConnected={t.isFeedConnected}
              soundMuted={t.soundMuted}
              onToggleMute={t.toggleSoundMute}
              onOrderSuccess={t.playTradeSound}
            />
          </div>
        </div>
      </div>

      <ThemeSplitter
        t={t}
        handleClass="h-0.5 w-16 bg-border transition-colors group-hover:bg-accent"
      />

      <div className="tp-tile mx-px shrink-0">
        <TileTitle code="PT" label="Blotter" />
        <ThemeBottomPanel t={t} />
      </div>

      <div className="flex items-center justify-between shrink-0">
        <FKeyBar t={t} />
        <div className="px-3 text-[10px] tracking-widest uppercase text-muted-foreground">
          <StatusReadout t={t} />
        </div>
      </div>

      <TradingDialogsHost t={t} />
    </div>
  );
}

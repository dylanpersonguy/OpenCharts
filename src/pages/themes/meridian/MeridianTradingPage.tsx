import { updateChartPreferences } from "../../../hooks/useChartPreferences.ts";
import type { Symbol as SymbolInfo } from "../../../services/schemas.ts";
import { BottomPanel } from "../../trading/BottomPanel.tsx";
import { ChartToolbar } from "../../trading/ChartToolbar.tsx";
import { MarketClosedBanner } from "../../trading/MarketClosedBanner.tsx";
import { OrderPanel } from "../../trading/OrderPanel.tsx";
import {
  ChartArea,
  type TerminalTradingApi,
  TradingDialogsHost,
  useTerminalTrading,
} from "../../trading/useTerminalTrading.tsx";
import { getPipDigits } from "../../trading/utils.ts";
import { fmtSigned } from "./meridian-primitives";
import { useMeridianScope } from "./meridian-scope";
import "./meridian.css";

type Tick = { bid: number; ask: number; timestamp: number } | undefined;

/* ── Masthead: instrument statement across the top ──────────── */

function Masthead({ t }: { t: TerminalTradingApi }) {
  const digits = Math.max(2, t.pipDigits);
  const spread = t.tick ? (t.tick.ask - t.tick.bid).toFixed(digits) : "—";
  return (
    <header className="border-b-2 border-foreground bg-card px-4 py-2">
      <div className="flex items-end justify-between gap-6">
        <div className="flex items-end gap-6">
          <div>
            <div className="mr-microlabel">Instrument</div>
            <div className="mr-display text-2xl">{t.selectedSymbol}</div>
          </div>
          <div>
            <div className="mr-microlabel">Bid</div>
            <div className="mr-display mr-num mr-neg text-2xl">
              {t.tick ? t.tick.bid.toFixed(digits) : "—"}
            </div>
          </div>
          <div>
            <div className="mr-microlabel">Ask</div>
            <div className="mr-display mr-num mr-pos text-2xl">
              {t.tick ? t.tick.ask.toFixed(digits) : "—"}
            </div>
          </div>
          <div className="hidden md:block">
            <div className="mr-microlabel">Spread</div>
            <div className="mr-num text-sm font-semibold pt-1">{spread}</div>
          </div>
        </div>
        <MastheadAccount t={t} />
      </div>
    </header>
  );
}

function MastheadAccount({ t }: { t: TerminalTradingApi }) {
  return (
    <div className="flex items-end gap-6">
      <div className="text-right">
        <div className="mr-microlabel">Floating P&L</div>
        <div
          className={`mr-num text-sm font-semibold pt-1 ${t.positionPnl >= 0 ? "mr-pos" : "mr-neg"}`}
        >
          {fmtSigned(t.positionPnl)}
        </div>
      </div>
      <div className="text-right">
        <div className="mr-microlabel">Equity</div>
        <div className="mr-num text-sm font-semibold pt-1">
          {fmtSigned(t.account?.equity ?? 0).replace(/^[+−]/, "")}
        </div>
      </div>
      <div
        className={`mr-microlabel pb-0.5 ${t.isFeedConnected ? "!text-[hsl(var(--buy))]" : "!text-[hsl(var(--sell))]"}`}
      >
        {t.isFeedConnected ? "● LIVE" : "○ OFFLINE"}
      </div>
    </div>
  );
}

/* ── Index rail: Swiss watchlist ────────────────────────────── */

function IndexRow({
  sym,
  tick,
  active,
  onSelect,
}: {
  sym: SymbolInfo;
  tick: Tick;
  active: boolean;
  onSelect: (name: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(sym.name)}
      className={`flex w-full items-baseline justify-between px-3 py-2 text-left transition-colors hover:bg-muted/60 ${active ? "mr-active-bar bg-muted/40" : ""}`}
    >
      <span className="text-xs font-semibold">{sym.name}</span>
      <span className="mr-num text-[11px] text-muted-foreground">
        {tick ? tick.bid.toFixed(getPipDigits(sym, sym.name)) : "—"}
      </span>
    </button>
  );
}

function IndexRail({ t }: { t: TerminalTradingApi }) {
  return (
    <aside className="mr-panel flex w-[224px] shrink-0 flex-col overflow-hidden">
      <div className="border-b-2 border-foreground px-3 py-2">
        <span className="mr-index mr-2">01</span>
        <span className="mr-microlabel !text-foreground">Index</span>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {t.symbols.map((s) => (
          <IndexRow
            key={s.name}
            sym={s}
            tick={t.ticks[s.name]}
            active={s.name === t.selectedSymbol}
            onSelect={t.setSelectedSymbol}
          />
        ))}
      </div>
    </aside>
  );
}

/* ── Chart column ───────────────────────────────────────────── */

function ChartColumn({ t }: { t: TerminalTradingApi }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="mr-panel flex min-h-[200px] flex-1 flex-col overflow-hidden">
        <ChartToolbar
          selectedSymbol={t.selectedSymbol}
          symbols={t.symbols}
          onSymbolChange={t.setSelectedSymbol}
          timeframe={t.timeframe}
          onTimeframeChange={t.handleTimeframeChange}
          activeIndicators={t.activeIndicators}
          onToggleIndicator={(type) =>
            t.setActiveIndicators((prev) =>
              prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type],
            )
          }
          showIndicatorMenu={t.showIndicatorMenu}
          onToggleIndicatorMenu={() => t.setShowIndicatorMenu((v) => !v)}
          drawingTool={t.drawingTool}
          onDrawingTool={t.setDrawingTool}
          drawings={t.drawingsApi.drawings}
          onClearDrawings={t.drawingsApi.clearDrawings}
          rightPanel="order"
          onRightPanel={() => {}}
          showRightPanel={false}
          onToggleRightPanel={() => {}}
          tick={t.tick}
          symbolInfo={t.symbolInfo}
          aiTraderEnabled={false}
          isReplaying={false}
          activePlugins={t.activePlugins}
          onTogglePlugin={t.handleTogglePlugin}
          onSetIndicators={t.setActiveIndicators}
          onSetPlugins={t.handleSetPlugins}
          magnetMode={t.chartPrefs.magnetMode}
          onCycleMagnet={t.cycleMagnetMode}
          stayInDrawingMode={t.chartPrefs.stayInDrawingMode}
          onToggleStayInDrawingMode={() =>
            updateChartPreferences({ stayInDrawingMode: !t.chartPrefs.stayInDrawingMode })
          }
        />
        <MarketClosedBanner symbolInfo={t.symbolInfo} />
        <div className="relative min-h-[160px] flex-1">
          <ChartArea t={t} isDark={false} />
        </div>
      </div>

      {/* ARIA window-splitter: focusable separator with a current value. */}
      {/* biome-ignore lint/a11y/useSemanticElements: <hr> cannot act as a draggable splitter */}
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label="Resize bottom panel"
        aria-valuenow={t.bottomPanelHeight}
        aria-valuemin={120}
        aria-valuemax={600}
        onMouseDown={t.onResizeStart}
        className="group flex h-1.5 shrink-0 cursor-row-resize items-center justify-center"
      >
        <div className="h-[2px] w-12 bg-border transition-colors group-hover:bg-accent" />
      </div>

      <div className="mr-panel shrink-0 overflow-hidden">
        <BottomPanel
          tab={t.bottomTab}
          onTabChange={t.setBottomTab}
          positions={t.positions}
          orders={t.orders}
          accountId={t.activeAccountId}
          onModifyPosition={t.setModifyingPosition}
          onModifyOrder={t.setModifyingOrder}
          onSelectPositionSymbol={t.setSelectedSymbol}
          onSelectOrderSymbol={t.setSelectedSymbol}
          aiTraderEnabled={t.aiTraderEnabled?.enabled ?? false}
          height={t.bottomPanelHeight}
          isFeedConnected={t.isFeedConnected}
          journalEntries={t.journal.entries}
          journalLoading={t.journal.loading}
          onCreateJournal={t.journal.create}
          onUpdateJournal={t.journal.update}
          onDeleteJournal={t.journal.remove}
        />
      </div>
    </div>
  );
}

/* ── Ticket rail ────────────────────────────────────────────── */

function TicketRail({ t }: { t: TerminalTradingApi }) {
  return (
    <aside className="mr-panel flex w-[300px] shrink-0 flex-col overflow-hidden xl:w-[336px]">
      <div className="border-b-2 border-foreground px-3 py-2">
        <span className="mr-index mr-2">02</span>
        <span className="mr-microlabel !text-foreground">Ticket</span>
      </div>
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
    </aside>
  );
}

/**
 * Meridian trading desk — Swiss Modernism 2.0.
 * Index rail · chart sheet · order ticket, separated by hairline rules.
 */
export function MeridianTradingPage() {
  useMeridianScope();
  const t = useTerminalTrading("mrBottomPanelHeight");

  return (
    <div className="mr-trading-page">
      <Masthead t={t} />
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <IndexRail t={t} />
        <ChartColumn t={t} />
        <TicketRail t={t} />
      </div>
      <TradingDialogsHost t={t} />
    </div>
  );
}

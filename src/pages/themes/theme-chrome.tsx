import { NewsFeed as MarketNewsFeed } from "../../components/TradingPowerFeatures.tsx";
import { TradingViewTechnicalAnalysis } from "../../components/TradingViewWidgets.tsx";
import { updateChartPreferences } from "../../hooks/useChartPreferences.ts";
import { AiTraderPanel } from "../AiTraderPage.tsx";
import { BottomPanel } from "../trading/BottomPanel.tsx";
import { ChartToolbar } from "../trading/ChartToolbar.tsx";
import { DOMPanel } from "../trading/DOMPanel.tsx";
import { MarketClosedBanner } from "../trading/MarketClosedBanner.tsx";
import { OrderPanel } from "../trading/OrderPanel.tsx";
import { ChartArea, type TerminalTradingApi } from "../trading/useTerminalTrading.tsx";
import { WatchlistPanel } from "../trading/WatchlistPanel.tsx";

/* ══════════════════════════════════════════════════════════════
   Shared functional chrome for terminal themes.
   Themes wrap these in their own panel classes — chrome stays
   identical across themes, only the skin differs.
   ══════════════════════════════════════════════════════════════ */

export function ThemeChartToolbar({ t }: { t: TerminalTradingApi }) {
  return (
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
      rightPanel={t.rightPanel}
      onRightPanel={t.setRightPanel}
      showRightPanel={t.showRightPanel}
      onToggleRightPanel={() => t.setShowRightPanel((v) => !v)}
      tick={t.tick}
      symbolInfo={t.symbolInfo}
      aiTraderEnabled={t.aiTraderEnabled?.enabled ?? false}
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
  );
}

export function ThemeBottomPanel({ t }: { t: TerminalTradingApi }) {
  return (
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
  );
}

export function ThemeSplitter({ t, handleClass }: { t: TerminalTradingApi; handleClass: string }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> cannot act as a draggable splitter
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
      <div className={handleClass} />
    </div>
  );
}

/**
 * Chart column: toolbar + chart + splitter + bottom dock.
 * `frameClass`/`bottomClass` carry the theme's panel skin.
 */
export function ThemeChartColumn({
  t,
  frameClass,
  bottomClass,
  handleClass,
}: {
  t: TerminalTradingApi;
  frameClass: string;
  bottomClass: string;
  handleClass: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className={`${frameClass} flex min-h-[200px] flex-1 flex-col overflow-hidden`}>
        <ThemeChartToolbar t={t} />
        <MarketClosedBanner symbolInfo={t.symbolInfo} />
        <div className="relative min-h-[160px] flex-1">
          <ChartArea t={t} isDark={true} />
        </div>
      </div>
      <ThemeSplitter t={t} handleClass={handleClass} />
      <div className={`${bottomClass} shrink-0 overflow-hidden`}>
        <ThemeBottomPanel t={t} />
      </div>
    </div>
  );
}

/** Right dock switch honoring the toolbar's panel selector. */
export function ThemeRightDock({ t }: { t: TerminalTradingApi }) {
  switch (t.rightPanel) {
    case "order":
      return (
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
      );
    case "dom":
      return <DOMPanel symbol={t.selectedSymbol} tick={t.tick} />;
    case "watchlist":
      return (
        <WatchlistPanel
          symbols={t.symbols}
          ticks={t.ticks}
          selectedSymbol={t.selectedSymbol}
          onSelect={t.setSelectedSymbol}
          oneClick={t.oneClick}
          accountId={t.activeAccountId}
          isFeedConnected={t.isFeedConnected}
        />
      );
    case "news":
      return (
        <div className="flex-1 space-y-2 overflow-y-auto p-2">
          <MarketNewsFeed symbol={t.selectedSymbol} />
        </div>
      );
    case "ai-trader":
      return (
        <div className="flex-1 overflow-hidden">
          <AiTraderPanel accountId={t.activeAccountId} />
        </div>
      );
    case "tv-analysis":
      return (
        <div className="flex-1 overflow-hidden">
          <TradingViewTechnicalAnalysis
            symbol={t.selectedSymbol}
            theme="dark"
            interval={t.timeframe}
            width="100%"
            height="100%"
          />
        </div>
      );
    default:
      return null;
  }
}

import { NewsFeed as MarketNewsFeed } from "../../components/TradingPowerFeatures.tsx";
import { TradingViewTechnicalAnalysis } from "../../components/TradingViewWidgets.tsx";
import { updateChartPreferences } from "../../hooks/useChartPreferences.ts";
import { AiTraderPanel } from "../AiTraderPage.tsx";
import { BottomPanel } from "../trading/BottomPanel.tsx";
import { ChartToolbar } from "../trading/ChartToolbar.tsx";
import { DOMPanel } from "../trading/DOMPanel.tsx";
import { MarketClosedBanner } from "../trading/MarketClosedBanner.tsx";
import { OrderPanel } from "../trading/OrderPanel.tsx";
import {
  ChartArea,
  type TerminalTradingApi,
  TradingDialogsHost,
  useTerminalTrading,
} from "../trading/useTerminalTrading.tsx";
import { WatchlistPanel } from "../trading/WatchlistPanel.tsx";
import { CommandBar } from "./CommandBar.tsx";
import "./tradingv2.css";

export function TradingV2Page() {
  const t = useTerminalTrading("tv2BottomPanelHeight");
  const isDark = !document.documentElement.classList.contains("light");

  return (
    <div className="tv2-scope flex flex-col h-full overflow-hidden gap-2 p-2">
      <CommandBar
        account={t.account ?? null}
        positionPnl={t.positionPnl}
        openPositions={t.positions.length}
        isFeedConnected={t.isFeedConnected}
        oneClick={t.oneClick}
        onToggleOneClick={t.toggleOneClick}
        soundMuted={t.soundMuted}
        onToggleMute={t.toggleSoundMute}
      />

      <div className="flex flex-1 gap-2 overflow-hidden">
        {/* ── Chart + bottom island column ── */}
        <div className="flex flex-col flex-1 min-w-0 gap-2">
          <div className="tv2-island flex flex-col flex-1 min-h-[200px]">
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
            <MarketClosedBanner symbolInfo={t.symbolInfo} />
            <div className="flex-1 min-h-[160px] relative">
              <ChartArea t={t} isDark={isDark} />
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
            className="h-1.5 cursor-row-resize flex items-center justify-center group shrink-0"
          >
            <div className="w-10 h-1 rounded-full bg-border group-hover:bg-[#009AEE]/60 transition-colors" />
          </div>

          <div className="tv2-island shrink-0">
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

        {/* ── Right dock island ── */}
        {t.showRightPanel && (
          <div className="tv2-island w-[300px] xl:w-[336px] flex flex-col overflow-hidden shrink-0">
            <RightDock t={t} isDark={isDark} />
          </div>
        )}
      </div>

      <TradingDialogsHost t={t} />
    </div>
  );
}

function RightDock({ t, isDark }: { t: TerminalTradingApi; isDark: boolean }) {
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
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
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
            theme={isDark ? "dark" : "light"}
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

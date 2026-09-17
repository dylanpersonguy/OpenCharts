import { ChartPanel } from "../pages/trading/ChartPanel.tsx";
import { DOMPanel } from "../pages/trading/DOMPanel.tsx";
import { OrderPanel } from "../pages/trading/OrderPanel.tsx";
import { OrdersTable } from "../pages/trading/OrdersTable.tsx";
import { PositionsTable } from "../pages/trading/PositionsTable.tsx";
import { WatchlistPanel } from "../pages/trading/WatchlistPanel.tsx";
import { useTerminal } from "./use-terminal.ts";

/**
 * Panels that can be mounted on their own.
 *
 * Each one reads what it needs from `<TerminalProvider>`, so an application can
 * compose the pieces it wants — a chart alone, a chart with its own order form,
 * or the full `<Terminal />` layout — without passing forty props around or
 * forking the project.
 */

/** The chart: candles, indicators, drawings, position overlays, replay. */
export function Chart() {
  const t = useTerminal();
  return (
    <ChartPanel
      candles={t.replayCandles ?? t.candles ?? []}
      selectedSymbol={t.selectedSymbol}
      timeframe={t.replayCandles ? "1m" : t.timeframe}
      isDark={t.isDark}
      activeIndicators={t.activeIndicators}
      drawingTool={t.drawingTool}
      drawings={t.drawings}
      onAddDrawing={t.addDrawing}
      onUpdateDrawing={t.updateDrawing}
      onRemoveDrawing={t.removeDrawing}
      onDrawingComplete={() => t.setDrawingTool("none")}
      onDrawingToolSelect={t.setDrawingTool}
      onUndoDrawing={t.undoDrawing}
      onRedoDrawing={t.redoDrawing}
      magnetMode={t.chartPrefs.magnetMode}
      stayInDrawingMode={t.chartPrefs.stayInDrawingMode}
      positions={t.chartPositions}
      orders={t.chartOrders}
      tick={t.replayCandles ? undefined : t.tick}
      liveCandle={t.replayCandles ? undefined : t.liveCandle}
      pipDigits={t.pipDigits}
      symbolInfo={t.symbolInfo}
      onModifyPosition={t.modifyPositionLevels}
      replayTradeEvents={t.replayTradeEvents}
      isReplaying={t.isReplaying}
      activePlugins={t.activePlugins}
      onTogglePlugin={t.togglePlugin}
      accountEquity={t.account?.equity ?? t.account?.balance ?? 0}
      accountId={t.activeAccountId}
      onQuickOrder={t.quickOrder}
      onClearDrawings={t.clearDrawings}
      onClearIndicators={t.clearIndicators}
    />
  );
}

/** Market / limit / stop order entry for the charted symbol. */
export function OrderTicket() {
  const t = useTerminal();
  return (
    <OrderPanel
      symbol={t.selectedSymbol}
      symbolInfo={t.symbolInfo}
      tick={t.tick}
      accountId={t.activeAccountId}
      oneClick={t.oneClick}
      onToggleOneClick={t.toggleOneClick}
      onConfirmOrder={t.requestOrderConfirmation}
      accountBalance={t.account?.balance}
      isFeedConnected={t.isFeedConnected}
      soundMuted={t.soundMuted}
      onToggleMute={t.toggleSoundMute}
      onOrderSuccess={t.onOrderSuccess}
    />
  );
}

/** Depth ladder around the live mid price. */
export function DepthLadder() {
  const t = useTerminal();
  return <DOMPanel symbol={t.selectedSymbol} tick={t.tick} />;
}

/** Instrument list with live prices. */
export function Watchlist() {
  const t = useTerminal();
  return (
    <WatchlistPanel
      symbols={t.symbols}
      ticks={t.ticks}
      selectedSymbol={t.selectedSymbol}
      onSelect={t.setSelectedSymbol}
      accountId={t.activeAccountId}
      oneClick={t.oneClick}
      isFeedConnected={t.isFeedConnected}
    />
  );
}

/** Open positions, with close / partial close / modify wired up. */
export function Positions() {
  const t = useTerminal();
  return (
    <PositionsTable
      positions={t.positions}
      onClose={(id) => t.closePosition(id)}
      onPartialClose={(id, quantity) => t.closePosition(id, quantity)}
      onModify={(row) =>
        t.editPosition(t.positions.find((p) => p.id === row.id) ?? null)
      }
      onSelectSymbol={t.setSelectedSymbol}
    />
  );
}

/** Working orders, with cancel and modify wired up. */
export function Orders() {
  const t = useTerminal();
  return (
    <OrdersTable
      orders={t.orders.filter((o) => o.status === "PENDING" || o.status === "NEW")}
      onCancel={(id) => t.cancelOrder(id)}
      onModify={(row) => t.editOrder(t.orders.find((o) => o.id === row.id) ?? null)}
      onSelectSymbol={t.setSelectedSymbol}
    />
  );
}

'use client';

import React, { useCallback, useEffect } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import TopToolbar from '@/components/toolbar/TopToolbar';
import DrawingToolbar from '@/components/toolbar/DrawingToolbar';
import WatchlistPanel from '@/components/sidebar/WatchlistPanel';
import TranspilerPanel from '@/components/sidebar/TranspilerPanel';
import CalendarPanel from '@/components/sidebar/CalendarPanel';
import RightIconBar from '@/components/sidebar/RightIconBar';
import BottomBar from '@/components/toolbar/BottomBar';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useChartStore } from '@/store/chartStore';

const ChartWidget = dynamic(() => import('@/components/chart/ChartWidget'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-tv-bg">
      <div className="flex flex-col items-center gap-2">
        <div className="w-6 h-6 border-2 border-tv-blue border-t-transparent rounded-full animate-spin" />
        <span className="text-tv-text-muted text-xs">Loading chart...</span>
      </div>
    </div>
  ),
});

export default function HomePage() {
  const {
    symbol, resolution, chartType, indicators, activeTool, showWatchlist, showTranspiler, showCalendar, lastPrice,
    setSymbol, setResolution, setChartType, addIndicator, removeIndicator,
    setActiveTool, toggleWatchlist, toggleTranspiler, toggleCalendar, setLastPrice, setConnected,
  } = useChartStore();

  const { connected } = useWebSocket();
  const isMobile = useIsMobile();

  // Close panels when switching to mobile
  useEffect(() => {
    if (isMobile) {
      useChartStore.getState().setShowWatchlist(false);
      useChartStore.getState().setShowTranspiler(false);
      useChartStore.getState().setShowCalendar(false);
    }
  }, [isMobile]);

  // Sync WebSocket connection status to store
  useEffect(() => {
    setConnected(connected);
  }, [connected, setConnected]);

  const handlePriceUpdate = useCallback((price: number, change: number, changePct: number) => {
    setLastPrice(price, change, changePct);
  }, [setLastPrice]);

  return (
    <>
      <Head>
        <title>{symbol} — OpenCharts</title>
        <meta name="description" content="Open-source charting and market analysis platform" />
      </Head>

      <div className="flex flex-col h-full bg-tv-bg select-none">
        {/* Top toolbar */}
        <TopToolbar
          symbol={symbol}
          resolution={resolution}
          chartType={chartType}
          indicators={indicators}
          connected={connected}
          lastPrice={lastPrice}
          onSymbolChange={setSymbol}
          onResolutionChange={setResolution}
          onChartTypeChange={setChartType}
          onAddIndicator={addIndicator}
          onRemoveIndicator={removeIndicator}
        />

        {/* Main content area */}
        <div className="flex flex-1 min-h-0">
          {/* Left drawing toolbar — hidden on mobile */}
          {!isMobile && (
            <DrawingToolbar
              activeTool={activeTool}
              onSelectTool={setActiveTool}
              onClearAll={() => setActiveTool(null)}
            />
          )}

          {/* Chart area */}
          <div className="flex-1 min-w-0 relative">
            <ChartWidget
              symbol={symbol}
              resolution={resolution}
              chartType={chartType}
              indicators={indicators}
              onPriceUpdate={handlePriceUpdate}
            />
          </div>

          {/* Mobile: overlay backdrop */}
          {isMobile && (showWatchlist || showTranspiler || showCalendar) && (
            <div
              className="sidebar-overlay"
              onClick={() => {
                useChartStore.getState().setShowWatchlist(false);
                useChartStore.getState().setShowTranspiler(false);
                useChartStore.getState().setShowCalendar(false);
              }}
            />
          )}

          {/* Right watchlist panel */}
          {showWatchlist && (
            <div className={isMobile ? 'sidebar-panel' : ''}>
              <WatchlistPanel
                onSelectSymbol={setSymbol}
                currentSymbol={symbol}
              />
            </div>
          )}

          {/* Right transpiler panel */}
          {showTranspiler && (
            <div className={isMobile ? 'sidebar-panel' : ''}>
              <TranspilerPanel />
            </div>
          )}

          {/* Right calendar panel */}
          {showCalendar && (
            <div className={isMobile ? 'sidebar-panel' : ''}>
              <CalendarPanel />
            </div>
          )}

          {/* Right icon sidebar */}
          <RightIconBar
            showWatchlist={showWatchlist}
            showTranspiler={showTranspiler}
            showCalendar={showCalendar}
            onToggleWatchlist={toggleWatchlist}
            onToggleTranspiler={toggleTranspiler}
            onToggleCalendar={toggleCalendar}
          />
        </div>

        {/* Bottom bar */}
        <BottomBar symbol={symbol} resolution={resolution} connected={connected} />
      </div>
    </>
  );
}

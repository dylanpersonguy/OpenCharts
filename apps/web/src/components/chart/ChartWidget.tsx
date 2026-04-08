'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { OHLCV, Resolution, ChartType } from '@opencharts/common';
import { ChartEngine } from '@/lib/chart';
import type { ChartBar } from '@/lib/chart';
import { api } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';

interface ChartWidgetProps {
  symbol: string;
  resolution: Resolution;
  chartType: ChartType;
  indicators?: { type: string; params?: Record<string, number> }[];
  onPriceUpdate?: (price: number, change: number, changePct: number) => void;
}

function toChartBars(bars: OHLCV[]): ChartBar[] {
  return bars.map((b) => ({
    time: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

export default function ChartWidget({
  symbol,
  resolution,
  chartType,
  indicators = [],
  onPriceUpdate,
}: ChartWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ChartEngine | null>(null);
  const barsRef = useRef<OHLCV[]>([]);
  const [loading, setLoading] = useState(true);
  const { subscribe, connected } = useWebSocket();

  // Initialize engine
  useEffect(() => {
    if (!canvasRef.current) return;

    const engine = new ChartEngine(canvasRef.current);
    engineRef.current = engine;

    const observer = new ResizeObserver(() => engine.resize());
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Sync chart type
  useEffect(() => {
    engineRef.current?.setChartType(chartType);
  }, [chartType]);

  // Load data when symbol/resolution changes
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      try {
        const data = await api.getBars(symbol, resolution, 500);
        if (cancelled) return;

        barsRef.current = data.bars;
        engineRef.current?.setChartType(chartType);
        engineRef.current?.setData(toChartBars(data.bars));

        // Load indicators if requested
        if (indicators.length > 0) {
          await loadIndicators(data.bars);
        } else {
          engineRef.current?.setIndicators([]);
        }
      } catch (err) {
        console.error('Failed to load bars:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => { cancelled = true; };
  }, [symbol, resolution, chartType]);

  async function loadIndicators(bars: OHLCV[]) {
    if (!engineRef.current || indicators.length === 0) return;

    try {
      const result = await api.getIndicators(symbol, resolution, indicators);
      const colors = ['#ff9800', '#e040fb', '#00bcd4', '#ffeb3b', '#4caf50', '#f44336'];

      const lines = result.indicators.flatMap((ind, idx) => {
        return Object.entries(ind.series).map(([name, values], subIdx) => ({
          color: colors[(idx * Object.keys(ind.series).length + subIdx) % colors.length],
          values: values as (number | null)[],
          label: `${ind.type} ${name}`,
        }));
      });

      engineRef.current.setIndicators(lines);
    } catch (err) {
      console.error('Failed to load indicators:', err);
    }
  }

  // Subscribe to realtime updates
  useEffect(() => {
    if (!connected) return;

    const unsubscribe = subscribe(symbol, resolution, (bar, _isClosed) => {
      if (!engineRef.current) return;
      engineRef.current.updateBar({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      });
    });

    return unsubscribe;
  }, [symbol, resolution, connected, subscribe]);

  // Emit price updates when bars load
  useEffect(() => {
    if (barsRef.current.length >= 2 && onPriceUpdate) {
      const last = barsRef.current[barsRef.current.length - 1];
      const prev = barsRef.current[barsRef.current.length - 2];
      const change = last.close - prev.close;
      const changePct = (change / prev.close) * 100;
      onPriceUpdate(last.close, change, changePct);
    }
  }, [loading, onPriceUpdate]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-tv-bg/80">
          <div className="flex flex-col items-center gap-2">
            <div className="w-5 h-5 border-2 border-tv-blue border-t-transparent rounded-full animate-spin" />
            <span className="text-tv-text-muted text-xs">Loading...</span>
          </div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ cursor: 'crosshair' }}
      />
    </div>
  );
}

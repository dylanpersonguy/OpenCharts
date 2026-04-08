'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  CandlestickChart,
  LineChart,
  AreaChart,
  Activity,
  Bell,
  Plus,
  X,
  Wifi,
  WifiOff,
  Save,
  Camera,
  Settings,
  MoreHorizontal,
} from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { Resolution, ChartType, IndicatorType } from '@opencharts/common';
import { INDICATOR_REGISTRY } from '@opencharts/common';
import { api } from '@/lib/api';
import ShareButton from '@/components/ShareButton';
import ThemeSelector from '@/components/ThemeSelector';

interface TopToolbarProps {
  symbol: string;
  resolution: Resolution;
  chartType: ChartType;
  indicators: { type: IndicatorType; params?: Record<string, number> }[];
  connected: boolean;
  lastPrice: { price: number; change: number; changePct: number } | null;
  onSymbolChange: (s: string) => void;
  onResolutionChange: (r: Resolution) => void;
  onChartTypeChange: (ct: ChartType) => void;
  onAddIndicator: (type: IndicatorType, params?: Record<string, number>) => void;
  onRemoveIndicator: (index: number) => void;
}

const TIMEFRAMES: { label: string; value: Resolution }[] = [
  { label: '1s', value: '1s' },
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1H', value: '1h' },
  { label: '4H', value: '4h' },
  { label: 'D', value: '1d' },
  { label: 'W', value: '1w' },
];

const CHART_TYPES: { type: ChartType; icon: React.ReactNode; label: string }[] = [
  { type: 'candlestick', icon: <CandlestickChart size={15} />, label: 'Candles' },
  { type: 'line', icon: <LineChart size={15} />, label: 'Line' },
  { type: 'area', icon: <AreaChart size={15} />, label: 'Area' },
];

export default function TopToolbar({
  symbol,
  resolution,
  chartType,
  indicators,
  connected,
  lastPrice,
  onSymbolChange,
  onResolutionChange,
  onChartTypeChange,
  onAddIndicator,
  onRemoveIndicator,
}: TopToolbarProps) {
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [symbolQuery, setSymbolQuery] = useState('');
  const [symbolResults, setSymbolResults] = useState<{ ticker: string; name: string; exchange: string }[]>([]);
  const [indicatorOpen, setIndicatorOpen] = useState(false);
  const symbolInputRef = useRef<HTMLInputElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);

  // Close indicator dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (indicatorRef.current && !indicatorRef.current.contains(e.target as Node)) setIndicatorOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (symbolOpen) setTimeout(() => symbolInputRef.current?.focus(), 0);
  }, [symbolOpen]);

  // Symbol search
  useEffect(() => {
    if (!symbolQuery.trim()) { setSymbolResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const data = await api.searchSymbols(symbolQuery);
        setSymbolResults(data as { ticker: string; name: string; exchange: string }[]);
      } catch { setSymbolResults([]); }
    }, 200);
    return () => clearTimeout(timer);
  }, [symbolQuery]);

  const currentChartIcon = CHART_TYPES.find((c) => c.type === chartType)?.icon;

  return (
    <div className="flex items-center h-[38px] px-1 bg-tv-toolbar border-b border-tv-border text-[13px]">
      {/* Symbol Search (Radix Popover) */}
      <Popover.Root open={symbolOpen} onOpenChange={(open) => { setSymbolOpen(open); if (open) setSymbolQuery(''); }}>
        <Popover.Trigger asChild>
          <button className="tv-btn flex items-center gap-1.5 px-2 h-[28px] font-semibold text-tv-text">
            <Search size={14} className="text-tv-text-muted" />
            <span>{symbol}</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="w-80 bg-tv-panel border border-tv-border rounded shadow-2xl z-50"
            sideOffset={4}
            align="start"
          >
            <div className="p-2">
              <input
                ref={symbolInputRef}
                type="text"
                value={symbolQuery}
                onChange={(e) => setSymbolQuery(e.target.value)}
                placeholder="Search symbol..."
                className="w-full px-3 py-1.5 bg-tv-bg border border-tv-border rounded text-sm text-tv-text placeholder:text-tv-text-muted focus:border-tv-blue outline-none"
              />
            </div>
            <div className="max-h-60 overflow-y-auto">
              {symbolResults.map((r) => (
                <button
                  key={r.ticker}
                  onClick={() => { onSymbolChange(r.ticker); setSymbolOpen(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-tv-hover text-sm text-tv-text"
                >
                  <div>
                    <span className="font-medium">{r.ticker}</span>
                    <span className="text-tv-text-muted ml-2 text-xs">{r.name}</span>
                  </div>
                  <span className="text-[11px] text-tv-text-muted">{r.exchange}</span>
                </button>
              ))}
              {symbolQuery && symbolResults.length === 0 && (
                <div className="px-3 py-3 text-sm text-tv-text-muted text-center">No results</div>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <div className="tv-separator" />

      {/* Price info */}
      {lastPrice && (
        <>
          <div className="flex items-center gap-2 px-1.5">
            <span className="font-mono text-tv-text font-medium">{lastPrice.price.toFixed(2)}</span>
            <span className={`font-mono text-xs ${lastPrice.change >= 0 ? 'text-tv-green' : 'text-tv-red'}`}>
              {lastPrice.change >= 0 ? '+' : ''}{lastPrice.change.toFixed(2)}
            </span>
            <span className={`font-mono text-xs ${lastPrice.changePct >= 0 ? 'text-tv-green' : 'text-tv-red'}`}>
              ({lastPrice.changePct >= 0 ? '+' : ''}{lastPrice.changePct.toFixed(2)}%)
            </span>
          </div>
          <div className="tv-separator" />
        </>
      )}

      {/* Timeframe buttons */}
      <div className="flex items-center">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.value}
            onClick={() => onResolutionChange(tf.value)}
            className={`tv-btn h-[28px] px-2 text-[12px] font-medium ${
              resolution === tf.value
                ? 'text-tv-blue'
                : 'text-tv-text-muted hover:text-tv-text'
            }`}
          >
            {tf.label}
          </button>
        ))}
      </div>

      <div className="tv-separator" />

      {/* Chart type (Radix DropdownMenu) */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className="tv-btn h-[28px] px-2 text-tv-text-muted hover:text-tv-text data-[state=open]:text-tv-blue"
            title="Chart type"
          >
            {currentChartIcon}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="w-40 bg-tv-panel border border-tv-border rounded shadow-2xl z-50 py-1"
            sideOffset={4}
            align="start"
          >
            {CHART_TYPES.map((ct) => (
              <DropdownMenu.Item
                key={ct.type}
                onSelect={() => onChartTypeChange(ct.type)}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer outline-none hover:bg-tv-hover ${
                  chartType === ct.type ? 'text-tv-blue' : 'text-tv-text'
                }`}
              >
                {ct.icon}
                <span>{ct.label}</span>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <div className="tv-separator" />

      {/* Indicators */}
      <div className="relative" ref={indicatorRef}>
        <button
          onClick={() => setIndicatorOpen(!indicatorOpen)}
          className={`tv-btn h-[28px] px-2 flex items-center gap-1 ${
            indicatorOpen ? 'text-tv-blue' : 'text-tv-text-muted hover:text-tv-text'
          }`}
        >
          <Activity size={14} />
          <span className="text-[12px]">Indicators</span>
          {indicators.length > 0 && (
            <span className="bg-tv-blue text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center ml-0.5">
              {indicators.length}
            </span>
          )}
        </button>
        {indicatorOpen && (
          <div className="absolute top-full left-0 mt-1 w-72 bg-tv-panel border border-tv-border rounded shadow-2xl z-50">
            {indicators.length > 0 && (
              <div className="p-2 border-b border-tv-border">
                <div className="text-[11px] text-tv-text-muted uppercase tracking-wider mb-1 px-1">Active</div>
                {indicators.map((ind, idx) => (
                  <div key={idx} className="flex items-center justify-between px-2 py-1 rounded hover:bg-tv-hover">
                    <span className="text-sm text-tv-text">{ind.type}</span>
                    <button onClick={() => onRemoveIndicator(idx)} className="text-tv-text-muted hover:text-tv-red">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="p-2 max-h-56 overflow-y-auto">
              <div className="text-[11px] text-tv-text-muted uppercase tracking-wider mb-1 px-1">Add Indicator</div>
              {INDICATOR_REGISTRY.map((ind) => (
                <button
                  key={ind.type}
                  onClick={() => onAddIndicator(ind.type, ind.defaultParams)}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-tv-hover text-left"
                >
                  <div>
                    <div className="text-sm text-tv-text">{ind.name}</div>
                    <div className="text-[11px] text-tv-text-muted">{ind.description}</div>
                  </div>
                  <Plus size={13} className="text-tv-text-muted" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="tv-separator" />

      {/* Alert button */}
      <Tooltip.Provider delayDuration={300}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button className="tv-btn h-[28px] px-2 text-tv-text-muted hover:text-tv-text">
              <Bell size={14} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="bg-tv-panel border border-tv-border text-tv-text text-xs px-2 py-1 rounded shadow-lg z-50"
              sideOffset={4}
            >
              Create Alert
              <Tooltip.Arrow className="fill-tv-border" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side tools */}
      <div className="flex items-center gap-0.5">
        <button className="tv-btn h-[28px] px-2 text-tv-text-muted hover:text-tv-text" title="Screenshot">
          <Camera size={14} />
        </button>
        <button className="tv-btn h-[28px] px-2 text-tv-text-muted hover:text-tv-text" title="Save">
          <Save size={14} />
        </button>

        <ShareButton />

        <div className="tv-separator" />

        {/* Connection status */}
        {connected ? (
          <div className="flex items-center gap-1 px-1.5 text-tv-green text-[11px]">
            <Wifi size={12} />
            <span>Live</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 px-1.5 text-tv-red text-[11px]">
            <WifiOff size={12} />
            <span>Offline</span>
          </div>
        )}

        <button className="tv-btn h-[28px] px-2 text-tv-text-muted hover:text-tv-text" title="Settings">
          <Settings size={14} />
        </button>

        {/* Theme selector dropdown */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="tv-btn h-[28px] px-2 text-tv-text-muted hover:text-tv-text text-[11px]"
              title="Theme"
            >
              🎨
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content sideOffset={4} align="end" asChild>
              <ThemeSelector />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}

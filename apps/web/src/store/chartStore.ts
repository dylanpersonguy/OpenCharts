import { create } from 'zustand';
import type { Resolution, ChartType, DrawingType, IndicatorType } from '@opencharts/common';
import { BUILT_IN_THEMES } from '@opencharts/common';

interface PriceInfo {
  price: number;
  change: number;
  changePct: number;
}

interface ChartState {
  // Symbol & chart
  symbol: string;
  resolution: Resolution;
  chartType: ChartType;
  indicators: { type: IndicatorType; params?: Record<string, number> }[];
  activeTool: DrawingType | null;

  // UI state
  showWatchlist: boolean;
  showTranspiler: boolean;
  showCalendar: boolean;
  connected: boolean;
  lastPrice: PriceInfo | null;
  themeId: string;

  // Actions
  setSymbol: (symbol: string) => void;
  setResolution: (resolution: Resolution) => void;
  setChartType: (chartType: ChartType) => void;
  addIndicator: (type: IndicatorType, params?: Record<string, number>) => void;
  removeIndicator: (index: number) => void;
  setActiveTool: (tool: DrawingType | null) => void;
  setShowWatchlist: (show: boolean) => void;
  toggleWatchlist: () => void;
  setShowTranspiler: (show: boolean) => void;
  toggleTranspiler: () => void;
  setShowCalendar: (show: boolean) => void;
  toggleCalendar: () => void;
  setConnected: (connected: boolean) => void;
  setLastPrice: (price: number, change: number, changePct: number) => void;
  setTheme: (themeId: string) => void;
}

export const useChartStore = create<ChartState>((set) => ({
  symbol: 'BTC/USD',
  resolution: '1h',
  chartType: 'candlestick',
  indicators: [],
  activeTool: null,
  showWatchlist: true,
  showTranspiler: false,
  showCalendar: false,
  connected: false,
  lastPrice: null,
  themeId: 'dark',

  setSymbol: (symbol) => set({ symbol }),
  setResolution: (resolution) => set({ resolution }),
  setChartType: (chartType) => set({ chartType }),

  addIndicator: (type, params) =>
    set((state) => ({
      indicators: [...state.indicators, { type, params }],
    })),

  removeIndicator: (index) =>
    set((state) => ({
      indicators: state.indicators.filter((_, i) => i !== index),
    })),

  setActiveTool: (tool) => set({ activeTool: tool }),
  setShowWatchlist: (show) => set({ showWatchlist: show }),
  toggleWatchlist: () => set((state) => ({ showWatchlist: !state.showWatchlist })),
  setShowTranspiler: (show) => set({ showTranspiler: show }),
  toggleTranspiler: () => set((state) => ({ showTranspiler: !state.showTranspiler })),
  setShowCalendar: (show) => set({ showCalendar: show }),
  toggleCalendar: () => set((state) => ({ showCalendar: !state.showCalendar })),
  setConnected: (connected) => set({ connected }),
  setLastPrice: (price, change, changePct) =>
    set({ lastPrice: { price, change, changePct } }),
  setTheme: (themeId) => {
    set({ themeId });
    const theme = BUILT_IN_THEMES.find((t) => t.id === themeId);
    if (theme && typeof document !== 'undefined') {
      const root = document.documentElement;
      root.style.setProperty('--tv-bg', theme.colors.bg);
      root.style.setProperty('--tv-panel', theme.colors.panel);
      root.style.setProperty('--tv-border', theme.colors.border);
      root.style.setProperty('--tv-text', theme.colors.text);
      root.style.setProperty('--tv-text-muted', theme.colors.textMuted);
      root.style.setProperty('--tv-green', theme.colors.green);
      root.style.setProperty('--tv-red', theme.colors.red);
      root.style.setProperty('--tv-blue', theme.colors.accent);
    }
  },
}));

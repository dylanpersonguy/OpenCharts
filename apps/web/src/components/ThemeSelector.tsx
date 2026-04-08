'use client';

import React from 'react';
import { useChartStore } from '@/store/chartStore';
import { BUILT_IN_THEMES, type ChartTheme } from '@opencharts/common';

export default function ThemeSelector() {
  const { themeId, setTheme } = useChartStore();

  return (
    <div className="w-48 bg-tv-panel border border-tv-border rounded shadow-2xl z-50 py-1">
      {BUILT_IN_THEMES.map((theme: ChartTheme) => (
        <button
          key={theme.id}
          onClick={() => setTheme(theme.id)}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-tv-hover text-left ${
            themeId === theme.id ? 'text-tv-blue' : 'text-tv-text'
          }`}
        >
          {/* Color swatch */}
          <div className="flex gap-0.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: theme.colors.bg }} />
            <div className="w-3 h-3 rounded-sm" style={{ background: theme.colors.accent }} />
            <div className="w-3 h-3 rounded-sm" style={{ background: theme.colors.green }} />
          </div>
          <span>{theme.name}</span>
        </button>
      ))}
    </div>
  );
}

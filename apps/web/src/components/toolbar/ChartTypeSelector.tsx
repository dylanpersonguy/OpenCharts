'use client';

import React from 'react';
import { CandlestickChart, LineChart, AreaChart } from 'lucide-react';
import type { ChartType } from '@opencharts/common';

interface ChartTypeSelectorProps {
  current: ChartType;
  onChange: (ct: ChartType) => void;
}

const CHART_TYPES: { type: ChartType; icon: React.ReactNode; label: string }[] = [
  { type: 'candlestick', icon: <CandlestickChart size={16} />, label: 'Candles' },
  { type: 'line', icon: <LineChart size={16} />, label: 'Line' },
  { type: 'area', icon: <AreaChart size={16} />, label: 'Area' },
];

export default function ChartTypeSelector({ current, onChange }: ChartTypeSelectorProps) {
  return (
    <div className="flex items-center gap-0.5">
      {CHART_TYPES.map((ct) => (
        <button
          key={ct.type}
          onClick={() => onChange(ct.type)}
          title={ct.label}
          className={`p-1.5 rounded transition-colors ${
            current === ct.type
              ? 'text-chart-accent bg-chart-accent/10'
              : 'text-chart-textMuted hover:text-chart-text hover:bg-chart-hover'
          }`}
        >
          {ct.icon}
        </button>
      ))}
    </div>
  );
}

'use client';

import React from 'react';
import type { Resolution } from '@opencharts/common';

const TIMEFRAMES: { label: string; value: Resolution }[] = [
  { label: '1s', value: '1s' },
  { label: '5s', value: '5s' },
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1H', value: '1h' },
  { label: '4H', value: '4h' },
  { label: '1D', value: '1d' },
  { label: '1W', value: '1w' },
];

interface TimeframeSelectorProps {
  current: Resolution;
  onChange: (r: Resolution) => void;
}

export default function TimeframeSelector({ current, onChange }: TimeframeSelectorProps) {
  return (
    <div className="flex items-center gap-0.5">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.value}
          onClick={() => onChange(tf.value)}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            current === tf.value
              ? 'bg-chart-accent text-white'
              : 'text-chart-textMuted hover:text-chart-text hover:bg-chart-hover'
          }`}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}

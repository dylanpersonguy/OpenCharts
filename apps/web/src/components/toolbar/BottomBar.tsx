'use client';

import React from 'react';
import type { Resolution } from '@opencharts/common';

interface BottomBarProps {
  symbol: string;
  resolution: Resolution;
  connected: boolean;
}

const TIME_RANGES = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All'] as const;

export default function BottomBar({ symbol, resolution, connected }: BottomBarProps) {
  const [timeStr, setTimeStr] = React.useState('');
  const [tz, setTz] = React.useState('');

  React.useEffect(() => {
    setTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const tick = () =>
      setTimeStr(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center h-[24px] px-2 bg-tv-toolbar border-t border-tv-border text-[11px] text-tv-text-muted">
      {/* Time ranges */}
      <div className="flex items-center gap-0.5">
        {TIME_RANGES.map((range) => (
          <button
            key={range}
            className="px-1.5 py-0.5 rounded hover:bg-tv-hover hover:text-tv-text transition-colors"
          >
            {range}
          </button>
        ))}
      </div>

      <div className="tv-separator !h-3" />

      {/* Symbol + resolution */}
      <span className="text-tv-text-muted">
        {symbol} · {resolution.toUpperCase()}
      </span>

      <div className="flex-1" />

      {/* Timezone + time */}
      <span>{timeStr} {tz}</span>

      <div className="tv-separator !h-3" />

      {/* Connection dot */}
      <div className="flex items-center gap-1">
        <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-tv-green' : 'bg-tv-red'}`} />
        <span>OpenCharts v0.1.0</span>
      </div>
    </div>
  );
}

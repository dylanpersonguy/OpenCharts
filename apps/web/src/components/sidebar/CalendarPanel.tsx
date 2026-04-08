'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface CalEvent {
  id: string;
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  currency: string;
}

const impactColor: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500',
};

export default function CalendarPanel() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getCalendarEvents(filter !== 'all' ? { impact: filter } : undefined)
      .then((res) => {
        if (!cancelled) setEvents(res.events);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  return (
    <div className="flex flex-col w-[320px] bg-tv-toolbar border-l border-tv-border h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-tv-border">
        <span className="text-tv-text text-xs font-semibold uppercase tracking-wider">
          Economic Calendar
        </span>
      </div>

      {/* Filter */}
      <div className="flex gap-1 px-2 py-1 border-b border-tv-border">
        {['all', 'high', 'medium', 'low'].map((level) => (
          <button
            key={level}
            onClick={() => setFilter(level)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              filter === level
                ? 'bg-tv-blue text-white'
                : 'text-tv-text-muted hover:text-tv-text hover:bg-tv-hover'
            }`}
          >
            {level.charAt(0).toUpperCase() + level.slice(1)}
          </button>
        ))}
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-20">
            <div className="w-4 h-4 border-2 border-tv-blue border-t-transparent rounded-full animate-spin" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-tv-text-muted text-xs text-center py-6">No events</div>
        ) : (
          events.map((ev) => (
            <div
              key={ev.id}
              className="flex items-start gap-2 px-3 py-2 border-b border-tv-border/50 hover:bg-tv-hover/50 transition-colors"
            >
              {/* Impact dot */}
              <div
                className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${impactColor[ev.impact] ?? 'bg-gray-500'}`}
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-tv-text-muted font-mono">
                    {ev.country}
                  </span>
                  <span className="text-[10px] text-tv-text-muted">
                    {new Date(ev.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="text-xs text-tv-text truncate">{ev.title}</div>
                <div className="flex gap-3 mt-0.5 text-[10px]">
                  {ev.actual !== null && (
                    <span className="text-tv-text">
                      Act: <span className="font-medium">{ev.actual}</span>
                    </span>
                  )}
                  {ev.forecast !== null && (
                    <span className="text-tv-text-muted">
                      Fcst: {ev.forecast}
                    </span>
                  )}
                  {ev.previous !== null && (
                    <span className="text-tv-text-muted">
                      Prev: {ev.previous}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

'use client';

import React from 'react';
import {
  List,
  Bell,
  Calendar,
  Newspaper,
  MessageSquare,
  Bot,
  MoreHorizontal,
  FileCode,
} from 'lucide-react';

interface RightIconBarProps {
  showWatchlist: boolean;
  showTranspiler: boolean;
  showCalendar: boolean;
  onToggleWatchlist: () => void;
  onToggleTranspiler: () => void;
  onToggleCalendar: () => void;
}

export default function RightIconBar({ showWatchlist, showTranspiler, showCalendar, onToggleWatchlist, onToggleTranspiler, onToggleCalendar }: RightIconBarProps) {
  return (
    <div className="flex flex-col items-center w-[34px] bg-tv-toolbar border-l border-tv-border py-1 gap-0.5">
      <button
        onClick={onToggleWatchlist}
        title="Watchlist"
        className={`w-[28px] h-[28px] flex items-center justify-center rounded transition-colors ${
          showWatchlist ? 'text-tv-blue' : 'text-tv-text-muted hover:text-tv-text hover:bg-tv-hover'
        }`}
      >
        <List size={16} />
      </button>

      <button
        onClick={onToggleTranspiler}
        title="Pine Transpiler"
        className={`w-[28px] h-[28px] flex items-center justify-center rounded transition-colors ${
          showTranspiler ? 'text-tv-blue' : 'text-tv-text-muted hover:text-tv-text hover:bg-tv-hover'
        }`}
      >
        <FileCode size={16} />
      </button>

      <button
        title="Alerts"
        className="w-[28px] h-[28px] flex items-center justify-center rounded text-tv-text-muted hover:text-tv-text hover:bg-tv-hover transition-colors"
      >
        <Bell size={16} />
      </button>

      <button
        onClick={onToggleCalendar}
        title="Calendar"
        className={`w-[28px] h-[28px] flex items-center justify-center rounded transition-colors ${
          showCalendar ? 'text-tv-blue' : 'text-tv-text-muted hover:text-tv-text hover:bg-tv-hover'
        }`}
      >
        <Calendar size={16} />
      </button>

      <button
        title="News"
        className="w-[28px] h-[28px] flex items-center justify-center rounded text-tv-text-muted hover:text-tv-text hover:bg-tv-hover transition-colors"
      >
        <Newspaper size={16} />
      </button>

      <div className="w-5 h-px bg-tv-border my-1" />

      <button
        title="Community"
        className="w-[28px] h-[28px] flex items-center justify-center rounded text-tv-text-muted hover:text-tv-text hover:bg-tv-hover transition-colors"
      >
        <MessageSquare size={16} />
      </button>

      <button
        title="AI Assistant"
        className="w-[28px] h-[28px] flex items-center justify-center rounded text-tv-text-muted hover:text-tv-text hover:bg-tv-hover transition-colors"
      >
        <Bot size={16} />
      </button>

      <div className="flex-1" />

      <button
        title="More"
        className="w-[28px] h-[28px] flex items-center justify-center rounded text-tv-text-muted hover:text-tv-text hover:bg-tv-hover transition-colors"
      >
        <MoreHorizontal size={16} />
      </button>
    </div>
  );
}

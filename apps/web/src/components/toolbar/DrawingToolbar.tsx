'use client';

import React from 'react';
import {
  Minus,
  TrendingUp,
  Square,
  Type,
  MousePointer,
  Trash2,
  Crosshair,
  PenTool,
  Triangle,
  Ruler,
  Magnet,
  ZoomIn,
} from 'lucide-react';
import type { DrawingType } from '@opencharts/common';

interface DrawingToolbarProps {
  activeTool: DrawingType | null;
  onSelectTool: (tool: DrawingType | null) => void;
  onClearAll: () => void;
}

const DRAWING_TOOLS: { type: DrawingType; icon: React.ReactNode; label: string }[] = [
  { type: 'horizontal_line', icon: <Minus size={16} />, label: 'Horizontal Line' },
  { type: 'trend_line', icon: <TrendingUp size={16} />, label: 'Trend Line' },
  { type: 'rectangle', icon: <Square size={16} />, label: 'Rectangle' },
  { type: 'text_annotation', icon: <Type size={16} />, label: 'Text' },
];

export default function DrawingToolbar({ activeTool, onSelectTool, onClearAll }: DrawingToolbarProps) {
  const btnClass = (active: boolean) =>
    `w-[30px] h-[30px] flex items-center justify-center rounded transition-colors ${
      active ? 'text-tv-blue bg-tv-blue/10' : 'text-tv-text-muted hover:text-tv-text hover:bg-tv-hover'
    }`;

  return (
    <div className="flex flex-col items-center w-[38px] bg-tv-toolbar border-r border-tv-border py-1 gap-0.5">
      {/* Pointer / Crosshair */}
      <button onClick={() => onSelectTool(null)} title="Pointer" className={btnClass(activeTool === null)}>
        <MousePointer size={16} />
      </button>
      <button title="Crosshair" className="w-[30px] h-[30px] flex items-center justify-center rounded text-tv-text-muted hover:text-tv-text hover:bg-tv-hover">
        <Crosshair size={16} />
      </button>

      <div className="w-5 h-px bg-tv-border my-0.5" />

      {/* Drawing tools */}
      {DRAWING_TOOLS.map((tool) => (
        <button
          key={tool.type}
          onClick={() => onSelectTool(activeTool === tool.type ? null : tool.type)}
          title={tool.label}
          className={btnClass(activeTool === tool.type)}
        >
          {tool.icon}
        </button>
      ))}

      <div className="w-5 h-px bg-tv-border my-0.5" />

      {/* Extra tools */}
      <button title="Freehand" className="w-[30px] h-[30px] flex items-center justify-center rounded text-tv-text-muted hover:text-tv-text hover:bg-tv-hover">
        <PenTool size={16} />
      </button>
      <button title="Triangle" className="w-[30px] h-[30px] flex items-center justify-center rounded text-tv-text-muted hover:text-tv-text hover:bg-tv-hover">
        <Triangle size={16} />
      </button>
      <button title="Ruler" className="w-[30px] h-[30px] flex items-center justify-center rounded text-tv-text-muted hover:text-tv-text hover:bg-tv-hover">
        <Ruler size={16} />
      </button>
      <button title="Zoom" className="w-[30px] h-[30px] flex items-center justify-center rounded text-tv-text-muted hover:text-tv-text hover:bg-tv-hover">
        <ZoomIn size={16} />
      </button>

      <div className="w-5 h-px bg-tv-border my-0.5" />

      <button title="Magnet" className="w-[30px] h-[30px] flex items-center justify-center rounded text-tv-text-muted hover:text-tv-text hover:bg-tv-hover">
        <Magnet size={16} />
      </button>

      <div className="flex-1" />

      {/* Clear all */}
      <button
        onClick={onClearAll}
        title="Clear All Drawings"
        className="w-[30px] h-[30px] flex items-center justify-center rounded text-tv-text-muted hover:text-tv-red hover:bg-tv-hover transition-colors"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

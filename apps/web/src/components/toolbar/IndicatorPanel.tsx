'use client';

import React, { useState } from 'react';
import { Activity, Plus, X } from 'lucide-react';
import { INDICATOR_REGISTRY } from '@opencharts/common';
import type { IndicatorType } from '@opencharts/common';

interface IndicatorPanelProps {
  activeIndicators: { type: IndicatorType; params?: Record<string, number> }[];
  onAdd: (type: IndicatorType, params?: Record<string, number>) => void;
  onRemove: (index: number) => void;
}

export default function IndicatorPanel({ activeIndicators, onAdd, onRemove }: IndicatorPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded text-sm hover:bg-chart-hover text-chart-textMuted hover:text-chart-text"
      >
        <Activity size={14} />
        <span>Indicators</span>
        {activeIndicators.length > 0 && (
          <span className="bg-chart-accent text-white text-xs px-1.5 rounded-full">
            {activeIndicators.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-chart-panel border border-chart-border rounded-lg shadow-xl z-50">
          <div className="p-3 border-b border-chart-border">
            <h3 className="text-sm font-medium">Indicators</h3>
          </div>

          {/* Active indicators */}
          {activeIndicators.length > 0 && (
            <div className="p-2 border-b border-chart-border">
              <div className="text-xs text-chart-textMuted mb-1 px-2">Active</div>
              {activeIndicators.map((ind, idx) => (
                <div key={idx} className="flex items-center justify-between px-2 py-1 rounded hover:bg-chart-hover">
                  <span className="text-sm">{ind.type}</span>
                  <button
                    onClick={() => onRemove(idx)}
                    className="text-chart-textMuted hover:text-chart-red"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Available indicators */}
          <div className="p-2 max-h-48 overflow-y-auto">
            <div className="text-xs text-chart-textMuted mb-1 px-2">Add Indicator</div>
            {INDICATOR_REGISTRY.map((ind) => (
              <button
                key={ind.type}
                onClick={() => {
                  onAdd(ind.type, ind.defaultParams);
                }}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-chart-hover text-left"
              >
                <div>
                  <div className="text-sm">{ind.name}</div>
                  <div className="text-xs text-chart-textMuted">{ind.description}</div>
                </div>
                <Plus size={14} className="text-chart-textMuted" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

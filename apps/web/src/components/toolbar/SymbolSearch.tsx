'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';

interface SymbolSearchProps {
  currentSymbol: string;
  onSelect: (symbol: string) => void;
}

export default function SymbolSearch({ currentSymbol, onSelect }: SymbolSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ ticker: string; name: string; exchange: string; asset_class: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await api.searchSymbols(query);
        setResults(data as { ticker: string; name: string; exchange: string; asset_class: string }[]);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => { setOpen(!open); setQuery(''); }}
        className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-chart-hover text-sm font-medium"
      >
        <Search size={14} className="text-chart-textMuted" />
        <span>{currentSymbol}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-80 bg-chart-panel border border-chart-border rounded-lg shadow-xl z-50">
          <div className="p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symbol..."
              className="w-full px-3 py-2 bg-chart-bg border border-chart-border rounded text-sm text-chart-text placeholder-chart-textMuted focus:border-chart-accent"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {results.map((r) => (
              <button
                key={r.ticker}
                onClick={() => {
                  onSelect(r.ticker);
                  setOpen(false);
                }}
                className="w-full flex items-center justify-between px-4 py-2 hover:bg-chart-hover text-sm"
              >
                <div>
                  <span className="font-medium">{r.ticker}</span>
                  <span className="text-chart-textMuted ml-2">{r.name}</span>
                </div>
                <span className="text-xs text-chart-textMuted">{r.exchange}</span>
              </button>
            ))}
            {query && results.length === 0 && (
              <div className="px-4 py-3 text-sm text-chart-textMuted text-center">No results</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

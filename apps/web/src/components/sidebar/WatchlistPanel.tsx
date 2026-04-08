'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Search, MoreHorizontal, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '@/lib/api';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table';

interface WatchlistPanelProps {
  onSelectSymbol: (symbol: string) => void;
  currentSymbol: string;
}

interface WatchlistData {
  id: string;
  name: string;
  items: { id: string; symbol: string; sortOrder: number }[];
}

interface SymbolRow {
  symbol: string;
  last: number;
  change: number;
  changePct: number;
}

export default function WatchlistPanel({ onSelectSymbol, currentSymbol }: WatchlistPanelProps) {
  const [watchlists, setWatchlists] = useState<WatchlistData[]>([]);
  const [loading, setLoading] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);

  const defaultRows: SymbolRow[] = [
    { symbol: 'BTC/USD', last: 67234.50, change: 1234.50, changePct: 1.87 },
    { symbol: 'ETH/USD', last: 3456.78, change: -45.32, changePct: -1.29 },
    { symbol: 'SOL/USD', last: 178.90, change: 5.67, changePct: 3.27 },
    { symbol: 'EUR/USD', last: 1.0892, change: 0.0034, changePct: 0.31 },
    { symbol: 'AAPL', last: 195.42, change: 2.15, changePct: 1.11 },
    { symbol: 'MSFT', last: 430.16, change: -3.42, changePct: -0.79 },
    { symbol: 'TSLA', last: 245.67, change: 12.34, changePct: 5.29 },
  ];

  useEffect(() => {
    loadWatchlists();
  }, []);

  async function loadWatchlists() {
    try {
      setLoading(true);
      const data = await api.getWatchlists() as unknown as WatchlistData[];
      setWatchlists(data);
    } catch {
      setWatchlists([]);
    } finally {
      setLoading(false);
    }
  }

  const data: SymbolRow[] = watchlists.length > 0
    ? watchlists.flatMap((wl) =>
        wl.items.map((item) => ({
          symbol: item.symbol,
          last: 0,
          change: 0,
          changePct: 0,
        }))
      )
    : defaultRows;

  const columnHelper = createColumnHelper<SymbolRow>();

  const columns = useMemo(() => [
    columnHelper.accessor('symbol', {
      header: 'Symbol',
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
      size: 90,
    }),
    columnHelper.accessor('last', {
      header: 'Last',
      cell: (info) => {
        const v = info.getValue();
        return <span className="font-mono tabular-nums">{v.toFixed(v < 10 ? 4 : 2)}</span>;
      },
      size: 70,
    }),
    columnHelper.accessor('change', {
      header: 'Chg',
      cell: (info) => {
        const v = info.getValue();
        const last = info.row.original.last;
        return (
          <span className={`font-mono tabular-nums ${v >= 0 ? 'text-tv-green' : 'text-tv-red'}`}>
            {v >= 0 ? '+' : ''}{v.toFixed(last < 10 ? 4 : 2)}
          </span>
        );
      },
      size: 60,
    }),
    columnHelper.accessor('changePct', {
      header: 'Chg%',
      cell: (info) => {
        const v = info.getValue();
        return (
          <span className={`font-mono tabular-nums ${v >= 0 ? 'text-tv-green' : 'text-tv-red'}`}>
            {v >= 0 ? '+' : ''}{v.toFixed(2)}%
          </span>
        );
      },
      size: 55,
    }),
  ], [columnHelper]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="w-[280px] bg-tv-panel border-l border-tv-border flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-tv-border">
        <span className="text-[13px] font-medium text-tv-text">Watchlist</span>
        <div className="flex items-center gap-1">
          <button className="w-6 h-6 flex items-center justify-center rounded text-tv-text-muted hover:text-tv-text hover:bg-tv-hover">
            <Plus size={14} />
          </button>
          <button className="w-6 h-6 flex items-center justify-center rounded text-tv-text-muted hover:text-tv-text hover:bg-tv-hover">
            <Search size={14} />
          </button>
          <button className="w-6 h-6 flex items-center justify-center rounded text-tv-text-muted hover:text-tv-text hover:bg-tv-hover">
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>

      {/* Column headers (sortable) */}
      <div className="border-b border-tv-border">
        {table.getHeaderGroups().map((headerGroup) => (
          <div key={headerGroup.id} className="flex px-2 py-1">
            {headerGroup.headers.map((header) => (
              <button
                key={header.id}
                onClick={header.column.getToggleSortingHandler()}
                className="flex items-center gap-0.5 text-[10px] text-tv-text-muted uppercase tracking-wider hover:text-tv-text cursor-pointer select-none"
                style={{ width: header.getSize(), flexShrink: 0, justifyContent: header.id === 'symbol' ? 'flex-start' : 'flex-end' }}
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
                {header.column.getIsSorted() === 'asc' && <ArrowUp size={10} />}
                {header.column.getIsSorted() === 'desc' && <ArrowDown size={10} />}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {table.getRowModel().rows.map((row) => (
          <button
            key={row.original.symbol}
            onClick={() => onSelectSymbol(row.original.symbol)}
            className={`w-full flex items-center px-2 py-[5px] text-[12px] transition-colors ${
              currentSymbol === row.original.symbol
                ? 'bg-tv-blue/10 text-tv-text'
                : 'text-tv-text hover:bg-tv-hover'
            }`}
          >
            {row.getVisibleCells().map((cell) => (
              <span
                key={cell.id}
                className={cell.column.id === 'symbol' ? 'text-left' : 'text-right'}
                style={{ width: cell.column.getSize(), flexShrink: 0 }}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </span>
            ))}
          </button>
        ))}
      </div>

      {/* Selected symbol detail */}
      <div className="border-t border-tv-border px-3 py-2">
        <div className="text-[11px] text-tv-text-muted mb-1">Selected</div>
        <div className="text-lg font-semibold text-tv-text font-mono">{currentSymbol}</div>
      </div>
    </div>
  );
}

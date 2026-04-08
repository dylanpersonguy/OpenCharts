'use client';

import React, { useState, useCallback } from 'react';
import { Play, Copy, Check, ChevronDown } from 'lucide-react';
import { api } from '@/lib/api';

const EXAMPLE_SCRIPT = `//@version=5
indicator("My RSI", overlay=false)
length = input.int(14, title="RSI Length")
src = close
rsiValue = ta.rsi(src, length)

overbought = 70
oversold = 30

plot(rsiValue, title="RSI", color=#2962FF)
hline(overbought, color=#FF0000)
hline(oversold, color=#00FF00)
`;

type TargetLang = 'typescript' | 'python';

export default function TranspilerPanel() {
  const [source, setSource] = useState(EXAMPLE_SCRIPT);
  const [target, setTarget] = useState<TargetLang>('typescript');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleTranspile = useCallback(async () => {
    if (!source.trim()) return;
    setLoading(true);
    setError('');
    setOutput('');
    try {
      const result = await api.transpile(source, target);
      setOutput(result.code);
    } catch (err: any) {
      setError(err.message || 'Transpile failed');
    } finally {
      setLoading(false);
    }
  }, [source, target]);

  const handleCopy = useCallback(() => {
    if (!output) return;
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  return (
    <div className="w-[420px] bg-tv-panel border-l border-tv-border flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-tv-border">
        <span className="text-tv-text text-sm font-medium">PineScript Transpiler</span>
        <div className="flex items-center gap-1">
          {/* Target language selector */}
          <div className="relative">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as TargetLang)}
              className="appearance-none bg-tv-bg text-tv-text text-xs rounded px-2 py-1 pr-6 border border-tv-border focus:border-tv-blue focus:outline-none cursor-pointer"
            >
              <option value="typescript">TypeScript</option>
              <option value="python">Python</option>
            </select>
            <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-tv-text-muted pointer-events-none" />
          </div>

          {/* Transpile button */}
          <button
            onClick={handleTranspile}
            disabled={loading || !source.trim()}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-tv-blue text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Play size={12} />
            {loading ? 'Transpiling...' : 'Transpile'}
          </button>
        </div>
      </div>

      {/* Source editor */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-1 border-b border-tv-border">
          <span className="text-tv-text-muted text-[11px] uppercase tracking-wider">PineScript Input</span>
        </div>
        <div className="flex-1 min-h-0">
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            className="w-full h-full bg-tv-bg text-tv-text text-xs font-mono p-3 resize-none focus:outline-none border-none"
            placeholder="Paste your PineScript code here..."
          />
        </div>
      </div>

      {/* Output */}
      <div className="flex-1 flex flex-col min-h-0 border-t border-tv-border">
        <div className="flex items-center justify-between px-3 py-1 border-b border-tv-border">
          <span className="text-tv-text-muted text-[11px] uppercase tracking-wider">
            {target === 'typescript' ? 'TypeScript' : 'Python'} Output
          </span>
          {output && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-tv-text-muted hover:text-tv-text text-[11px] transition-colors"
            >
              {copied ? <Check size={12} className="text-tv-green" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {error ? (
            <div className="p-3 text-tv-red text-xs font-mono whitespace-pre-wrap">{error}</div>
          ) : output ? (
            <pre className="p-3 text-tv-text text-xs font-mono whitespace-pre overflow-x-auto">{output}</pre>
          ) : (
            <div className="p-3 text-tv-text-muted text-xs italic">
              Click &quot;Transpile&quot; to convert PineScript to {target === 'typescript' ? 'TypeScript' : 'Python'}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

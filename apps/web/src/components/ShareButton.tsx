'use client';

import React, { useState } from 'react';
import { Share2, Check, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { useChartStore } from '@/store/chartStore';

export default function ShareButton() {
  const { symbol, resolution, chartType, indicators } = useChartStore();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleShare = async () => {
    setLoading(true);
    try {
      const result = await api.createSnapshot({
        symbol,
        resolution,
        chartType,
        indicators,
      });
      const url = `${window.location.origin}${result.url}`;
      setShareUrl(url);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      <button
        onClick={handleShare}
        disabled={loading}
        title="Share chart"
        className="flex items-center gap-1 px-2 py-1 text-xs text-tv-text-muted hover:text-tv-text hover:bg-tv-hover rounded transition-colors"
      >
        <Share2 size={14} />
        <span>Share</span>
      </button>

      {shareUrl && (
        <div className="absolute top-full right-0 mt-1 bg-tv-toolbar border border-tv-border rounded shadow-lg p-2 z-50 w-64">
          <div className="flex items-center gap-1">
            <input
              type="text"
              readOnly
              value={shareUrl}
              className="flex-1 bg-tv-bg text-tv-text text-xs px-2 py-1 rounded border border-tv-border outline-none"
            />
            <button
              onClick={handleCopy}
              className="p-1 hover:bg-tv-hover rounded transition-colors text-tv-text-muted hover:text-tv-text"
            >
              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
            </button>
          </div>
          <button
            onClick={() => setShareUrl(null)}
            className="text-[10px] text-tv-text-muted mt-1 hover:text-tv-text"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

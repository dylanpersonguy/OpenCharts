'use client';

import { useEffect, useRef, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface UseSSEOptions {
  symbols: string[];
  onBarUpdate?: (data: Record<string, unknown>) => void;
  enabled?: boolean;
}

/**
 * useSSE — Server-Sent Events fallback for environments where
 * WebSocket connections are blocked.
 */
export function useSSE({ symbols, onBarUpdate, enabled = true }: UseSSEOptions) {
  const sourceRef = useRef<EventSource | null>(null);
  const onBarUpdateRef = useRef(onBarUpdate);
  onBarUpdateRef.current = onBarUpdate;

  const connect = useCallback(() => {
    if (!enabled || symbols.length === 0) return;

    const query = symbols.join(',');
    const url = `${API_BASE}/api/sse/bars?symbols=${encodeURIComponent(query)}`;
    const source = new EventSource(url);

    source.addEventListener('bar', (event) => {
      try {
        const data = JSON.parse(event.data);
        onBarUpdateRef.current?.(data);
      } catch {
        // ignore parse errors
      }
    });

    source.onerror = () => {
      // EventSource auto-reconnects
    };

    sourceRef.current = source;
  }, [symbols, enabled]);

  useEffect(() => {
    connect();
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [connect]);

  const disconnect = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  return { disconnect };
}

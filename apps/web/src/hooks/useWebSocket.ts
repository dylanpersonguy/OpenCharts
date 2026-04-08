import { useEffect, useRef, useCallback, useState } from 'react';
import type { WsClientMessage, WsServerMessage, OHLCV, Resolution } from '@opencharts/common';
import { WS_RECONNECT_DELAY, WS_MAX_RECONNECT_ATTEMPTS } from '@opencharts/common';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000/ws';

type BarUpdateHandler = (bar: OHLCV, isClosed: boolean) => void;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, BarUpdateHandler>>(new Map());
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setConnected(true);
      reconnectCountRef.current = 0;
      // Re-subscribe to all existing subscriptions
      handlersRef.current.forEach((_, key) => {
        const [symbol, resolution] = key.split('::');
        const msg: WsClientMessage = { type: 'subscribe', symbol, resolution: resolution as Resolution };
        ws.send(JSON.stringify(msg));
      });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsServerMessage;
        switch (msg.type) {
          case 'bar_update': {
            const key = `${msg.symbol}::${msg.resolution}`;
            const handler = handlersRef.current.get(key);
            handler?.(msg.bar, msg.isClosed);
            break;
          }
          case 'ping': {
            const pong: WsClientMessage = { type: 'pong' };
            ws.send(JSON.stringify(pong));
            break;
          }
          case 'error':
            console.error('WS error:', msg.message);
            break;
        }
      } catch (err) {
        console.error('WS message parse error:', err);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Reconnect
      if (reconnectCountRef.current < WS_MAX_RECONNECT_ATTEMPTS) {
        reconnectCountRef.current++;
        reconnectTimeoutRef.current = setTimeout(connect, WS_RECONNECT_DELAY);
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const subscribe = useCallback(
    (symbol: string, resolution: Resolution, onUpdate: BarUpdateHandler) => {
      const key = `${symbol}::${resolution}`;
      handlersRef.current.set(key, onUpdate);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const msg: WsClientMessage = { type: 'subscribe', symbol, resolution };
        wsRef.current.send(JSON.stringify(msg));
      }

      return () => {
        handlersRef.current.delete(key);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const msg: WsClientMessage = { type: 'unsubscribe', symbol, resolution };
          wsRef.current.send(JSON.stringify(msg));
        }
      };
    },
    [],
  );

  return { subscribe, connected };
}

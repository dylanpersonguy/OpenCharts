import type { ConnectionState } from "../adapter/types.ts";
import { getEndpoints } from "./config.ts";

/**
 * One resilient WebSocket to Hyperliquid, shared by every consumer.
 *
 * - Refcounted subscriptions: identical subscriptions share one server-side
 *   subscription; unsubscribe is sent when the last holder leaves.
 * - Everything is resubscribed after a reconnect (exponential backoff + jitter).
 * - Heartbeat: HL closes sockets idle for 60s. Protocol (verified against the
 *   SDK's `_keepAlive.js`): send the text frame `{"method":"ping"}`, the server
 *   answers `{"channel":"pong"}`. An unanswered ping means a half-open
 *   connection, so we drop the socket and reconnect.
 * - Limits (HL docs): max 1000 subscriptions per IP and 10 WebSocket
 *   connections per IP. This manager uses exactly one connection; share one
 *   instance per app.
 * - Routing: server frames look like `{channel, data}`. Handlers are keyed by
 *   channel (`allMids`, `bbo`, `candle`, `l2Book`, `user`, `userFills`, ...) and
 *   receive `data`; a handler filters by coin/interval itself because HL does
 *   not echo the subscription key.
 */

export const HL_MAX_SUBSCRIPTIONS = 1000;
export const HL_MAX_CONNECTIONS = 10;

export type HlSubscription = { type: string } & Record<string, string | number | boolean | undefined>;

/** Channel a subscription's data frames arrive on. `userEvents` is the odd one out. */
export function channelOf(sub: HlSubscription): string {
  return sub.type === "userEvents" ? "user" : sub.type;
}

/** Stable identity of a subscription (key order independent). */
export function subscriptionKey(sub: HlSubscription): string {
  const entries = Object.entries(sub)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

export type ChannelHandler = (data: unknown) => void;

export interface HlSocketOptions {
  url?: string;
  webSocketImpl?: typeof WebSocket;
  /** Heartbeat interval (default 30s). */
  pingIntervalMs?: number;
  /** How long to wait for a pong before reconnecting (default 10s). */
  pongTimeoutMs?: number;
  /** Backoff base (default 1s) and cap (default 30s). */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Injected in tests; returns [0,1). */
  random?: () => number;
}

export interface HlSocket {
  connect(): void;
  /** Close and stop reconnecting. Subscriptions are kept for a later connect(). */
  disconnect(): void;
  /**
   * Subscribe `handler` to `sub`'s channel. Returns an unsubscribe function.
   * Throws if it would exceed the server-side subscription limit.
   */
  subscribe(sub: HlSubscription, handler: ChannelHandler): () => void;
  getState(): ConnectionState;
  onState(listener: (state: ConnectionState) => void): () => void;
  /** Number of distinct server-side subscriptions currently held. */
  subscriptionCount(): number;
}

interface Entry {
  sub: HlSubscription;
  channel: string;
  count: number;
}

export function createHlSocket(options: HlSocketOptions = {}): HlSocket {
  const SocketImpl = options.webSocketImpl ?? globalThis.WebSocket;
  const pingEvery = options.pingIntervalMs ?? 30_000;
  const pongTimeout = options.pongTimeoutMs ?? 10_000;
  const backoffBase = options.backoffBaseMs ?? 1_000;
  const backoffMax = options.backoffMaxMs ?? 30_000;
  const random = options.random ?? Math.random;

  const entries = new Map<string, Entry>();
  const handlers = new Map<string, Set<ChannelHandler>>();
  const stateListeners = new Set<(s: ConnectionState) => void>();

  let socket: WebSocket | null = null;
  let state: ConnectionState = "disconnected";
  let wantOpen = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;

  const setState = (next: ConnectionState) => {
    if (state === next) return;
    state = next;
    for (const l of [...stateListeners]) {
      try {
        l(next);
      } catch (err) {
        console.error("[hl-ws] state listener threw", err);
      }
    }
  };

  const rawSend = (payload: unknown) => {
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify(payload));
    }
  };

  const clearHeartbeat = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (pongTimer) clearTimeout(pongTimer);
    pingTimer = null;
    pongTimer = null;
  };

  const url = () => options.url ?? getEndpoints().ws;

  function scheduleReconnect() {
    if (!wantOpen || reconnectTimer) return;
    setState("reconnecting");
    const ceiling = Math.min(backoffMax, backoffBase * 2 ** attempt);
    // Equal jitter: half fixed, half random, so clients do not stampede.
    const delay = Math.round(ceiling / 2 + random() * (ceiling / 2));
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  }

  function open() {
    if (socket || !wantOpen) return;
    setState(attempt === 0 ? "connecting" : "reconnecting");
    let ws: WebSocket;
    try {
      ws = new SocketImpl(url());
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      if (socket !== ws) return;
      attempt = 0;
      setState("connected");
      for (const e of entries.values()) {
        rawSend({ method: "subscribe", subscription: e.sub });
      }
      clearHeartbeat();
      pingTimer = setInterval(() => {
        rawSend({ method: "ping" });
        pongTimer ??= setTimeout(() => {
          pongTimer = null;
          // Half-open connection: tear down; onclose reconnects.
          try {
            ws.close();
          } catch {
            /* already closed */
          }
          if (socket === ws) handleClose(ws);
        }, pongTimeout);
      }, pingEvery);
    };

    ws.onmessage = (message: MessageEvent) => {
      if (socket !== ws) return;
      // Any inbound frame proves the link is alive.
      if (pongTimer) {
        clearTimeout(pongTimer);
        pongTimer = null;
      }
      let frame: { channel?: unknown; data?: unknown };
      try {
        frame = JSON.parse(String(message.data)) as { channel?: unknown; data?: unknown };
      } catch {
        return;
      }
      if (typeof frame.channel !== "string") return;
      const set = handlers.get(frame.channel);
      if (!set) return;
      for (const h of [...set]) {
        try {
          h(frame.data);
        } catch (err) {
          console.error("[hl-ws] handler threw", err);
        }
      }
    };

    ws.onclose = () => handleClose(ws);
    ws.onerror = () => {
      // onclose always follows.
    };
  }

  function handleClose(ws: WebSocket) {
    if (socket !== ws) return;
    socket = null;
    clearHeartbeat();
    if (!wantOpen) {
      setState("disconnected");
      return;
    }
    scheduleReconnect();
  }

  return {
    connect() {
      wantOpen = true;
      if (socket || reconnectTimer) return;
      open();
    },

    disconnect() {
      wantOpen = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      clearHeartbeat();
      attempt = 0;
      const ws = socket;
      socket = null;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      setState("disconnected");
    },

    subscribe(sub, handler) {
      const key = subscriptionKey(sub);
      const channel = channelOf(sub);
      let entry = entries.get(key);
      if (!entry) {
        if (entries.size >= HL_MAX_SUBSCRIPTIONS) {
          throw new Error(`Hyperliquid allows at most ${HL_MAX_SUBSCRIPTIONS} subscriptions per connection`);
        }
        entry = { sub, channel, count: 0 };
        entries.set(key, entry);
        rawSend({ method: "subscribe", subscription: sub });
      }
      entry.count += 1;

      let set = handlers.get(channel);
      if (!set) {
        set = new Set();
        handlers.set(channel, set);
      }
      // Wrap so the same function can be registered by two subscriptions.
      const wrapped: ChannelHandler = (data) => handler(data);
      set.add(wrapped);

      let released = false;
      return () => {
        if (released) return;
        released = true;
        handlers.get(channel)?.delete(wrapped);
        const e = entries.get(key);
        if (!e) return;
        e.count -= 1;
        if (e.count <= 0) {
          entries.delete(key);
          rawSend({ method: "unsubscribe", subscription: e.sub });
        }
      };
    },

    getState: () => state,

    onState(listener) {
      stateListeners.add(listener);
      listener(state);
      return () => {
        stateListeners.delete(listener);
      };
    },

    subscriptionCount: () => entries.size,
  };
}

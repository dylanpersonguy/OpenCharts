/**
 * Tiny in-process channel event bus used by the demo backend.
 *
 * The demo wsClient (services/ws.ts) and the paper-trading engine publish
 * events here; MarketDataBridge subscribes through wsClient.subscribe(), which
 * is backed by this bus. Mirrors the real WebSocket pub/sub contract so no
 * consumer code had to change.
 */
export type ChannelHandler = (event: unknown) => void;

/**
 * Channels the demo backend publishes on.
 *
 * Deliberately distinct from the UI-facing channel names ("market-data",
 * "positions", ...) that services/ws.ts owns: the demo adapter subscribes to
 * these and the ws client republishes onto the UI channels, so sharing a name
 * makes an event loop straight back into itself.
 */
export const DEMO_CHANNELS = {
  ticks: "demo:ticks",
  positions: "demo:positions",
  orders: "demo:orders",
  account: "demo:account",
} as const;

const channels = new Map<string, Set<ChannelHandler>>();

export function subscribeChannel(channel: string, handler: ChannelHandler): () => void {
  let set = channels.get(channel);
  if (!set) {
    set = new Set();
    channels.set(channel, set);
  }
  set.add(handler);
  return () => {
    set?.delete(handler);
  };
}

export function publish(channel: string, event: unknown): void {
  const set = channels.get(channel);
  if (!set || set.size === 0) return;
  // Iterate a snapshot: handlers routinely unsubscribe (or subscribe) while
  // reacting to an event, and a throwing handler must not stop the fan-out to
  // the rest — one bad subscriber used to silently freeze the whole feed.
  for (const handler of [...set]) {
    try {
      handler(event);
    } catch (err) {
      console.error(`[bus] subscriber on "${channel}" threw`, err);
    }
  }
}

/** Test seam: drop every subscription. */
export function __resetBus(): void {
  channels.clear();
}

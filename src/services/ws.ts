/**
 * Demo WebSocket client.
 *
 * OpenCharts ships without a backend, so this replaces the real reconnecting
 * WebSocket with an in-process client backed by the demo event bus + feed
 * (services/demo). It exposes the same public surface the app already uses
 * (connect / subscribe / subscribeAccounts / onStateChange / state), so no
 * consumer (MarketDataBridge, ConnectionIndicator, store, …) had to change.
 */
import { publish, subscribeChannel, type ChannelHandler } from "./demo/bus.ts";
import { startDemoFeed } from "./demo/feed.ts";

export type ConnectionState = "connected" | "connecting" | "reconnecting" | "disconnected";
export type WsHandler = ChannelHandler;

class DemoWsClient {
  private _state: ConnectionState = "disconnected";
  private stateListeners = new Set<(s: ConnectionState) => void>();

  get state(): ConnectionState {
    return this._state;
  }

  private setState(next: ConnectionState): void {
    this._state = next;
    for (const cb of this.stateListeners) cb(next);
  }

  connect(_token?: string): void {
    this.setState("connecting");
    startDemoFeed();
    // Resolve to connected on the next tick so onStateChange subscribers
    // registered synchronously after connect() still receive the transition.
    setTimeout(() => this.setState("connected"), 0);
  }

  disconnect(): void {
    this.setState("disconnected");
  }

  reauthenticate(_token: string): void {
    // No auth in demo mode — nothing to refresh.
  }

  subscribe(channel: string, handler: WsHandler): () => void {
    return subscribeChannel(channel, handler);
  }

  subscribeAccounts(_accountIds: string[]): void {
    // All account events already flow through the "account" channel.
  }

  setSymbolInterest(_symbols: string[]): void {
    // The demo feed streams every symbol; nothing to gate.
  }

  onStateChange(cb: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(cb);
    cb(this._state);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  /** Allow the engine/feed to push events through the same client (parity helper). */
  emit(channel: string, event: unknown): void {
    publish(channel, event);
  }
}

export const wsClient = new DemoWsClient();

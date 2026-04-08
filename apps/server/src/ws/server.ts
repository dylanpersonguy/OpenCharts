import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { WsClientMessage, WsServerMessage, PartialBarUpdate } from '@opencharts/common';
import { WS_HEARTBEAT_INTERVAL } from '@opencharts/common';
import { redisSub, barChannel } from '../services/redis';

interface ClientState {
  ws: WebSocket;
  subscriptions: Set<string>; // "symbol:resolution" keys
  isAlive: boolean;
}

export class WsServer {
  private wss!: WebSocketServer;
  private clients = new Map<WebSocket, ClientState>();
  private channelClients = new Map<string, Set<WebSocket>>(); // channel → set of ws clients
  private heartbeatInterval?: NodeJS.Timeout;

  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      const state: ClientState = { ws, subscriptions: new Set(), isAlive: true };
      this.clients.set(ws, state);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as WsClientMessage;
          this.handleMessage(state, msg);
        } catch {
          this.send(ws, { type: 'error', message: 'Invalid message format' });
        }
      });

      ws.on('pong', () => {
        state.isAlive = true;
      });

      ws.on('close', () => {
        this.handleDisconnect(state);
      });

      ws.on('error', () => {
        this.handleDisconnect(state);
      });
    });

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((state, ws) => {
        if (!state.isAlive) {
          ws.terminate();
          this.handleDisconnect(state);
          return;
        }
        state.isAlive = false;
        this.send(ws, { type: 'ping' });
        ws.ping();
      });
    }, WS_HEARTBEAT_INTERVAL);

    // Subscribe to Redis for bar updates
    redisSub.on('message', (channel, message) => {
      const clients = this.channelClients.get(channel);
      if (!clients?.size) return;

      try {
        const update = JSON.parse(message) as PartialBarUpdate;
        const serverMsg: WsServerMessage = {
          type: 'bar_update',
          symbol: update.symbol,
          resolution: update.resolution,
          bar: update.bar,
          isClosed: update.isClosed,
        };
        const payload = JSON.stringify(serverMsg);

        clients.forEach((ws) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
          }
        });
      } catch (err) {
        console.error('Redis message parse error:', err);
      }
    });

    console.log('WebSocket server attached on /ws');
  }

  private handleMessage(state: ClientState, msg: WsClientMessage): void {
    switch (msg.type) {
      case 'subscribe':
        this.subscribe(state, msg.symbol, msg.resolution);
        break;
      case 'unsubscribe':
        this.unsubscribe(state, msg.symbol, msg.resolution);
        break;
      case 'pong':
        state.isAlive = true;
        break;
    }
  }

  private subscribe(state: ClientState, symbol: string, resolution: string): void {
    const channel = barChannel(symbol, resolution);
    const key = `${symbol}:${resolution}`;

    if (state.subscriptions.has(key)) return;
    state.subscriptions.add(key);

    // Track client on this channel
    if (!this.channelClients.has(channel)) {
      this.channelClients.set(channel, new Set());
      // First subscriber on this channel — subscribe to Redis
      redisSub.subscribe(channel).catch((err) => {
        console.error(`Redis subscribe error for ${channel}:`, err);
      });
    }
    this.channelClients.get(channel)!.add(state.ws);

    this.send(state.ws, { type: 'subscribed', symbol, resolution });
  }

  private unsubscribe(state: ClientState, symbol: string, resolution: string): void {
    const channel = barChannel(symbol, resolution);
    const key = `${symbol}:${resolution}`;

    state.subscriptions.delete(key);

    const clients = this.channelClients.get(channel);
    if (clients) {
      clients.delete(state.ws);
      if (clients.size === 0) {
        this.channelClients.delete(channel);
        redisSub.unsubscribe(channel).catch((err) => {
          console.error(`Redis unsubscribe error for ${channel}:`, err);
        });
      }
    }

    this.send(state.ws, { type: 'unsubscribed', symbol, resolution });
  }

  private handleDisconnect(state: ClientState): void {
    // Unsubscribe from all channels
    state.subscriptions.forEach((key) => {
      const [symbol, resolution] = key.split(':');
      const channel = barChannel(symbol, resolution);
      const clients = this.channelClients.get(channel);
      if (clients) {
        clients.delete(state.ws);
        if (clients.size === 0) {
          this.channelClients.delete(channel);
          redisSub.unsubscribe(channel).catch(() => {});
        }
      }
    });
    this.clients.delete(state.ws);
  }

  private send(ws: WebSocket, msg: WsServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  getStats(): { clients: number; channels: number } {
    return {
      clients: this.clients.size,
      channels: this.channelClients.size,
    };
  }

  shutdown(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.wss?.close();
  }
}

export const wsServer = new WsServer();

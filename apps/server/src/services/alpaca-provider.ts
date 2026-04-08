import Alpaca from '@alpacahq/alpaca-trade-api';
import type { MarketEvent } from '@opencharts/common';
import { marketDataPipeline } from './market-data-pipeline';
import { config } from '../config';

/**
 * AlpacaProvider: connects to Alpaca Markets for real-time US equities
 * and crypto data. Supports both IEX (free) and SIP (paid) data feeds.
 *
 * Requires ALPACA_KEY_ID and ALPACA_SECRET_KEY environment variables.
 *
 * Sign up at https://alpaca.markets for free API keys.
 */

export interface AlpacaProviderConfig {
  keyId: string;
  secretKey: string;
  /** Use paper trading endpoint (default: true) */
  paper?: boolean;
  /** Data feed: 'iex' (free, 15-min delayed for some) or 'sip' (paid, real-time) */
  feed?: 'iex' | 'sip';
  /** Stock symbols to subscribe to (e.g. ['AAPL', 'MSFT', 'TSLA']) */
  stockSymbols?: string[];
  /** Crypto symbols to subscribe to (e.g. ['BTC/USD', 'ETH/USD']) */
  cryptoSymbols?: string[];
}

export class AlpacaProvider {
  private alpaca: Alpaca;
  private config: AlpacaProviderConfig;
  private dataStream: ReturnType<Alpaca['data_stream_v2']> | null = null;
  private cryptoStream: ReturnType<Alpaca['data_stream_v2']> | null = null;
  private running = false;

  constructor(providerConfig: AlpacaProviderConfig) {
    this.config = providerConfig;
    this.alpaca = new Alpaca({
      keyId: providerConfig.keyId,
      secretKey: providerConfig.secretKey,
      paper: providerConfig.paper ?? true,
    });
  }

  /**
   * Start streaming real-time stock trades via WebSocket.
   */
  async startStockStream(): Promise<void> {
    if (!this.config.stockSymbols?.length) return;
    this.running = true;

    this.dataStream = this.alpaca.data_stream_v2({
      feed: this.config.feed || 'iex',
    });

    this.dataStream.onConnect(() => {
      console.log(`[Alpaca] Stock stream connected (${this.config.feed || 'iex'} feed)`);
      this.dataStream!.subscribeForTrades(this.config.stockSymbols!);
    });

    this.dataStream.onStockTrade((trade: { S: string; p: number; s: number; t: string }) => {
      const event: MarketEvent = {
        type: 'trade',
        symbol: trade.S,
        timestamp: new Date(trade.t).getTime(),
        price: trade.p,
        volume: trade.s,
        provider: 'alpaca',
      };
      marketDataPipeline.onMarketEvent(event).catch((err) => {
        console.error('[Alpaca] Pipeline error:', err);
      });
    });

    this.dataStream.onDisconnect(() => {
      console.log('[Alpaca] Stock stream disconnected');
      if (this.running) {
        console.log('[Alpaca] Reconnecting stock stream...');
        setTimeout(() => this.dataStream?.connect(), 5000);
      }
    });

    this.dataStream.onError((err: Error) => {
      console.error('[Alpaca] Stock stream error:', err.message);
    });

    this.dataStream.connect();
    console.log(`[Alpaca] Subscribing to stock trades: ${this.config.stockSymbols.join(', ')}`);
  }

  /**
   * Start streaming real-time crypto trades via WebSocket.
   */
  async startCryptoStream(): Promise<void> {
    if (!this.config.cryptoSymbols?.length) return;
    this.running = true;

    this.cryptoStream = this.alpaca.data_stream_v2({
      feed: 'us',
    });

    this.cryptoStream.onConnect(() => {
      console.log('[Alpaca] Crypto stream connected');
      // Alpaca crypto symbols use format like 'BTC/USD'
      this.cryptoStream!.subscribeForTrades(this.config.cryptoSymbols!);
    });

    this.cryptoStream.onCryptoTrade((trade: { S: string; p: number; s: number; t: string }) => {
      const event: MarketEvent = {
        type: 'trade',
        symbol: trade.S,
        timestamp: new Date(trade.t).getTime(),
        price: trade.p,
        volume: trade.s,
        provider: 'alpaca-crypto',
      };
      marketDataPipeline.onMarketEvent(event).catch((err) => {
        console.error('[Alpaca] Crypto pipeline error:', err);
      });
    });

    this.cryptoStream.onDisconnect(() => {
      console.log('[Alpaca] Crypto stream disconnected');
      if (this.running) {
        setTimeout(() => this.cryptoStream?.connect(), 5000);
      }
    });

    this.cryptoStream.onError((err: Error) => {
      console.error('[Alpaca] Crypto stream error:', err.message);
    });

    this.cryptoStream.connect();
    console.log(`[Alpaca] Subscribing to crypto trades: ${this.config.cryptoSymbols.join(', ')}`);
  }

  /**
   * Fetch historical bars from Alpaca for a stock symbol.
   */
  async fetchHistoricalBars(
    symbol: string,
    timeframe: string = '1Day',
    start?: string,
    end?: string,
    limit: number = 500,
  ): Promise<{ time: number; open: number; high: number; low: number; close: number; volume: number }[]> {
    const params: Record<string, unknown> = {
      timeframe,
      limit,
    };
    if (start) params.start = start;
    if (end) params.end = end;

    const resp = await this.alpaca.getBars(symbol, params);
    return resp.map((bar: { Timestamp: string; OpenPrice: number; HighPrice: number; LowPrice: number; ClosePrice: number; Volume: number }) => ({
      time: Math.floor(new Date(bar.Timestamp).getTime() / 1000),
      open: bar.OpenPrice,
      high: bar.HighPrice,
      low: bar.LowPrice,
      close: bar.ClosePrice,
      volume: bar.Volume,
    }));
  }

  /**
   * Start all configured streams.
   */
  async start(): Promise<void> {
    await Promise.all([
      this.startStockStream(),
      this.startCryptoStream(),
    ]);
  }

  stop(): void {
    this.running = false;
    this.dataStream?.disconnect();
    this.cryptoStream?.disconnect();
    this.dataStream = null;
    this.cryptoStream = null;
    console.log('[Alpaca] Provider stopped');
  }
}

/** Create Alpaca provider from environment config (if keys are set) */
export function createAlpacaProvider(): AlpacaProvider | null {
  if (!config.alpaca.keyId || !config.alpaca.secretKey) {
    return null;
  }

  return new AlpacaProvider({
    keyId: config.alpaca.keyId,
    secretKey: config.alpaca.secretKey,
    paper: config.alpaca.paper,
    feed: config.alpaca.dataFeed,
    stockSymbols: ['AAPL', 'MSFT', 'TSLA', 'GOOGL', 'AMZN', 'NVDA', 'META'],
    cryptoSymbols: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
  });
}

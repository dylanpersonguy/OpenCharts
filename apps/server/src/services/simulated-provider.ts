import type { MarketEvent } from '@opencharts/common';
import { marketDataPipeline } from './market-data-pipeline';

/**
 * SimulatedProvider: generates fake market data for development and testing.
 * In production, replace with real provider adapters (Binance, Polygon, etc.)
 */
export class SimulatedProvider {
  private intervals: NodeJS.Timeout[] = [];
  private prices: Map<string, number> = new Map();

  private symbolConfigs = [
    { symbol: 'BTC/USD', basePrice: 67000, volatility: 50 },
    { symbol: 'ETH/USD', basePrice: 3500, volatility: 5 },
    { symbol: 'SOL/USD', basePrice: 145, volatility: 1 },
    { symbol: 'EUR/USD', basePrice: 1.085, volatility: 0.0005 },
    { symbol: 'GBP/USD', basePrice: 1.265, volatility: 0.0005 },
    { symbol: 'AAPL', basePrice: 190, volatility: 0.5 },
    { symbol: 'MSFT', basePrice: 420, volatility: 1 },
    { symbol: 'TSLA', basePrice: 175, volatility: 2 },
  ];

  start(intervalMs: number = 1000): void {
    // Initialize prices
    for (const cfg of this.symbolConfigs) {
      this.prices.set(cfg.symbol, cfg.basePrice);
    }

    const interval = setInterval(() => {
      for (const cfg of this.symbolConfigs) {
        const currentPrice = this.prices.get(cfg.symbol) ?? cfg.basePrice;
        const change = (Math.random() - 0.48) * cfg.volatility;
        const newPrice = Math.max(currentPrice + change, currentPrice * 0.5);
        this.prices.set(cfg.symbol, newPrice);

        const event: MarketEvent = {
          type: 'trade',
          symbol: cfg.symbol,
          timestamp: Date.now(),
          price: parseFloat(newPrice.toFixed(6)),
          volume: Math.floor(Math.random() * 100 + 1),
          provider: 'simulated',
        };

        marketDataPipeline.onMarketEvent(event).catch((err) => {
          console.error('Pipeline error:', err);
        });
      }
    }, intervalMs);

    this.intervals.push(interval);
    console.log(`SimulatedProvider started (${this.symbolConfigs.length} symbols, ${intervalMs}ms interval)`);
  }

  stop(): void {
    this.intervals.forEach(clearInterval);
    this.intervals = [];
    console.log('SimulatedProvider stopped');
  }
}

export const simulatedProvider = new SimulatedProvider();

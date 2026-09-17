import type {
  CandleRequest,
  ConnectionState,
  MarketDataSource,
  MarketEvent,
  OpenChartsAdapter,
  Quote,
  Unsubscribe,
} from "../../src/adapter/types.ts";
import type { Candle, Symbol } from "../../src/services/schemas.ts";

/**
 * A live market-data adapter for Binance's public API.
 *
 * This exists to show that the OpenCharts adapter contract is implementable
 * against a real backend, in one file, with no changes to the terminal. It
 * needs no API key: klines and book tickers are public endpoints.
 *
 * Market data is live. Trading is whatever you compose with it — see
 * `createBinancePaperAdapter()` below, which pairs this feed with the bundled
 * paper-trading engine so you can trade live prices without risking anything.
 *
 * Caveats worth knowing before you ship this:
 *   - Binance restricts access from some jurisdictions, and rate-limits by IP.
 *   - Ticks are best bid/ask (`@bookTicker`), not trades.
 *   - Symbols are hardcoded below; a production adapter would read
 *     `/api/v3/exchangeInfo` and derive tick sizes from the filters.
 */

const REST_BASE = "https://api.binance.com/api/v3";
const WS_BASE = "wss://stream.binance.com:9443/stream";

/** Display name → Binance pair. USD here means USDT on Binance. */
const SYMBOL_MAP: Record<string, { pair: string; label: string; tickSize: number }> = {
  BTCUSD: { pair: "BTCUSDT", label: "Bitcoin", tickSize: 0.01 },
  ETHUSD: { pair: "ETHUSDT", label: "Ethereum", tickSize: 0.01 },
  SOLUSD: { pair: "SOLUSDT", label: "Solana", tickSize: 0.01 },
  BNBUSD: { pair: "BNBUSDT", label: "BNB", tickSize: 0.01 },
  XRPUSD: { pair: "XRPUSDT", label: "XRP", tickSize: 0.0001 },
  ADAUSD: { pair: "ADAUSDT", label: "Cardano", tickSize: 0.0001 },
};

const PAIR_TO_SYMBOL = new Map(
  Object.entries(SYMBOL_MAP).map(([symbol, { pair }]) => [pair, symbol]),
);

/** OpenCharts timeframes happen to match Binance's interval strings. */
const INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]);

// ── Pure helpers (exported for tests) ─────────────────────

export function toBinancePair(symbol: string): string | null {
  return SYMBOL_MAP[symbol]?.pair ?? null;
}

export function fromBinancePair(pair: string): string | null {
  return PAIR_TO_SYMBOL.get(pair.toUpperCase()) ?? null;
}

export type BinanceKline = [
  openTime: number,
  open: string,
  high: string,
  low: string,
  close: string,
  volume: string,
  ...rest: unknown[],
];

/**
 * Binance sends prices as strings and times in milliseconds; OpenCharts wants
 * numbers and seconds.
 */
export function klineToCandle(kline: BinanceKline): Candle {
  return {
    time: Math.floor(kline[0] / 1000),
    open: Number(kline[1]),
    high: Number(kline[2]),
    low: Number(kline[3]),
    close: Number(kline[4]),
    volume: Number(kline[5]),
  };
}

export function buildKlineUrl(request: CandleRequest): string | null {
  const pair = toBinancePair(request.symbol);
  if (!pair || !INTERVALS.has(request.timeframe)) return null;

  const params = new URLSearchParams({ symbol: pair, interval: request.timeframe });
  // Binance caps at 1000 bars per call.
  params.set("limit", String(Math.min(1000, Math.max(1, Math.floor(request.limit ?? 500)))));
  if (request.fromMs != null) params.set("startTime", String(Math.floor(request.fromMs)));
  // `toMs` is exclusive in the OpenCharts contract but Binance's `endTime` is
  // inclusive, so the boundary bar would come back twice while the chart pages
  // backwards. Step back a millisecond.
  if (request.toMs != null) params.set("endTime", String(Math.floor(request.toMs) - 1));
  return `${REST_BASE}/klines?${params.toString()}`;
}

export function buildStreamUrl(symbols: readonly string[]): string {
  const streams = symbols
    .map((s) => toBinancePair(s))
    .filter((pair): pair is string => pair !== null)
    .map((pair) => `${pair.toLowerCase()}@bookTicker`)
    .join("/");
  return `${WS_BASE}?streams=${streams}`;
}

function symbolSpec(name: string, tickSize: number, label: string): Symbol {
  return {
    id: name,
    name,
    displayName: label,
    category: "CRYPTO",
    contractSize: 1,
    tickSize,
    tickValue: tickSize,
    marginPercent: 1,
    maxLeverage: 100,
    commission: 0,
    swapLong: 0,
    swapShort: 0,
    tradingHoursStart: null,
    tradingHoursEnd: null,
    isActive: true,
  } as Symbol;
}

export interface BinanceOptions {
  /** Restrict to a subset of the symbols above. */
  symbols?: string[];
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected in tests; defaults to the global WebSocket. */
  webSocketImpl?: typeof WebSocket;
}

export function createBinanceMarketData(options: BinanceOptions = {}): MarketDataSource {
  const names = options.symbols?.filter((s) => s in SYMBOL_MAP) ?? Object.keys(SYMBOL_MAP);
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const SocketImpl = options.webSocketImpl ?? globalThis.WebSocket;

  const handlers = new Set<(event: MarketEvent) => void>();
  const stateListeners = new Set<(state: ConnectionState) => void>();
  let socket: WebSocket | null = null;
  let state: ConnectionState = "disconnected";
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByUs = false;

  const setState = (next: ConnectionState) => {
    if (state === next) return;
    state = next;
    for (const listener of [...stateListeners]) {
      try {
        listener(next);
      } catch (err) {
        console.error("[binance] connection listener threw", err);
      }
    }
  };

  const emit = (event: MarketEvent) => {
    for (const handler of [...handlers]) {
      try {
        handler(event);
      } catch (err) {
        console.error("[binance] subscriber threw", err);
      }
    }
  };

  const open = () => {
    if (socket || names.length === 0) return;
    closedByUs = false;
    setState(reconnectAttempt === 0 ? "connecting" : "reconnecting");

    socket = new SocketImpl(buildStreamUrl(names));

    socket.onopen = () => {
      reconnectAttempt = 0;
      setState("connected");
    };

    socket.onmessage = (message: MessageEvent) => {
      try {
        const payload = JSON.parse(String(message.data)) as {
          data?: { s?: string; b?: string; a?: string };
        };
        const data = payload.data;
        if (!data?.s || data.b == null || data.a == null) return;
        const symbol = fromBinancePair(data.s);
        if (!symbol) return;
        emit({
          type: "tick",
          symbol,
          bid: Number(data.b),
          ask: Number(data.a),
          timestamp: Date.now(),
        });
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };

    socket.onclose = () => {
      socket = null;
      if (closedByUs) {
        setState("disconnected");
        return;
      }
      // Exponential backoff, capped — Binance drops idle sockets every 24h and
      // rate-limits reconnect storms.
      setState("reconnecting");
      const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(open, delay);
    };

    socket.onerror = () => {
      // `onclose` always follows, which is where reconnection is handled.
    };
  };

  return {
    getSymbols: () =>
      Promise.resolve(
        names.map((name) => {
          const spec = SYMBOL_MAP[name]!;
          return symbolSpec(name, spec.tickSize, spec.label);
        }),
      ),

    getCandles: async (request: CandleRequest): Promise<Candle[]> => {
      const url = buildKlineUrl(request);
      if (!url) return [];
      const response = await doFetch(url);
      if (!response.ok) {
        throw new Error(`Binance klines failed: ${response.status} ${response.statusText}`);
      }
      const rows = (await response.json()) as BinanceKline[];
      if (!Array.isArray(rows)) return [];
      return rows.map(klineToCandle).filter((c) => Number.isFinite(c.close));
    },

    getQuote: async (symbol: string): Promise<Quote | null> => {
      const pair = toBinancePair(symbol);
      if (!pair) return null;
      const response = await doFetch(`${REST_BASE}/ticker/bookTicker?symbol=${pair}`);
      if (!response.ok) return null;
      const data = (await response.json()) as { bidPrice?: string; askPrice?: string };
      if (data.bidPrice == null || data.askPrice == null) return null;
      return {
        symbol,
        bid: Number(data.bidPrice),
        ask: Number(data.askPrice),
        timestamp: Date.now(),
      };
    },

    subscribe: (handler: (event: MarketEvent) => void): Unsubscribe => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    connect: () => open(),

    disconnect: () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      socket?.close();
      socket = null;
      setState("disconnected");
    },

    getConnectionState: () => state,

    onConnectionChange: (listener) => {
      stateListeners.add(listener);
      listener(state);
      return () => {
        stateListeners.delete(listener);
      };
    },
  };
}

/**
 * Live Binance prices with the bundled paper-trading engine behind them.
 *
 * The engine needs to be told the price to mark positions and trigger resting
 * orders, so each incoming tick is forwarded to it — which is exactly the
 * composition you would write when pairing a real feed with your own
 * execution.
 */
export async function createBinancePaperAdapter(
  options: BinanceOptions = {},
): Promise<OpenChartsAdapter> {
  const [{ createDemoAdapter }, engine] = await Promise.all([
    import("../../src/adapter/demo.ts"),
    import("../../src/services/demo/engine.ts"),
  ]);

  const marketData = createBinanceMarketData(options);
  const paper = createDemoAdapter();

  marketData.subscribe((event) => {
    if (event.type !== "tick") return;
    engine.mark(event.symbol, (event.bid + event.ask) / 2);
  });

  return {
    name: "binance-paper",
    marketData,
    trading: paper.trading,
    storage: paper.storage,
  };
}

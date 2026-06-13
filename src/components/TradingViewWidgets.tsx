/* eslint-disable react-refresh/only-export-components */
/**
 * TradingView Supplementary Embed Widgets
 *
 * These use TradingView's external embed scripts for supplementary market info
 * (ticker tape, technical analysis gauge, economic calendar, mini chart).
 * They intentionally show real-time market data from TradingView as
 * contextual reference — they are NOT the main chart.
 */
import { useEffect, useRef, memo } from "react";

// TradingView's async embed scripts restructure the DOM (e.g. create iframes,
// move nodes) after we append them.  When deps change or the component unmounts
// our cleanup tries container.innerHTML = "" which internally calls removeChild
// on nodes that TradingView has already moved — throwing a DOM exception that
// React 18 propagates to the nearest ErrorBoundary.  Wrapping the clear in
// try/catch prevents the exception from escaping the effect cleanup.
export function safeClear(container: HTMLDivElement) {
  try {
    container.innerHTML = "";
  } catch (err) {
    // TradingView's async embed scripts move/reparent DOM nodes after appending,
    // so removeChild (called internally by innerHTML="") throws HierarchyRequestError
    // or NotFoundError when the node is no longer a child. Swallow those specific
    // DOM exceptions only — let anything else (SecurityError, etc.) propagate so
    // real errors surface to the React ErrorBoundary and developer console.
    if (!(err instanceof DOMException)) throw err;
  }
}

// ── Symbol mapping: platform symbols → TradingView symbols ──
const TV_SYMBOL_MAP: Record<string, string> = {
  EURUSD: "FX:EURUSD",
  GBPUSD: "FX:GBPUSD",
  USDJPY: "FX:USDJPY",
  USDCHF: "FX:USDCHF",
  AUDUSD: "FX:AUDUSD",
  NZDUSD: "FX:NZDUSD",
  USDCAD: "FX:USDCAD",
  EURGBP: "FX:EURGBP",
  EURJPY: "FX:EURJPY",
  GBPJPY: "FX:GBPJPY",
  EURCHF: "FX:EURCHF",
  EURAUD: "FX:EURAUD",
  AUDNZD: "FX:AUDNZD",
  AUDCAD: "FX:AUDCAD",
  AUDCHF: "FX:AUDCHF",
  AUDJPY: "FX:AUDJPY",
  CADJPY: "FX:CADJPY",
  CHFJPY: "FX:CHFJPY",
  NZDJPY: "FX:NZDJPY",
  GBPCHF: "FX:GBPCHF",
  GBPCAD: "FX:GBPCAD",
  GBPAUD: "FX:GBPAUD",
  GBPNZD: "FX:GBPNZD",
  EURNZD: "FX:EURNZD",
  EURCAD: "FX:EURCAD",
  NZDCAD: "FX:NZDCAD",
  CADCHF: "FX:CADCHF",
  NZDCHF: "FX:NZDCHF",
  XAUUSD: "TVC:GOLD",
  XAGUSD: "TVC:SILVER",
  US30: "TVC:DJI",
  SPX500: "FOREXCOM:SPXUSD",
  NAS100: "NASDAQ:NDX",
  DAX40: "XETR:DAX",
  UK100: "TVC:UKX",
  JP225: "TVC:NI225",
  BTCUSD: "COINBASE:BTCUSD",
  ETHUSD: "COINBASE:ETHUSD",
  XTIUSD: "TVC:USOIL",
  XBRUSD: "TVC:UKOIL",
  USOIL: "TVC:USOIL",
  UKOIL: "TVC:UKOIL",
  // CME equity index futures (front-month continuous contracts)
  ES: "CME_MINI:ES1!",
  MES: "CME_MINI:MES1!",
  NQ: "CME_MINI:NQ1!",
  MNQ: "CME_MINI:MNQ1!",
  RTY: "CME_MINI:RTY1!",
  M2K: "CME_MINI:M2K1!",
  YM: "CBOT_MINI:YM1!",
  MYM: "CBOT_MINI:MYM1!",
  // NYMEX / COMEX commodity futures
  CL: "NYMEX:CL1!",
  MCL: "NYMEX:MCL1!",
  GC: "COMEX:GC1!",
  MGC: "COMEX:MGC1!",
  // CBOT treasury futures
  ZB: "CBOT:ZB1!",
  // CME FX futures
  "6E": "CME:6E1!",
};

// TechnicalAnalysis widget uses TV's text interval identifiers (1h, 4h, 1D…),
// not the numeric ones used by the Advanced Chart widget (60, 240, D…).
const TV_TECHNICAL_INTERVAL_MAP: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1D",
  "1w": "1W",
};

function mapSymbol(symbol: string): string {
  if (TV_SYMBOL_MAP[symbol]) return TV_SYMBOL_MAP[symbol];
  if (/^[A-Z]{6}$/.test(symbol)) return `FX:${symbol}`;
  return symbol;
}

// ── Ticker Tape Widget ───────────────────────────────────────
interface TradingViewTickerTapeProps {
  symbols?: { proName: string; title: string }[];
  theme: "dark" | "light";
  className?: string;
}

const TICKER_TAPE_DEFAULT_SYMBOLS = [
  { proName: "FX:EURUSD", title: "EUR/USD" },
  { proName: "FX:GBPUSD", title: "GBP/USD" },
  { proName: "FX:USDJPY", title: "USD/JPY" },
  { proName: "TVC:GOLD", title: "Gold" },
  { proName: "COINBASE:BTCUSD", title: "BTC/USD" },
  { proName: "TVC:DJI", title: "Dow 30" },
  { proName: "NASDAQ:NDX", title: "Nasdaq" },
  { proName: "TVC:USOIL", title: "US Oil" },
];

export const TradingViewTickerTape = memo(function TradingViewTickerTape({
  symbols,
  theme,
  className = "",
}: TradingViewTickerTapeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    safeClear(container);

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    container.appendChild(widgetDiv);

    const config = {
      symbols: symbols ?? TICKER_TAPE_DEFAULT_SYMBOLS,
      showSymbolLogo: true,
      isTransparent: true,
      displayMode: "adaptive",
      colorTheme: theme,
      locale: "en",
    };

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
    script.type = "text/javascript";
    script.async = true;
    script.textContent = JSON.stringify(config);
    container.appendChild(script);

    return () => {
      safeClear(container);
    };
  }, [symbols, theme]);

  return <div ref={containerRef} className={`tradingview-widget-container ${className}`} />;
});

// ── Technical Analysis Widget ────────────────────────────────
interface TradingViewTechnicalAnalysisProps {
  symbol: string;
  theme: "dark" | "light";
  interval?: string;
  width?: string | number;
  height?: string | number;
  className?: string;
}

export const TradingViewTechnicalAnalysis = memo(function TradingViewTechnicalAnalysis({
  symbol,
  theme,
  interval = "1h",
  width = "100%",
  height = 400,
  className = "",
}: TradingViewTechnicalAnalysisProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    safeClear(container);

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.height = "100%";
    widgetDiv.style.width = "100%";
    container.appendChild(widgetDiv);

    const config = {
      interval: TV_TECHNICAL_INTERVAL_MAP[interval] ?? "1h",
      width: typeof width === "number" ? width : "100%",
      height: typeof height === "number" ? height : "100%",
      isTransparent: true,
      symbol: mapSymbol(symbol),
      showIntervalTabs: true,
      displayMode: "single",
      locale: "en",
      colorTheme: theme,
    };

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js";
    script.type = "text/javascript";
    script.async = true;
    script.textContent = JSON.stringify(config);
    container.appendChild(script);

    return () => {
      safeClear(container);
    };
  }, [symbol, theme, interval, width, height]);

  return (
    <div
      ref={containerRef}
      className={`tradingview-widget-container ${className}`}
      style={{
        height: typeof height === "number" ? `${height}px` : height,
        width: typeof width === "number" ? `${width}px` : width,
      }}
    />
  );
});

// ── Economic Calendar Widget ─────────────────────────────────
interface TradingViewEconomicCalendarProps {
  theme: "dark" | "light";
  width?: string | number;
  height?: string | number;
  className?: string;
}

export const TradingViewEconomicCalendar = memo(function TradingViewEconomicCalendar({
  theme,
  width = "100%",
  height = 400,
  className = "",
}: TradingViewEconomicCalendarProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    safeClear(container);

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.height = "100%";
    widgetDiv.style.width = "100%";
    container.appendChild(widgetDiv);

    const config = {
      width: typeof width === "number" ? width : "100%",
      height: typeof height === "number" ? height : "100%",
      colorTheme: theme,
      isTransparent: true,
      locale: "en",
      importanceFilter: "-1,0,1",
      countryFilter: "ar,au,br,ca,cn,fr,de,in,id,it,jp,kr,mx,ru,sa,za,tr,gb,us,eu",
    };

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-events.js";
    script.type = "text/javascript";
    script.async = true;
    script.textContent = JSON.stringify(config);
    container.appendChild(script);

    return () => {
      safeClear(container);
    };
  }, [theme, width, height]);

  return (
    <div
      ref={containerRef}
      className={`tradingview-widget-container ${className}`}
      style={{
        height: typeof height === "number" ? `${height}px` : height,
        width: typeof width === "number" ? `${width}px` : width,
      }}
    />
  );
});

// ── Mini Chart Widget ────────────────────────────────────────
interface TradingViewMiniChartProps {
  symbol: string;
  theme: "dark" | "light";
  width?: string | number;
  height?: string | number;
  className?: string;
}

export const TradingViewMiniChart = memo(function TradingViewMiniChart({
  symbol,
  theme,
  width = "100%",
  height = 220,
  className = "",
}: TradingViewMiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    safeClear(container);

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.height = "100%";
    widgetDiv.style.width = "100%";
    container.appendChild(widgetDiv);

    const config = {
      symbol: mapSymbol(symbol),
      width: typeof width === "number" ? width : "100%",
      height: typeof height === "number" ? height : "100%",
      locale: "en",
      dateRange: "1D",
      colorTheme: theme,
      isTransparent: true,
      autosize: typeof width === "string" && typeof height === "string",
      largeChartUrl: "",
    };

    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js";
    script.type = "text/javascript";
    script.async = true;
    script.textContent = JSON.stringify(config);
    container.appendChild(script);

    return () => {
      safeClear(container);
    };
  }, [symbol, theme, width, height]);

  return (
    <div
      ref={containerRef}
      className={`tradingview-widget-container ${className}`}
      style={{
        height: typeof height === "number" ? `${height}px` : height,
        width: typeof width === "number" ? `${width}px` : width,
      }}
    />
  );
});

export { mapSymbol, TV_SYMBOL_MAP };

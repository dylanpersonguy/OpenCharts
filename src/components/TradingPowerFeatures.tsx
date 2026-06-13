/**
 * Trading Power Features (#53-60)
 * - PriceAlertManager (#53)
 * - MarketSentimentGauge (#54)
 * - MultiSymbolComparison (#55)
 * - TradeSignals (#56)
 * - RiskOverlay (#58)
 * - PnlHeatmap (#59)
 * - NewsFeed (#60)
 */
import { useState, useMemo } from "react";
import {
  Bell,
  BellOff,
  Activity,
  BarChart3,
  Shield,
  Flame,
  Clock,
  Globe,
  AlertTriangle,
  Plus,
  X,
  ChevronUp,
  ChevronDown,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatCurrency } from "@/lib/utils";

// ── Price Alert Manager (#53) ────────────────────────────────
interface PriceAlert {
  id: string;
  symbol: string;
  condition: "above" | "below";
  price: number;
  active: boolean;
  createdAt: number;
}

export function PriceAlertManager({ symbol }: { symbol: string }) {
  const [alerts, setAlerts] = useState<PriceAlert[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("price_alerts") || "[]");
    } catch {
      return [];
    }
  });
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState<"above" | "below">("above");
  const [isOpen, setIsOpen] = useState(false);

  function saveAlerts(newAlerts: PriceAlert[]) {
    setAlerts(newAlerts);
    localStorage.setItem("price_alerts", JSON.stringify(newAlerts));
  }

  function addAlert() {
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0) return;
    const alert: PriceAlert = {
      id: Date.now().toString(),
      symbol,
      condition,
      price: p,
      active: true,
      createdAt: Date.now(),
    };
    saveAlerts([...alerts, alert]);
    setPrice("");
  }

  function removeAlert(id: string) {
    saveAlerts(alerts.filter((a) => a.id !== id));
  }

  function toggleAlert(id: string) {
    saveAlerts(alerts.map((a) => (a.id === id ? { ...a, active: !a.active } : a)));
  }

  const symbolAlerts = alerts.filter((a) => a.symbol === symbol);
  const otherAlerts = alerts.filter((a) => a.symbol !== symbol);

  return (
    <Card>
      <CardHeader className="p-3 pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bell className="h-4 w-4 text-accent" /> Price Alerts
          </CardTitle>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setIsOpen(!isOpen)}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-2 space-y-2">
        {isOpen && (
          <div className="flex gap-1.5 items-center">
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as "above" | "below")}
              className="bg-input border border-border rounded px-2 py-1 text-xs"
            >
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Price"
              step="0.0001"
              className="flex-1 bg-input border border-border rounded px-2 py-1 text-xs"
            />
            <Button size="sm" className="h-7 text-xs" onClick={addAlert}>
              Set
            </Button>
          </div>
        )}
        {symbolAlerts.length === 0 && !isOpen ? (
          <p className="text-xs text-muted-foreground text-center py-2">No alerts for {symbol}</p>
        ) : (
          symbolAlerts.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between text-xs py-1 border-b border-border/30"
            >
              <div className="flex items-center gap-1.5">
                <span className={a.condition === "above" ? "text-green-500" : "text-red-500"}>
                  {a.condition === "above" ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </span>
                <span className="font-medium">{a.price.toFixed(5)}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => toggleAlert(a.id)} className="p-0.5 hover:text-accent">
                  {a.active ? (
                    <Bell className="h-3 w-3" />
                  ) : (
                    <BellOff className="h-3 w-3 text-muted-foreground" />
                  )}
                </button>
                <button onClick={() => removeAlert(a.id)} className="p-0.5 hover:text-red-500">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))
        )}
        {otherAlerts.length > 0 && (
          <p className="text-[10px] text-muted-foreground text-center pt-1">
            {otherAlerts.length} alert(s) on other symbols
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Market Sentiment Gauge (#54) ─────────────────────────────
export function MarketSentimentGauge({ symbol }: { symbol: string }) {
  // Deterministic pseudo-sentiment from symbol name
  const sentiment = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) hash = (hash * 31 + symbol.charCodeAt(i)) % 100;
    return hash;
  }, [symbol]);

  const buyPct = Math.max(20, Math.min(80, sentiment));
  const sellPct = 100 - buyPct;
  const label = buyPct > 60 ? "Bullish" : buyPct < 40 ? "Bearish" : "Neutral";
  const labelColor =
    buyPct > 60 ? "text-green-500" : buyPct < 40 ? "text-red-500" : "text-yellow-500";

  return (
    <Card>
      <CardHeader className="p-3 pb-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-accent" /> Sentiment
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-2">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-green-500 font-medium">{buyPct}% Buy</span>
          <span className={cn("font-medium", labelColor)}>{label}</span>
          <span className="text-red-500 font-medium">{sellPct}% Sell</span>
        </div>
        <div className="h-2.5 bg-red-500/30 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all"
            style={{ width: `${buyPct}%` }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          {[
            { label: "Retail", buy: Math.max(15, buyPct - 10) },
            { label: "Institutional", buy: Math.min(85, buyPct + 5) },
            { label: "Algo", buy: Math.max(25, buyPct - 5) },
          ].map((g) => (
            <div key={g.label} className="text-center">
              <p className="text-[10px] text-muted-foreground">{g.label}</p>
              <p
                className={cn(
                  "text-xs font-medium",
                  g.buy > 50 ? "text-green-500" : "text-red-500",
                )}
              >
                {g.buy}% B
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Multi-Symbol Comparison (#55) ─────────────────────────────
interface SymbolPerf {
  symbol: string;
  change: number;
  range: [number, number];
  current: number;
}

export function MultiSymbolComparison({
  symbols = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD"],
}: {
  symbols?: string[];
}) {
  const data: SymbolPerf[] = useMemo(
    () =>
      symbols.map((s) => {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000;
        const change = ((h % 200) - 100) / 100;
        return {
          symbol: s,
          change,
          range: [-(Math.abs(change) + 0.5), Math.abs(change) + 0.5],
          current: change,
        };
      }),
    [symbols],
  );

  return (
    <Card>
      <CardHeader className="p-3 pb-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-accent" /> Symbol Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-2 space-y-2">
        {data.map((d) => (
          <div key={d.symbol} className="flex items-center gap-2">
            <span className="text-xs font-medium w-16 truncate">{d.symbol}</span>
            <div className="flex-1 h-4 relative">
              <div className="absolute inset-0 bg-muted rounded" />
              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
              <div
                className={cn(
                  "absolute top-0.5 bottom-0.5 rounded",
                  d.change >= 0 ? "bg-green-500" : "bg-red-500",
                )}
                style={{
                  left: d.change >= 0 ? "50%" : `${50 + d.change * 25}%`,
                  width: `${Math.abs(d.change) * 25}%`,
                }}
              />
            </div>
            <span
              className={cn(
                "text-xs font-medium w-12 text-right",
                d.change >= 0 ? "text-green-500" : "text-red-500",
              )}
            >
              {d.change >= 0 ? "+" : ""}
              {(d.change * 100).toFixed(0)}bp
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Trade Signals (#56) ──────────────────────────────────────
export function TradeSignals({ symbol }: { symbol: string }) {
  const signals = useMemo(() => {
    const indicators = ["RSI", "MACD", "Bollinger", "SMA 20/50", "EMA Cross", "Stochastic", "VWAP"];
    return indicators.map((name) => {
      let h = 0;
      const s = name + symbol;
      for (let i = 0; i < s.length; i++) h = (h * 37 + s.charCodeAt(i)) % 100;
      const signal: "BUY" | "SELL" | "NEUTRAL" = h > 60 ? "BUY" : h < 40 ? "SELL" : "NEUTRAL";
      const strength = Math.abs(h - 50) / 50;
      return { name, signal, strength };
    });
  }, [symbol]);

  const buyCount = signals.filter((s) => s.signal === "BUY").length;
  const sellCount = signals.filter((s) => s.signal === "SELL").length;
  const overall =
    buyCount > sellCount + 1
      ? "STRONG BUY"
      : buyCount > sellCount
        ? "BUY"
        : sellCount > buyCount + 1
          ? "STRONG SELL"
          : sellCount > buyCount
            ? "SELL"
            : "NEUTRAL";

  return (
    <Card>
      <CardHeader className="p-3 pb-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="h-4 w-4 text-accent" /> Signals
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-2">
        <div
          className={cn(
            "text-center py-2 rounded-lg mb-2",
            overall.includes("BUY")
              ? "bg-green-500/10 text-green-500"
              : overall.includes("SELL")
                ? "bg-red-500/10 text-red-500"
                : "bg-yellow-500/10 text-yellow-500",
          )}
        >
          <p className="text-xs text-muted-foreground">Overall</p>
          <p className="text-sm font-bold">{overall}</p>
        </div>
        <div className="space-y-1">
          {signals.map((s) => (
            <div key={s.name} className="flex items-center justify-between text-xs py-0.5">
              <span className="text-muted-foreground">{s.name}</span>
              <span
                className={cn(
                  "font-medium",
                  s.signal === "BUY"
                    ? "text-green-500"
                    : s.signal === "SELL"
                      ? "text-red-500"
                      : "text-yellow-500",
                )}
              >
                {s.signal}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Risk Management Overlay (#58) ────────────────────────────
interface RiskOverlayProps {
  balance: number;
  equity: number;
  openPositions: number;
  dailyPnl: number;
  maxDailyLoss: number;
  maxTotalLoss: number;
}

export function RiskOverlay({
  balance,
  equity,
  openPositions,
  dailyPnl,
  maxDailyLoss,
  maxTotalLoss,
}: RiskOverlayProps) {
  const dailyUsed = maxDailyLoss > 0 ? (Math.abs(Math.min(0, dailyPnl)) / maxDailyLoss) * 100 : 0;
  const totalUsed =
    maxTotalLoss > 0 ? (Math.abs(Math.min(0, equity - balance)) / maxTotalLoss) * 100 : 0;
  const riskLevel =
    dailyUsed > 80 || totalUsed > 80
      ? "CRITICAL"
      : dailyUsed > 50 || totalUsed > 50
        ? "WARNING"
        : "SAFE";

  return (
    <Card>
      <CardHeader className="p-3 pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-accent" /> Risk Status
          </CardTitle>
          <span
            className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded",
              riskLevel === "CRITICAL"
                ? "bg-red-500/10 text-red-500"
                : riskLevel === "WARNING"
                  ? "bg-yellow-500/10 text-yellow-500"
                  : "bg-green-500/10 text-green-500",
            )}
          >
            {riskLevel}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-2 space-y-3">
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Daily Loss Used</span>
            <span
              className={
                dailyUsed > 80
                  ? "text-red-500"
                  : dailyUsed > 50
                    ? "text-yellow-500"
                    : "text-green-500"
              }
            >
              {dailyUsed.toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                dailyUsed > 80 ? "bg-red-500" : dailyUsed > 50 ? "bg-yellow-500" : "bg-green-500",
              )}
              style={{ width: `${Math.min(100, dailyUsed)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Total Loss Used</span>
            <span
              className={
                totalUsed > 80
                  ? "text-red-500"
                  : totalUsed > 50
                    ? "text-yellow-500"
                    : "text-green-500"
              }
            >
              {totalUsed.toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                totalUsed > 80 ? "bg-red-500" : totalUsed > 50 ? "bg-yellow-500" : "bg-green-500",
              )}
              style={{ width: `${Math.min(100, totalUsed)}%` }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/50 p-2 rounded text-center">
            <p className="text-muted-foreground">Positions</p>
            <p className="font-bold">{openPositions}</p>
          </div>
          <div className="bg-muted/50 p-2 rounded text-center">
            <p className="text-muted-foreground">Daily P/L</p>
            <p className={cn("font-bold", dailyPnl >= 0 ? "text-green-500" : "text-red-500")}>
              {formatCurrency(dailyPnl)}
            </p>
          </div>
        </div>
        {dailyUsed > 70 && (
          <div className="flex items-center gap-1.5 p-2 bg-red-500/10 rounded text-xs text-red-500">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span>Approaching daily loss limit. Consider reducing exposure.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── P&L Heatmap (#59) ────────────────────────────────────────
const HEATMAP_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const HEATMAP_HOURS = Array.from(
  { length: 6 },
  (_, i) => `${(i * 4).toString().padStart(2, "0")}:00`,
); // 4-hour blocks

export function PnlHeatmap({ data = [] }: { data?: { hour: number; day: number; pnl: number }[] }) {
  const days = HEATMAP_DAYS;
  const hours = HEATMAP_HOURS;

  // Generate mock data if none provided
  const heatData = useMemo(() => {
    if (data.length > 0) return data;
    return days.flatMap((_, day) =>
      hours.map((_, hIdx) => {
        const h = hIdx * 4;
        return { hour: h, day, pnl: ((day * 7 + hIdx * 13 + 5) % 200) - 80 };
      }),
    );
  }, [data, days, hours]);

  const maxAbs = Math.max(1, ...heatData.map((d) => Math.abs(d.pnl)));

  function cellColor(pnl: number) {
    const intensity = Math.abs(pnl) / maxAbs;
    if (pnl > 0) return `rgba(34, 197, 94, ${0.1 + intensity * 0.6})`;
    if (pnl < 0) return `rgba(239, 68, 68, ${0.1 + intensity * 0.6})`;
    return "rgba(128, 128, 128, 0.1)";
  }

  return (
    <Card>
      <CardHeader className="p-3 pb-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Flame className="h-4 w-4 text-accent" /> P&L Heatmap
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-2">
        <div className="space-y-1">
          <div className="flex gap-1">
            <div className="w-8" />
            {hours.map((h) => (
              <div key={h} className="flex-1 text-[9px] text-muted-foreground text-center">
                {h}
              </div>
            ))}
          </div>
          {days.map((day, di) => (
            <div key={day} className="flex gap-1 items-center">
              <span className="w-8 text-[10px] text-muted-foreground">{day}</span>
              {hours.map((_, hi) => {
                const cell = heatData.find((d) => d.day === di && d.hour === hi * 4);
                return (
                  <div
                    key={hi}
                    className="flex-1 h-6 rounded-sm flex items-center justify-center"
                    style={{ backgroundColor: cellColor(cell?.pnl || 0) }}
                    title={`${day} ${hours[hi]}: ${formatCurrency(cell?.pnl || 0)}`}
                  >
                    <span className="text-[8px] font-medium">
                      {cell ? (cell.pnl > 0 ? "+" : "") + cell.pnl.toFixed(0) : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-3 mt-2">
          <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <div
              className="h-2 w-4 rounded-sm"
              style={{ backgroundColor: "rgba(239, 68, 68, 0.5)" }}
            />{" "}
            Loss
          </div>
          <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <div
              className="h-2 w-4 rounded-sm"
              style={{ backgroundColor: "rgba(128, 128, 128, 0.1)" }}
            />{" "}
            Neutral
          </div>
          <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <div
              className="h-2 w-4 rounded-sm"
              style={{ backgroundColor: "rgba(34, 197, 94, 0.5)" }}
            />{" "}
            Profit
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── News Feed (#60) ──────────────────────────────────────────
export function NewsFeed({ symbol }: { symbol: string }) {
  const news = useMemo(
    () => [
      {
        id: 1,
        title: `${symbol.slice(0, 3)} Central Bank Rate Decision Ahead`,
        source: "Reuters",
        time: "2h ago",
        impact: "HIGH" as const,
      },
      {
        id: 2,
        title: `${symbol.slice(3, 6) || "USD"} Employment Data Exceeds Expectations`,
        source: "Bloomberg",
        time: "4h ago",
        impact: "MEDIUM" as const,
      },
      {
        id: 3,
        title: `Technical Analysis: ${symbol} Approaching Key Resistance`,
        source: "TradingView",
        time: "6h ago",
        impact: "LOW" as const,
      },
      {
        id: 4,
        title: "Global Risk Appetite Improves on Trade Deal Progress",
        source: "FT",
        time: "8h ago",
        impact: "MEDIUM" as const,
      },
      {
        id: 5,
        title: `${symbol} Volatility Expected to Increase Ahead of NFP`,
        source: "ForexLive",
        time: "12h ago",
        impact: "HIGH" as const,
      },
    ],
    [symbol],
  );

  const impactColors = {
    HIGH: "bg-red-500/10 text-red-500",
    MEDIUM: "bg-yellow-500/10 text-yellow-500",
    LOW: "bg-green-500/10 text-green-500",
  };

  return (
    <Card>
      <CardHeader className="p-3 pb-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Globe className="h-4 w-4 text-accent" /> Market News
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-2 space-y-2">
        {news.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0"
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium leading-tight line-clamp-2">{item.title}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-muted-foreground">{item.source}</span>
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" /> {item.time}
                </span>
              </div>
            </div>
            <span
              className={cn(
                "text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0",
                impactColors[item.impact],
              )}
            >
              {item.impact}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

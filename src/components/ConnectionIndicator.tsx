/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, useSyncExternalStore } from "react";
import { wsClient, type ConnectionState } from "@/services/ws";
import { useMarketDataHealth } from "@/services/queries";
import { cn } from "@/lib/utils";
import { Wifi, WifiOff, Loader2 } from "lucide-react";

interface MarketDataHealthSnapshot {
  adapter?: {
    status?: string;
    reason?: string;
  } | null;
  staleCount?: number;
  totalSymbols?: number;
  lastTickAgeMs?: number;
}

function isMarketDataInterrupted(health: unknown): health is MarketDataHealthSnapshot {
  return typeof health === "object" && health !== null;
}

// ── React Hook ──────────────────────────────────────────
function subscribeToWsState(callback: () => void) {
  return wsClient.onStateChange(() => callback());
}

function getWsSnapshot() {
  return wsClient.state;
}

export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(subscribeToWsState, getWsSnapshot);
}

/** True only when the WebSocket is fully authenticated and streaming data */
export function useIsFeedConnected(): boolean {
  const state = useConnectionState();
  return state === "connected";
}

// ── Stale data banner (>10s disconnected) ───────────────
export function useStaleData(): boolean {
  const state = useConnectionState();
  const { data: health } = useMarketDataHealth();
  const [stale, setStale] = useState(false);

  const marketDataInterrupted = (() => {
    if (!isMarketDataInterrupted(health)) return false;

    // Explicit provider interruption from backend should always surface.
    if (health.adapter?.status === "unavailable") return true;

    // No ticks observed since process start.
    if (typeof health.lastTickAgeMs === "number" && health.lastTickAgeMs < 0) return true;

    // Avoid false positives from partial staleness (some symbols stale while others are fine).
    // Treat as interrupted only when all tracked symbols are stale and stale age is significant.
    const staleCount = typeof health.staleCount === "number" ? health.staleCount : 0;
    const totalSymbols = typeof health.totalSymbols === "number" ? health.totalSymbols : 0;
    const lastTickAgeMs = typeof health.lastTickAgeMs === "number" ? health.lastTickAgeMs : 0;
    if (totalSymbols > 0 && staleCount >= totalSymbols && lastTickAgeMs > 30_000) {
      return true;
    }

    return false;
  })();

  useEffect(() => {
    if (state === "connected" && !marketDataInterrupted) {
      setStale(false);
      return;
    }
    const timer = setTimeout(() => setStale(true), 10_000);
    return () => clearTimeout(timer);
  }, [marketDataInterrupted, state]);

  return stale;
}

// ── Connection Indicator Component ──────────────────────
const stateConfig = {
  connected: {
    label: "Connected",
    icon: Wifi,
    color: "text-success",
    dot: "bg-success",
  },
  connecting: {
    label: "Connecting…",
    icon: Loader2,
    color: "text-warning",
    dot: "bg-warning",
  },
  reconnecting: {
    label: "Reconnecting…",
    icon: Loader2,
    color: "text-warning",
    dot: "bg-warning",
  },
  disconnected: {
    label: "Offline",
    icon: WifiOff,
    color: "text-destructive",
    dot: "bg-destructive",
  },
} as const;

export function ConnectionIndicator({ className }: { className?: string }) {
  const state = useConnectionState();
  const { label, icon: Icon, color, dot } = stateConfig[state];
  const isSpinning = state === "connecting" || state === "reconnecting";

  return (
    <div className={cn("flex items-center gap-1.5 text-[11px]", className)} title={label}>
      <span
        className={cn("h-1.5 w-1.5 rounded-full", dot, state !== "connected" && "animate-pulse")}
      />
      <Icon className={cn("h-3 w-3", color, isSpinning && "animate-spin")} />
      <span className={cn("hidden sm:inline", color)}>{label}</span>
    </div>
  );
}

// ── Stale Data Banner ───────────────────────────────────
export function StaleDataBanner() {
  const stale = useStaleData();
  const state = useConnectionState();
  const { data: health } = useMarketDataHealth();
  if (!stale) return null;

  const message = (() => {
    if (isMarketDataInterrupted(health)) {
      const interruptionReason = health.adapter?.reason;
      if (health.adapter?.status === "unavailable") {
        return interruptionReason
          ? `Live Feed Outage — ${interruptionReason}. Historical charts may still render from stored candles.`
          : "Live Feed Outage — live market data is unavailable. Historical charts may still render from stored candles.";
      }

      if (typeof health.lastTickAgeMs === "number" && health.lastTickAgeMs < 0) {
        return "Historical-Only Mode — no live ticks yet. Charts are rendering from historical data.";
      }

      const staleCount = typeof health.staleCount === "number" ? health.staleCount : 0;
      const totalSymbols = typeof health.totalSymbols === "number" ? health.totalSymbols : 0;
      if (totalSymbols > 0 && staleCount >= totalSymbols) {
        return "Live Feed Degraded — symbols are stale and live updates are delayed. Historical charts remain available.";
      }
      if (staleCount > 0) {
        return "Feed Degraded — some symbols are delayed. Trading may be impacted for affected symbols.";
      }
    }

    if (state !== "connected") {
      return "Connection Lost — live updates are paused. Historical charts remain available.";
    }

    return "Data Interruption — live market data is unavailable";
  })();

  return (
    <div className="bg-warning/10 border-b border-warning/30 px-4 py-1.5 text-center text-xs text-warning">
      {message}
    </div>
  );
}

// ── Disconnected Trading Banner (inline for order panel / bottom panel) ──
export function DisconnectedTradingBanner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-destructive/10 border border-destructive/30 rounded px-3 py-2 text-center",
        className,
      )}
    >
      <div className="flex items-center justify-center gap-1.5 text-destructive text-xs font-semibold">
        <WifiOff className="h-3.5 w-3.5" />
        Data Feed Disconnected
      </div>
      <p className="text-[10px] text-muted-foreground mt-0.5">
        Trading is disabled until the connection is restored
      </p>
    </div>
  );
}

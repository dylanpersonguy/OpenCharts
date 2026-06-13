import { useState, useEffect } from "react";
import { Clock } from "lucide-react";
import type { Symbol } from "../../services/schemas";
import { useTradingStore } from "../../services/store.tsx";

/**
 * How long after the last tick we consider the feed still live.
 * 3 minutes covers the ~5-minute XAUUSD/forex daily rollover gap and brief
 * feed interruptions without masking genuine weekend/holiday closures.
 */
const LIVE_TICK_GRACE_MS = 3 * 60_000;

/**
 * On initial mount the tick store is empty. Wait this long before falling
 * back to schedule-based logic so the first ticks have a chance to arrive.
 */
const STARTUP_HOLDOFF_MS = 10_000;

interface TradingHours {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
}

const DAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getTimeInZone(date: Date, timezone: string): { day: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const day = DAY_MAP[parts.find((p) => p.type === "weekday")?.value ?? ""] ?? date.getUTCDay();
  const h = parts.find((p) => p.type === "hour")?.value?.padStart(2, "0") ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value?.padStart(2, "0") ?? "00";
  return { day, time: `${h}:${m}` };
}

function isInWindow(windows: TradingHours[], tz: string, date: Date): boolean {
  const { day: currentDay, time: currentTime } = getTimeInZone(date, tz);
  for (const w of windows) {
    const crossesMidnight = w.closeTime <= w.openTime;
    if (crossesMidnight) {
      if (w.dayOfWeek === currentDay && currentTime >= w.openTime) return true;
      const prev = (currentDay + 6) % 7;
      if (w.dayOfWeek === prev && currentTime < w.closeTime) return true;
    } else {
      if (
        w.dayOfWeek === currentDay &&
        currentTime >= w.openTime &&
        (w.closeTime === "24:00" || currentTime < w.closeTime)
      )
        return true;
    }
  }
  return false;
}

// Default forex hours (UTC) used when no tradingHours configured.
// Standard FX week: opens Sunday 22:00 UTC (Sydney), closes Friday 22:00 UTC (NY close).
function isForexDefaultOpen(date: Date): boolean {
  const day = date.getUTCDay();
  const hour = date.getUTCHours();
  if (day === 6) return false; // Saturday — always closed
  if (day === 0 && hour < 22) return false; // Sunday before 22:00 UTC
  if (day === 5 && hour >= 22) return false; // Friday from 22:00 UTC
  return true;
}

function msUntilNextOpen(
  windows: TradingHours[],
  tz: string,
  category: string,
  now: Date,
): number | null {
  if (category?.toUpperCase() === "CRYPTO") return null;

  // Scan minute-by-minute up to 7 days ahead
  for (let m = 1; m <= 10080; m++) {
    const candidate = new Date(now.getTime() + m * 60_000);
    const open =
      windows.length > 0 ? isInWindow(windows, tz, candidate) : isForexDefaultOpen(candidate);
    if (open) return m * 60_000;
  }
  return null;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (days === 0) parts.push(`${minutes}m ${seconds.toString().padStart(2, "0")}s`);
  return parts.join(" ");
}

interface Props {
  symbolInfo: Symbol | undefined;
}

export function MarketClosedBanner({ symbolInfo }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [mountedAt] = useState(() => Date.now());
  const ticks = useTradingStore((s) => s.ticks);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!symbolInfo) return null;

  const category: string = symbolInfo.category ?? "";
  if (category.toUpperCase() === "CRYPTO") return null;

  // If the feed is actively delivering ticks for this symbol, the market is open.
  const symbolTick = ticks[symbolInfo.name ?? ""];
  if (symbolTick && Date.now() - symbolTick.timestamp < LIVE_TICK_GRACE_MS) return null;

  // No tick yet — give the WebSocket connection time to deliver the first tick
  // before falling back to schedule-based logic. Prevents a false "closed"
  // flash on page load and after tab resume.
  if (!symbolTick && Date.now() - mountedAt < STARTUP_HOLDOFF_MS) return null;

  const tradingHours = ((symbolInfo as Record<string, unknown>).tradingHours ??
    []) as TradingHours[];
  const tz: string =
    ((symbolInfo as Record<string, unknown>).sessionTimezone as string | undefined) ?? "UTC";

  const isOpen =
    tradingHours.length > 0 ? isInWindow(tradingHours, tz, now) : isForexDefaultOpen(now);

  if (isOpen) return null;

  const msUntilOpen = msUntilNextOpen(tradingHours, tz, category, now);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-medium"
    >
      <Clock className="h-3 w-3 shrink-0" />
      <span>
        Market closed
        {msUntilOpen != null && (
          <>
            {" "}
            · Opens in{" "}
            <span className="font-mono tabular-nums">
              {formatCountdown(msUntilOpen - (new Date().getTime() - now.getTime()))}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

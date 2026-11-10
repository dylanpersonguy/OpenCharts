/**
 * Informational "the underlying market is probably closed" notices for
 * Hyperliquid HIP-3 markets that track traditional assets.
 *
 * These markets trade 24/7 on Hyperliquid regardless of the underlying venue,
 * so this is NEVER a trading gate and the copy never says trading is impossible.
 * It only explains why the price may look odd: outside the underlying session
 * the price follows an oracle that can be stale or move in jumps, and liquidity
 * is often thinner.
 *
 * Schedules are deliberately approximate and follow New York wall-clock time, so
 * they track US daylight saving automatically (via the platform's tz database):
 *  - Stocks / Indices: US cash session Mon–Fri 09:30–16:00 ET
 *    (13:30–20:00 UTC in summer, 14:30–21:00 UTC in winter).
 *  - Forex / Commodities: closed from Fri 17:00 ET to Sun 17:00 ET
 *    (22:00 UTC in winter, 21:00 UTC in summer).
 *
 * Exchange holidays, early closes, pre/post-market sessions, daily commodity
 * maintenance breaks and non-US index hours (Nikkei, KOSPI, Nifty) are not
 * modelled. Treat the result as a hint, not a calendar.
 */

export type MarketHoursReason = "weekend" | "outside-session";

export interface MarketHoursNotice {
  reason: MarketHoursReason;
  title: string;
  message: string;
}

const US_OPEN_MIN = 9 * 60 + 30;
const US_CLOSE_MIN = 16 * 60;
const FX_CLOSE_MIN = 17 * 60; // Fri
const FX_OPEN_MIN = 17 * 60; // Sun

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
let nyFormat: Intl.DateTimeFormat | null = null;

/** Day of week (0 = Sunday) and minutes since midnight, on the New York wall clock. */
function newYorkClock(now: Date): { day: number; minutes: number } {
  try {
    nyFormat ??= new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const parts = nyFormat.formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = WEEKDAYS[get("weekday")];
    const hour = Number(get("hour")) % 24;
    const minute = Number(get("minute"));
    if (day !== undefined && Number.isFinite(hour) && Number.isFinite(minute)) return { day, minutes: hour * 60 + minute };
  } catch {
    /* no tz database: fall through */
  }
  // Fallback: fixed EST (UTC-5). Off by an hour in summer, which the notice tolerates.
  const est = new Date(now.getTime() - 5 * 3_600_000);
  return { day: est.getUTCDay(), minutes: est.getUTCHours() * 60 + est.getUTCMinutes() };
}

const ORACLE_NOTE =
  "Hyperliquid keeps this market open, but its price follows an oracle that can be stale or move in jumps while the underlying market is closed, and liquidity is often thinner.";

function isWeekendWindow(day: number, minutes: number): boolean {
  if (day === 6) return true;
  if (day === 5 && minutes >= FX_CLOSE_MIN) return true;
  if (day === 0 && minutes < FX_OPEN_MIN) return true;
  return false;
}

/** Categories this helper has an opinion about. Everything else returns null. */
export function marketHoursNotice(category: string | undefined, now: Date): MarketHoursNotice | null {
  const { day, minutes } = newYorkClock(now);

  switch (category) {
    case "Stocks":
    case "Indices": {
      const weekend = day === 0 || day === 6;
      const inSession = !weekend && minutes >= US_OPEN_MIN && minutes < US_CLOSE_MIN;
      if (inSession) return null;
      return {
        reason: weekend ? "weekend" : "outside-session",
        title: weekend ? "US markets are likely closed for the weekend" : "US markets are likely outside regular hours",
        message: ORACLE_NOTE,
      };
    }
    case "Forex":
    case "Commodities": {
      if (!isWeekendWindow(day, minutes)) return null;
      return {
        reason: "weekend",
        title:
          category === "Forex"
            ? "The forex market is likely closed for the weekend"
            : "Commodity futures markets are likely closed for the weekend",
        message: ORACLE_NOTE,
      };
    }
    default:
      return null;
  }
}

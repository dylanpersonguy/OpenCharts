import { describe, expect, it } from "vitest";
import { marketHoursNotice } from "../ui/marketHours.ts";

// 2026-11-09 is a Monday, and New York is on standard time (UTC-5) then: the US
// cash session is 14:30-21:00 UTC. DST behaviour is covered in review.math.test.ts.
const at = (iso: string) => new Date(`${iso}Z`);

describe("marketHoursNotice", () => {
  it("is silent for crypto and unknown categories at all times", () => {
    for (const c of ["Crypto", "Other", undefined, ""]) {
      expect(marketHoursNotice(c, at("2026-11-14T03:00:00"))).toBeNull();
    }
  });

  it("stocks: quiet during the US session, notice outside it", () => {
    expect(marketHoursNotice("Stocks", at("2026-11-09T15:00:00"))).toBeNull();
    expect(marketHoursNotice("Stocks", at("2026-11-09T14:30:00"))).toBeNull();
    expect(marketHoursNotice("Stocks", at("2026-11-09T14:29:00"))?.reason).toBe("outside-session");
    expect(marketHoursNotice("Stocks", at("2026-11-09T21:00:00"))?.reason).toBe("outside-session");
    expect(marketHoursNotice("Indices", at("2026-11-10T03:00:00"))?.reason).toBe("outside-session");
  });

  it("stocks: weekend", () => {
    expect(marketHoursNotice("Stocks", at("2026-11-14T15:00:00"))?.reason).toBe("weekend");
    expect(marketHoursNotice("Stocks", at("2026-11-15T15:00:00"))?.reason).toBe("weekend");
  });

  it("forex/commodities: closed Fri 22:00 to Sun 22:00 UTC only", () => {
    expect(marketHoursNotice("Forex", at("2026-11-13T21:59:00"))).toBeNull();
    expect(marketHoursNotice("Forex", at("2026-11-13T22:00:00"))?.reason).toBe("weekend");
    expect(marketHoursNotice("Forex", at("2026-11-14T12:00:00"))?.reason).toBe("weekend");
    expect(marketHoursNotice("Commodities", at("2026-11-15T21:59:00"))?.reason).toBe("weekend");
    expect(marketHoursNotice("Commodities", at("2026-11-15T22:00:00"))).toBeNull();
    expect(marketHoursNotice("Forex", at("2026-11-11T03:00:00"))).toBeNull();
  });

  it("never claims trading is impossible", () => {
    const n = marketHoursNotice("Forex", at("2026-11-14T12:00:00"));
    const text = `${n?.title} ${n?.message}`;
    expect(text).toMatch(/likely closed/i);
    expect(text).toMatch(/oracle/i);
    expect(text).not.toMatch(/cannot|can't|unable|disabled|not possible|halted/i);
  });
});

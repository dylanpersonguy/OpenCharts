import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hlSession } from "../session.ts";
import { checkGeo, decideGeo } from "../compliance/geo.ts";
import { parseCountryList, readComplianceSettings, TERMS_STORAGE_KEY, TERMS_VERSION } from "../compliance/config.ts";
import { hasAcceptedTerms, recordTermsAcceptance } from "../compliance/terms.ts";
import { marketRiskNotice, noticeForSymbol, registerMarketLookup, useMarketRiskNotice } from "../compliance/riskNotice.ts";
import {
  createUrlScreener,
  isAddressBlocked,
  resetScreening,
  screenAddress,
  setAddressScreener,
  useScreeningStore,
} from "../compliance/screen.ts";
import { ComplianceGate, MarketRiskBadge } from "../compliance/index.ts";
import { renderHook } from "@testing-library/react";
import type { HlMarket } from "../types.ts";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const market = (over: Partial<HlMarket> = {}): HlMarket => ({
  symbol: "xyz:TSLA",
  coin: "xyz:TSLA",
  dex: "xyz",
  dexIndex: 1,
  indexInMeta: 0,
  assetId: 110000,
  szDecimals: 2,
  maxLeverage: 10,
  onlyIsolated: true,
  category: "Stocks",
  displayName: "Tesla",
  ...over,
});

describe("settings", () => {
  it("parses country lists, ignoring junk", () => {
    expect([...parseCountryList(" us, ir ,KP,,xyz,1a")].sort()).toEqual(["IR", "KP", "US"]);
  });
  it("defaults fail mode to closed and only accepts an explicit open", () => {
    expect(readComplianceSettings({}).geoFailMode).toBe("closed");
    expect(readComplianceSettings({ VITE_GEO_FAIL_MODE: "OPEN" }).geoFailMode).toBe("open");
    expect(readComplianceSettings({ VITE_GEO_FAIL_MODE: "yes" }).geoFailMode).toBe("closed");
  });
  it("rejects non-http(s) URLs", () => {
    expect(readComplianceSettings({ VITE_GEO_CHECK_URL: "javascript:alert(1)" }).geoUrl).toBeUndefined();
    expect(readComplianceSettings({ VITE_GEO_CHECK_URL: "/api/geo" }).geoUrl).toBe("/api/geo");
  });
});

describe("checkGeo", () => {
  it("allows", async () => {
    const v = await checkGeo("/g", { fetchImpl: () => Promise.resolve(json({ allowed: true, country: "de" })) });
    expect(v).toEqual({ kind: "allowed", country: "DE" });
  });
  it("blocks when allowed:false", async () => {
    const v = await checkGeo("/g", { fetchImpl: () => Promise.resolve(json({ allowed: false, country: "US", reason: "x" })) });
    expect(v.kind).toBe("blocked");
  });
  it("applies the static blocklist even if the endpoint says allowed", async () => {
    const v = await checkGeo("/g", {
      blockedCountries: new Set(["KP"]),
      fetchImpl: () => Promise.resolve(json({ allowed: true, country: "kp" })),
    });
    expect(v).toEqual({ kind: "blocked", country: "KP" });
  });
  it("reports unavailable for HTTP errors, bad schema and network errors", async () => {
    expect((await checkGeo("/g", { fetchImpl: () => Promise.resolve(json({}, 500)) })).kind).toBe("unavailable");
    expect((await checkGeo("/g", { fetchImpl: () => Promise.resolve(json({ nope: 1 })) })).kind).toBe("unavailable");
    expect((await checkGeo("/g", { fetchImpl: () => Promise.reject(new TypeError("x")) })).kind).toBe("unavailable");
  });
  it("times out", async () => {
    vi.useFakeTimers();
    try {
      const hang: typeof fetch = (_u, init) =>
        new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
      const p = checkGeo("/g", { fetchImpl: hang, timeoutMs: 4000 });
      await vi.advanceTimersByTimeAsync(4001);
      expect(await p).toEqual({ kind: "unavailable", error: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("fail modes", () => {
    const u = { kind: "unavailable", error: "timeout" } as const;
    expect(decideGeo(u, "closed")).toBe("block");
    expect(decideGeo(u, "open")).toBe("allow");
    expect(decideGeo({ kind: "blocked" }, "open")).toBe("block");
    expect(decideGeo({ kind: "allowed" }, "closed")).toBe("allow");
  });
});

describe("terms acceptance", () => {
  beforeEach(() => localStorage.clear());
  it("is versioned: a bump re-prompts", () => {
    expect(hasAcceptedTerms()).toBe(false);
    recordTermsAcceptance("v1");
    expect(hasAcceptedTerms("v1")).toBe(true);
    expect(hasAcceptedTerms("v2")).toBe(false);
  });
  it("survives corrupt storage", () => {
    localStorage.setItem(TERMS_STORAGE_KEY, "{not json");
    expect(hasAcceptedTerms()).toBe(false);
  });
});

describe("risk notice", () => {
  it("is null for core-dex markets", () => {
    expect(marketRiskNotice(market({ dex: "", category: "Crypto" }))).toBeNull();
  });
  it("covers third-party, isolated and oracle copy", () => {
    const n = marketRiskNotice(market());
    expect(n?.title).toContain("xyz");
    expect(n?.body).toMatch(/third-party deployed market/);
    expect(n?.body).toMatch(/oracle, leverage limits and settlement/);
    expect(n?.body).toMatch(/halted/);
    expect(n?.body).toMatch(/Isolated margin only/);
    expect(n?.body).toMatch(/stale/);
    expect(n?.body).not.toMatch(/High leverage/);
  });
  it("warns above 20x only", () => {
    expect(marketRiskNotice(market({ maxLeverage: 20 }))?.body).not.toMatch(/High leverage/);
    expect(marketRiskNotice(market({ maxLeverage: 25 }))?.body).toMatch(/High leverage \(up to 25x\)/);
  });
  it("adds the oracle note for Forex and Commodities but not Other", () => {
    expect(marketRiskNotice(market({ category: "Forex" }))?.body).toMatch(/stale/);
    expect(marketRiskNotice(market({ category: "Commodities" }))?.body).toMatch(/stale/);
    expect(marketRiskNotice(market({ category: "Other" }))?.body).not.toMatch(/stale/);
  });
  it("derives from the symbol when no registry is registered, and prefers the registry", () => {
    expect(noticeForSymbol("BTC")).toBeNull();
    expect(noticeForSymbol("xyz:EUR")?.body).toMatch(/stale/);
    registerMarketLookup((s) => (s === "xyz:EUR" ? market({ symbol: s, maxLeverage: 50, category: "Forex" }) : undefined));
    try {
      const { result } = renderHook(() => useMarketRiskNotice("xyz:EUR"));
      expect(result.current?.body).toMatch(/up to 50x/);
    } finally {
      registerMarketLookup(undefined);
    }
  });
  it("badge renders for HIP-3 with an accessible tooltip, nothing for core", () => {
    const { container, rerender } = render(<MarketRiskBadge market={market()} />);
    const badge = screen.getByText("HIP-3");
    const tip = screen.getByRole("tooltip", { hidden: true });
    expect(badge.getAttribute("aria-describedby")).toBe(tip.id);
    expect(tip.textContent).toMatch(/third-party deployed market/);
    rerender(<MarketRiskBadge market={market({ dex: "", category: "Crypto" })} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("address screening", () => {
  afterEach(() => {
    setAddressScreener(undefined);
    resetScreening();
  });
  const A = "0xAbCdEf0000000000000000000000000000000001";

  it("publishes allowed / blocked to the store and guards the trading path", async () => {
    setAddressScreener({ screen: (a) => Promise.resolve({ allowed: a !== A.toLowerCase() }) });
    expect(await screenAddress(A)).toEqual({ allowed: false });
    expect(useScreeningStore.getState()).toMatchObject({ address: A.toLowerCase(), status: "blocked" });
    expect(isAddressBlocked(A)).toBe(true);
    expect(await screenAddress("0x0000000000000000000000000000000000000002")).toEqual({ allowed: true });
    expect(isAddressBlocked("0x0000000000000000000000000000000000000002")).toBe(false);
  });
  it("URL screener: sends address, validates, fail-closed by default and fail-open when asked", async () => {
    const seen: string[] = [];
    const ok = createUrlScreener("https://s.example/check", {
      fetchImpl: (u) => {
        seen.push(String(u));
        return Promise.resolve(json({ allowed: false }));
      },
    });
    expect(await ok.screen(A)).toEqual({ allowed: false });
    expect(seen[0]).toBe(`https://s.example/check?address=${A}`);
    const down = (mode: "open" | "closed") =>
      createUrlScreener("https://s.example/check", { failMode: mode, fetchImpl: () => Promise.reject(new TypeError("net")) });
    expect(await down("closed").screen(A)).toEqual({ allowed: false });
    expect(await down("open").screen(A)).toEqual({ allowed: true });
  });
});

describe("ComplianceGate", () => {
  beforeEach(() => {
    localStorage.clear();
    hlSession.setState({ address: null });
    vi.stubEnv("VITE_GEO_CHECK_URL", "");
    vi.stubEnv("VITE_GEO_FAIL_MODE", "");
    vi.stubEnv("VITE_BLOCKED_COUNTRIES", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    setAddressScreener(undefined);
    resetScreening();
  });

  it("with no geo URL: shows terms, requires all boxes, then renders and remembers", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <ComplianceGate>
        <p>app</p>
      </ComplianceGate>,
    );
    expect(screen.getByRole("dialog", { name: /before you trade/i })).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /i understand and agree/i });
    expect(button).toBeDisabled();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBe(6);
    for (const b of boxes.slice(0, -1)) await user.click(b);
    expect(button).toBeDisabled();
    await user.click(boxes[boxes.length - 1] as HTMLElement);
    expect(button).toBeEnabled();
    await user.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(hasAcceptedTerms()).toBe(true);
    unmount();

    render(
      <ComplianceGate>
        <p>app</p>
      </ComplianceGate>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("app")).toBeInTheDocument();
  });

  it("re-prompts when the stored version is older", () => {
    recordTermsAcceptance("old-version");
    render(
      <ComplianceGate>
        <p>app</p>
      </ComplianceGate>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(TERMS_VERSION).not.toBe("old-version");
  });

  it("Escape does not dismiss the terms", async () => {
    const user = userEvent.setup();
    render(
      <ComplianceGate>
        <p>app</p>
      </ComplianceGate>,
    );
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("states the configured fee in the terms", () => {
    render(
      <ComplianceGate>
        <p>app</p>
      </ComplianceGate>,
    );
    // No builder configured in tests => honest "no fee of its own".
    expect(screen.getByText(/platform fee/i).textContent).toMatch(/no fee of its own|per side/);
  });

  it("blocks with a region page and does not render the app when geo denies", async () => {
    vi.stubEnv("VITE_GEO_CHECK_URL", "https://geo.example/check");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ allowed: false, country: "XX", reason: "sanctions list" }));
    render(
      <ComplianceGate>
        <p>app</p>
      </ComplianceGate>,
    );
    expect(await screen.findByText(/not available in your region/i)).toBeInTheDocument();
    expect(screen.queryByText("app")).toBeNull();
    expect(screen.queryByText(/sanctions list/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("fails closed by default when the geo endpoint is unreachable", async () => {
    vi.stubEnv("VITE_GEO_CHECK_URL", "https://geo.example/check");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    render(
      <ComplianceGate>
        <p>app</p>
      </ComplianceGate>,
    );
    expect(await screen.findByText(/not available in your region/i)).toBeInTheDocument();
  });

  it("fails open only when explicitly configured", async () => {
    vi.stubEnv("VITE_GEO_CHECK_URL", "https://geo.example/check");
    vi.stubEnv("VITE_GEO_FAIL_MODE", "open");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    render(
      <ComplianceGate>
        <p>app</p>
      </ComplianceGate>,
    );
    expect(await screen.findByText("app")).toBeInTheDocument();
  });

  it("applies VITE_BLOCKED_COUNTRIES to the endpoint's country", async () => {
    vi.stubEnv("VITE_GEO_CHECK_URL", "https://geo.example/check");
    vi.stubEnv("VITE_BLOCKED_COUNTRIES", "KP, IR");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ allowed: true, country: "ir" }));
    render(
      <ComplianceGate>
        <p>app</p>
      </ComplianceGate>,
    );
    expect(await screen.findByText(/not available in your region/i)).toBeInTheDocument();
  });

  it("blocks a screened wallet that is refused", async () => {
    recordTermsAcceptance();
    setAddressScreener({ screen: () => Promise.resolve({ allowed: false }) });
    render(
      <ComplianceGate>
        <p>app</p>
      </ComplianceGate>,
    );
    expect(screen.getByText("app")).toBeInTheDocument();
    act(() => hlSession.setState({ address: "0x1111111111111111111111111111111111111111" }));
    await waitFor(() => expect(screen.getByText(/can't be used/i)).toBeInTheDocument());
    expect(screen.queryByText("app")).toBeNull();
  });
});

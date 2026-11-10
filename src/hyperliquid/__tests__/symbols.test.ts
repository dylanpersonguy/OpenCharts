import { describe, expect, it } from "vitest";
import type { HlMeta, HlPerpDex, InfoClient } from "../info.ts";
import {
  classifyMarket,
  createMarketRegistry,
  formatHlPrice,
  formatHlSize,
  marketToSymbol,
  priceTickSize,
  roundPriceToTick,
  toOpenChartsSymbols,
} from "../symbols.ts";

describe("formatHlPrice", () => {
  it("keeps integers whole, whatever the digit count", () => {
    expect(formatHlPrice(76101, 5)).toBe("76101");
    expect(formatHlPrice(1234567, 5)).toBe("1234567");
  });
  it("limits non-integers to 5 significant figures", () => {
    expect(formatHlPrice(76101.5, 5)).toBe("76102");
    expect(formatHlPrice(1234.56789, 2)).toBe("1234.6");
    expect(formatHlPrice(1.116789, 1)).toBe("1.1168");
    expect(formatHlPrice(0.0123456, 0)).toBe("0.012346");
  });
  it("limits decimals to 6 - szDecimals", () => {
    expect(formatHlPrice(0.123456, 4)).toBe("0.12"); // max 2 decimals
    expect(formatHlPrice(1.23456, 4)).toBe("1.23");
    expect(formatHlPrice(0.00123456, 3)).toBe("0.001"); // max 3 decimals
  });
  it("strips trailing zeros and handles round-up carries", () => {
    expect(formatHlPrice(1.5, 1)).toBe("1.5");
    expect(formatHlPrice(9.999996, 0)).toBe("10");
    expect(formatHlPrice(0.999996, 0)).toBe("1");
  });
  it("returns 0 for invalid input", () => {
    expect(formatHlPrice(Number.NaN, 2)).toBe("0");
    expect(formatHlPrice(-1, 2)).toBe("0");
    expect(formatHlPrice(0, 2)).toBe("0");
  });
  it("always satisfies HL's rule for random prices", () => {
    for (let i = 0; i < 500; i++) {
      const sz = i % 6;
      const px = Math.exp(Math.random() * 20 - 8);
      const out = formatHlPrice(px, sz);
      if (out.includes(".")) {
        const [int = "", dec = ""] = out.split(".");
        expect(dec.length).toBeLessThanOrEqual(6 - sz);
        const sig = (int.replace(/^0+/, "") + dec).replace(/^0+/, "").length;
        expect(sig).toBeLessThanOrEqual(5);
        expect(out.endsWith("0")).toBe(false);
      }
    }
  });
});

describe("formatHlSize", () => {
  it("rounds down, never up", () => {
    expect(formatHlSize(0.12999, 2)).toBe("0.12");
    expect(formatHlSize(1.999, 0)).toBe("1");
    expect(formatHlSize(0.00019, 4)).toBe("0.0001");
  });
  it("absorbs binary floating point noise", () => {
    expect(formatHlSize(0.29, 2)).toBe("0.29");
    expect(formatHlSize(0.57, 2)).toBe("0.57");
    expect(formatHlSize(1.1, 1)).toBe("1.1");
    expect(formatHlSize(4.35, 2)).toBe("4.35");
  });
  it("strips trailing zeros", () => {
    expect(formatHlSize(1.5, 4)).toBe("1.5");
    expect(formatHlSize(2, 3)).toBe("2");
    expect(formatHlSize(100, 0)).toBe("100");
  });
  it("returns 0 for non-positive / invalid sizes and dust", () => {
    expect(formatHlSize(0, 2)).toBe("0");
    expect(formatHlSize(-1, 2)).toBe("0");
    expect(formatHlSize(Number.NaN, 2)).toBe("0");
    expect(formatHlSize(0.001, 2)).toBe("0");
  });
});

describe("tick size", () => {
  it("derives from price magnitude and szDecimals", () => {
    expect(priceTickSize(76101, 5)).toBe(1); // 5 sig figs -> 0 decimals
    expect(priceTickSize(2400.55, 4)).toBe(0.1);
    expect(priceTickSize(1.1167, 1)).toBe(0.0001);
    expect(priceTickSize(0.00012345, 0)).toBe(1e-6); // capped by 6 decimals
    expect(priceTickSize(1.1167, 4)).toBe(0.01); // capped by 6 - szDecimals
  });
  it("falls back to the decimal cap with no price", () => {
    expect(priceTickSize(undefined, 3)).toBe(0.001);
  });
  it("roundPriceToTick snaps without float noise", () => {
    expect(roundPriceToTick(1.11674, 0.0001)).toBe(1.1167);
    expect(roundPriceToTick(100.26, 0.1)).toBe(100.3);
    expect(roundPriceToTick(7.3, 1)).toBe(7);
  });
});

describe("classification", () => {
  it("prefers the API label", () => {
    expect(classifyMarket("xyz:EUR", "xyz", "fx")).toBe("Forex");
    expect(classifyMarket("km:EUR", "km", "FX")).toBe("Forex");
    expect(classifyMarket("flx:BTC", "flx", "crypto")).toBe("Crypto");
    expect(classifyMarket("io:ANTH", "io", "preipo")).toBe("Other");
    expect(classifyMarket("para:10Y", "para", "rates")).toBe("Other");
    expect(classifyMarket("xyz:SP500", "xyz", "indices")).toBe("Indices");
  });
  it("falls back to the static map", () => {
    expect(classifyMarket("xyz:GBP", "xyz")).toBe("Forex");
    expect(classifyMarket("xyz:GOLD", "xyz")).toBe("Commodities");
    expect(classifyMarket("xyz:JP225", "xyz")).toBe("Indices");
    expect(classifyMarket("xyz:TSLA", "xyz")).toBe("Stocks");
    expect(classifyMarket("BTC", "")).toBe("Crypto");
  });
});

function fakeInfo(): InfoClient {
  const dexes: (HlPerpDex | null)[] = [null, { name: "xyz" }, { name: "flx" }, { name: "dead" }];
  const metas: Record<string, HlMeta> = {
    "": {
      universe: [
        { name: "BTC", szDecimals: 5, maxLeverage: 40 },
        { name: "OLD", szDecimals: 2, maxLeverage: 3, isDelisted: true },
        { name: "ETH", szDecimals: 4, maxLeverage: 25 },
      ],
    },
    xyz: {
      universe: [
        { name: "xyz:XYZ100", szDecimals: 4, maxLeverage: 30 },
        { name: "xyz:EUR", szDecimals: 1, maxLeverage: 50, onlyIsolated: true, marginMode: "noCross" },
        { name: "xyz:TSLA", szDecimals: 3, maxLeverage: 20, marginMode: "strictIsolated" },
      ],
      collateralToken: 0,
    },
    flx: { universe: [{ name: "flx:GOLD", szDecimals: 3, maxLeverage: 10 }] },
    dead: { universe: [{ name: "dead:X", szDecimals: 1, maxLeverage: 5, isDelisted: true }] },
  };
  return {
    perpDexs: () => Promise.resolve(dexes),
    meta: (dex?: string) => Promise.resolve(metas[dex ?? ""] as HlMeta),
    perpCategories: () => Promise.resolve([["xyz:EUR", "fx"], ["xyz:XYZ100", "indices"], ["flx:GOLD", "commodities"]]),
  } as unknown as InfoClient;
}

describe("createMarketRegistry", () => {
  it("builds markets with the HIP-3 asset id formula", async () => {
    const reg = createMarketRegistry(fakeInfo());
    await reg.load();
    const btc = reg.bySymbol("BTC")!;
    expect(btc.assetId).toBe(0);
    // Delisted OLD keeps index 1, so ETH stays at 2.
    expect(reg.bySymbol("ETH")!.assetId).toBe(2);
    expect(reg.bySymbol("OLD")).toBeUndefined();
    // xyz = dexIndex 1: 100000 + 1*10000 + idx
    expect(reg.bySymbol("xyz:XYZ100")!.assetId).toBe(110000);
    expect(reg.bySymbol("xyz:EUR")!.assetId).toBe(110001);
    // flx = dexIndex 2
    expect(reg.bySymbol("flx:GOLD")!.assetId).toBe(120000);
  });

  it("skips dexes with no live markets and keeps metadata", async () => {
    const reg = createMarketRegistry(fakeInfo());
    await reg.load();
    expect(reg.markets().some((m) => m.dex === "dead")).toBe(false);
    const eur = reg.bySymbol("xyz:EUR")!;
    expect(eur).toMatchObject({
      dex: "xyz",
      dexIndex: 1,
      indexInMeta: 1,
      szDecimals: 1,
      maxLeverage: 50,
      onlyIsolated: true,
      category: "Forex",
      displayName: "EUR/USD",
      collateral: "USDC",
    });
    expect(reg.bySymbol("xyz:TSLA")!.onlyIsolated).toBe(true);
    expect(reg.bySymbol("xyz:TSLA")!.marginMode).toBe("strictIsolated");
    expect(reg.bySymbol("flx:GOLD")!.displayName).toBe("Gold (flx)");
    expect(reg.bySymbol("BTC")!.category).toBe("Crypto");
  });

  it("loads once and shares the in-flight load", async () => {
    let calls = 0;
    const info = { ...fakeInfo(), perpDexs: () => { calls++; return Promise.resolve([null]); } } as unknown as InfoClient;
    const reg = createMarketRegistry(info);
    await Promise.all([reg.load(), reg.load()]);
    await reg.load();
    expect(calls).toBe(1);
  });

  it("allows retry after a failed load", async () => {
    let fail = true;
    const base = fakeInfo();
    const info = {
      ...base,
      perpDexs: () => (fail ? Promise.reject(new Error("net")) : base.perpDexs()),
    } as InfoClient;
    const reg = createMarketRegistry(info);
    await expect(reg.load()).rejects.toThrow("net");
    fail = false;
    await reg.load();
    expect(reg.markets().length).toBeGreaterThan(0);
  });

  it("tolerates a failing builder dex but not a failing core dex", async () => {
    const base = fakeInfo();
    const flaky = {
      ...base,
      meta: (dex?: string) => (dex === "flx" ? Promise.reject(new Error("x")) : base.meta(dex)),
    } as InfoClient;
    const reg = createMarketRegistry(flaky);
    await reg.load();
    expect(reg.bySymbol("flx:GOLD")).toBeUndefined();
    expect(reg.bySymbol("BTC")).toBeDefined();

    const coreDown = {
      ...base,
      meta: (dex?: string) => (!dex ? Promise.reject(new Error("core")) : base.meta(dex)),
    } as InfoClient;
    await expect(createMarketRegistry(coreDown).load()).rejects.toThrow("core");
  });
});

describe("OpenCharts mapping", () => {
  it("maps a market to a Symbol", async () => {
    const reg = createMarketRegistry(fakeInfo());
    await reg.load();
    const s = marketToSymbol(reg.bySymbol("xyz:EUR")!, 1.1167);
    expect(s).toMatchObject({
      id: "xyz:EUR",
      name: "xyz:EUR",
      displayName: "EUR/USD",
      category: "Forex",
      contractSize: 1,
      tickSize: 0.0001, // 5 sig figs at 1.1167 -> 4 decimals (cap is 5)
      marginPercent: 2,
      maxLeverage: 50,
      commission: 0,
      tradingHoursStart: null,
      tradingHoursEnd: null,
      isActive: true,
    });
  });

  it("toOpenChartsSymbols uses the mids map", async () => {
    const reg = createMarketRegistry(fakeInfo());
    await reg.load();
    const syms = toOpenChartsSymbols(reg.markets(), { BTC: 76101 });
    expect(syms).toHaveLength(reg.markets().length);
    expect(syms.find((s) => s.name === "BTC")!.tickSize).toBe(1);
    for (const s of syms) expect(s.tickSize).toBeGreaterThan(0);
  });
});

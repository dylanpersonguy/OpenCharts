import { describe, expect, it } from "vitest";
import { SymbolSchema } from "../schemas.ts";
import { createReplayEngine } from "./engine/create-engine.ts";
import { REPLAY_INSTRUMENT_DEFAULTS, REPLAY_SYMBOLS, engineConfigFor, isReplaySymbol } from "./instruments.ts";

describe("replay instruments", () => {
  it("exposes schema-valid BTCUSD and XAUUSD specs", () => {
    expect(REPLAY_SYMBOLS.map((s) => s.name)).toEqual(["BTCUSD", "XAUUSD"]);
    for (const s of REPLAY_SYMBOLS) expect(() => SymbolSchema.parse(s)).not.toThrow();
    expect(REPLAY_SYMBOLS[1]).toMatchObject({ category: "METALS", contractSize: 100, tickSize: 0.01 });
    expect(REPLAY_INSTRUMENT_DEFAULTS.XAUUSD.defaultSpread).toBe(0.3);
  });

  it("builds engine configs with defaults and overrides", () => {
    expect(engineConfigFor("XAUUSD", { accountId: "a" })).toEqual({
      accountId: "a",
      symbol: "XAUUSD",
      contractSize: 100,
      tickSize: 0.01,
      spread: 0.3,
      commissionPerLotPerSide: 0,
      leverage: 100,
      startingBalance: 100_000,
    });
    expect(engineConfigFor("BTCUSD", { accountId: "a", spread: 5 }).spread).toBe(5);
  });

  it("recognises replay symbols", () => {
    expect(isReplaySymbol("XAUUSD")).toBe(true);
    expect(isReplaySymbol("ETHUSD")).toBe(false);
  });

  it("applies the gold contract size and spread without float noise", () => {
    const engine = createReplayEngine(engineConfigFor("XAUUSD", { accountId: "a" }), undefined, {
      newId: (() => {
        let n = 0;
        return () => `g-${++n}`;
      })(),
    });
    engine.advance([{ time: 0, open: 2000.1, high: 2000.1, low: 2000.1, close: 2000.1, volume: 0 }]);
    engine.placeOrder({ side: "BUY", type: "MARKET", quantity: 0.1 });
    const pos = engine.getState().positions[0]!;
    expect(pos.entryPrice).toBe(2000.4);
    expect(pos.unrealizedPnl).toBe(-3); // 0.3 spread * 0.1 lot * 100 oz
  });
});

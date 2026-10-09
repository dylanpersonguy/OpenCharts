import { describe, it, expect, afterEach, vi } from "vitest";
import {
  backendForAccount,
  backendForOrder,
  backendForPosition,
  registerReplayBackend,
  resetReplayBackends,
  type TradingBackend,
} from "./replay-router.ts";
import { demoApi } from "./api.ts";
import * as engine from "./engine.ts";

function fakeBackend(accountId: string, positionIds: string[] = [], orderIds: string[] = []): TradingBackend {
  return {
    accountId,
    placeOrder: vi.fn(() => Promise.reject(new Error("rejected by replay"))),
    cancelOrder: vi.fn(() => Promise.resolve({ success: true })),
    modifyOrder: vi.fn(() => Promise.resolve(undefined)),
    getOrders: () => [],
    getPositions: () => [],
    closePosition: vi.fn(() => Promise.resolve({ success: true })),
    closeAllPositions: vi.fn(() => Promise.resolve({ success: true })),
    modifyPosition: vi.fn(() => Promise.resolve(undefined)),
    getClosedPositions: () => [],
    getAccount: () => engine.getAccount(),
    ownsPosition: (id) => positionIds.includes(id),
    ownsOrder: (id) => orderIds.includes(id),
  };
}

afterEach(() => resetReplayBackends());

describe("replay router", () => {
  it("finds a backend by account, position and order id", () => {
    const b = fakeBackend("acc-1", ["pos-1"], ["ord-1"]);
    registerReplayBackend(b);
    expect(backendForAccount("acc-1")).toBe(b);
    expect(backendForPosition("pos-1")).toBe(b);
    expect(backendForOrder("ord-1")).toBe(b);
    expect(backendForAccount("other")).toBeNull();
    expect(backendForAccount(null)).toBeNull();
  });

  it("unregister only removes the instance that registered (StrictMode re-mount safe)", () => {
    const first = fakeBackend("acc-1");
    const second = fakeBackend("acc-1");
    const unregisterFirst = registerReplayBackend(first);
    registerReplayBackend(second);
    unregisterFirst();
    expect(backendForAccount("acc-1")).toBe(second);
  });

  it("routes demo api trading calls to the replay backend and surfaces rejections", async () => {
    const b = fakeBackend("acc-1", ["pos-1"], ["ord-1"]);
    registerReplayBackend(b);
    await expect(
      demoApi.placeOrder({ accountId: "acc-1", symbol: "XAUUSD", side: "BUY", type: "MARKET", quantity: 1 }),
    ).rejects.toThrow("rejected by replay");
    await demoApi.closePosition("pos-1");
    await demoApi.cancelOrder("ord-1");
    await demoApi.modifyPosition("pos-1", { stopLoss: 1 });
    expect(b.closePosition).toHaveBeenCalledWith("pos-1", undefined);
    expect(b.cancelOrder).toHaveBeenCalledWith("ord-1");
    expect(b.modifyPosition).toHaveBeenCalledWith("pos-1", { stopLoss: 1 });
  });

  it("falls through to the live engine when nothing is registered", async () => {
    const live = engine.getAccount();
    expect(await demoApi.getAccount(live.id)).toEqual(live);
    expect(await demoApi.getPositions(live.id)).toEqual(engine.getPositions());
  });
});

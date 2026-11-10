import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState } from "../../adapter/types.ts";
import { channelOf, createHlSocket, subscriptionKey } from "../ws.ts";
import { FakeWebSocket, FakeWebSocketCtor } from "./fakeSocket.ts";

function make(overrides: Parameters<typeof createHlSocket>[0] = {}) {
  return createHlSocket({
    url: "wss://test/ws",
    webSocketImpl: FakeWebSocketCtor,
    random: () => 1,
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("helpers", () => {
  it("keys subscriptions independent of property order", () => {
    expect(subscriptionKey({ type: "candle", coin: "BTC", interval: "1m" })).toBe(
      subscriptionKey({ interval: "1m", type: "candle", coin: "BTC" }),
    );
    expect(subscriptionKey({ type: "allMids" })).not.toBe(subscriptionKey({ type: "allMids", dex: "xyz" }));
  });
  it("maps userEvents to the user channel", () => {
    expect(channelOf({ type: "userEvents", user: "0x1" })).toBe("user");
    expect(channelOf({ type: "bbo", coin: "BTC" })).toBe("bbo");
  });
});

describe("HlSocket", () => {
  it("connects, reports state, and sends queued subscriptions on open", () => {
    const s = make();
    const states: ConnectionState[] = [];
    s.onState((x) => states.push(x));
    s.subscribe({ type: "bbo", coin: "BTC" }, () => {});
    s.connect();
    expect(states).toEqual(["disconnected", "connecting"]);
    FakeWebSocket.last().open();
    expect(s.getState()).toBe("connected");
    expect(FakeWebSocket.last().sent).toEqual([
      { method: "subscribe", subscription: { type: "bbo", coin: "BTC" } },
    ]);
    expect(FakeWebSocket.last().url).toBe("wss://test/ws");
  });

  it("refcounts identical subscriptions", () => {
    const s = make();
    s.connect();
    const ws = FakeWebSocket.last();
    ws.open();
    const a = s.subscribe({ type: "bbo", coin: "BTC" }, () => {});
    const b = s.subscribe({ type: "bbo", coin: "BTC" }, () => {});
    expect(ws.sent).toHaveLength(1);
    expect(s.subscriptionCount()).toBe(1);
    a();
    a(); // idempotent
    expect(ws.sent).toHaveLength(1);
    b();
    expect(ws.sent[1]).toEqual({ method: "unsubscribe", subscription: { type: "bbo", coin: "BTC" } });
    expect(s.subscriptionCount()).toBe(0);
  });

  it("routes frames by channel", () => {
    const s = make();
    s.connect();
    const ws = FakeWebSocket.last();
    ws.open();
    const bbo = vi.fn();
    const mids = vi.fn();
    s.subscribe({ type: "bbo", coin: "BTC" }, bbo);
    s.subscribe({ type: "allMids" }, mids);
    ws.push({ channel: "bbo", data: { coin: "BTC" } });
    ws.push({ channel: "allMids", data: { mids: {} } });
    ws.push({ channel: "pong" });
    ws.onmessage?.({ data: "not json" } as MessageEvent);
    expect(bbo).toHaveBeenCalledTimes(1);
    expect(bbo).toHaveBeenCalledWith({ coin: "BTC" });
    expect(mids).toHaveBeenCalledTimes(1);
  });

  it("survives a throwing handler", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = make();
    s.connect();
    FakeWebSocket.last().open();
    const ok = vi.fn();
    s.subscribe({ type: "bbo", coin: "A" }, () => {
      throw new Error("x");
    });
    s.subscribe({ type: "bbo", coin: "B" }, ok);
    FakeWebSocket.last().push({ channel: "bbo", data: {} });
    expect(ok).toHaveBeenCalled();
    err.mockRestore();
  });

  it("reconnects with exponential backoff and resubscribes", () => {
    const s = make({ backoffBaseMs: 1000, backoffMaxMs: 4000 });
    s.connect();
    s.subscribe({ type: "candle", coin: "BTC", interval: "1m" }, () => {});
    FakeWebSocket.last().open();
    FakeWebSocket.last().drop();
    expect(s.getState()).toBe("reconnecting");
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    // second failure before opening -> 2s delay
    FakeWebSocket.last().drop();
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
    FakeWebSocket.last().open();
    expect(s.getState()).toBe("connected");
    expect(FakeWebSocket.last().sent).toEqual([
      { method: "subscribe", subscription: { type: "candle", coin: "BTC", interval: "1m" } },
    ]);
    // delay resets after a successful open
    FakeWebSocket.last().drop();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it("applies jitter within the backoff ceiling", () => {
    const s = make({ backoffBaseMs: 1000, backoffMaxMs: 2000, random: () => 0 });
    s.connect();
    FakeWebSocket.last().drop();
    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("does not reconnect after disconnect(), and can connect again", () => {
    const s = make();
    s.connect();
    FakeWebSocket.last().open();
    s.disconnect();
    expect(s.getState()).toBe("disconnected");
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    s.subscribe({ type: "bbo", coin: "ETH" }, () => {});
    s.connect();
    FakeWebSocket.last().open();
    expect(FakeWebSocket.last().sent).toHaveLength(1);
  });

  it("sends a ping heartbeat and reconnects when no pong arrives", () => {
    const s = make({ pingIntervalMs: 30_000, pongTimeoutMs: 10_000, backoffBaseMs: 1000 });
    s.connect();
    const ws = FakeWebSocket.last();
    ws.open();
    vi.advanceTimersByTime(30_000);
    expect(ws.sent).toContainEqual({ method: "ping" });
    ws.push({ channel: "pong" });
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    // next ping (t=60s) is never answered -> reconnect after the pong timeout
    vi.advanceTimersByTime(20_000);
    vi.advanceTimersByTime(10_000);
    expect(s.getState()).toBe("reconnecting");
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("enforces the subscription limit", () => {
    const s = make();
    for (let i = 0; i < 1000; i++) s.subscribe({ type: "bbo", coin: `C${i}` }, () => {});
    expect(() => s.subscribe({ type: "bbo", coin: "one-too-many" }, () => {})).toThrow(/1000/);
    expect(() => s.subscribe({ type: "bbo", coin: "C1" }, () => {})).not.toThrow();
  });
});

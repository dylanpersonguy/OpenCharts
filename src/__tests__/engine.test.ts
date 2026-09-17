import { beforeEach, describe, expect, it } from "vitest";
import * as engine from "@/services/demo/engine";
import { __resetBus } from "@/services/demo/bus";

const SYMBOL = "BTCUSD";

/** Place a market buy after seeding a price, the common setup. */
function openLong(qty = 1, price = 50_000) {
  engine.mark(SYMBOL, price);
  return engine.placeOrder({
    accountId: "demo",
    symbol: SYMBOL,
    side: "BUY",
    type: "MARKET",
    quantity: qty,
  });
}

beforeEach(() => {
  engine.__resetForTests();
  __resetBus();
});

describe("placeOrder — validation", () => {
  it("rejects an unknown symbol", () => {
    expect(() =>
      engine.placeOrder({
        accountId: "demo",
        symbol: "NOTREAL",
        side: "BUY",
        type: "MARKET",
        quantity: 1,
      }),
    ).toThrow(/Unknown symbol/);
  });

  it("rejects a market order before any price has arrived", () => {
    expect(() =>
      engine.placeOrder({
        accountId: "demo",
        symbol: SYMBOL,
        side: "BUY",
        type: "MARKET",
        quantity: 1,
      }),
    ).toThrow(/No price/);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_000_000])(
    "rejects quantity %p",
    (qty) => {
      engine.mark(SYMBOL, 50_000);
      expect(() =>
        engine.placeOrder({
          accountId: "demo",
          symbol: SYMBOL,
          side: "BUY",
          type: "MARKET",
          quantity: qty as number,
        }),
      ).toThrow();
    },
  );

  it("rejects an order that needs more margin than is free", () => {
    engine.mark(SYMBOL, 50_000);
    // 300 BTC @ 50k = $15M notional = $150k margin at 100x, account holds $100k.
    expect(() =>
      engine.placeOrder({
        accountId: "demo",
        symbol: SYMBOL,
        side: "BUY",
        type: "MARKET",
        quantity: 300,
      }),
    ).toThrow(/margin/i);
    expect(engine.getPositions()).toHaveLength(0);
  });

  it("rejects a take-profit on the wrong side of the market", () => {
    engine.mark(SYMBOL, 50_000);
    expect(() =>
      engine.placeOrder({
        accountId: "demo",
        symbol: SYMBOL,
        side: "BUY",
        type: "MARKET",
        quantity: 1,
        takeProfit: 49_000,
      }),
    ).toThrow(/Take-profit/);
  });

  it("rejects a stop-loss on the wrong side of the market", () => {
    engine.mark(SYMBOL, 50_000);
    expect(() =>
      engine.placeOrder({
        accountId: "demo",
        symbol: SYMBOL,
        side: "SELL",
        type: "MARKET",
        quantity: 1,
        stopLoss: 49_000,
      }),
    ).toThrow(/Stop-loss/);
  });
});

describe("market orders", () => {
  it("fills at the market price and opens a position", () => {
    const order = openLong(2, 50_000);
    expect(order.status).toBe("FILLED");
    expect(order.avgFillPrice).toBe(50_000);

    const [pos] = engine.getPositions();
    expect(pos?.side).toBe("LONG");
    expect(pos?.quantity).toBe(2);
    expect(pos?.entryPrice).toBe(50_000);
  });

  it("ignores a user-supplied price — a market order cannot pick its own fill", () => {
    engine.mark(SYMBOL, 50_000);
    const order = engine.placeOrder({
      accountId: "demo",
      symbol: SYMBOL,
      side: "BUY",
      type: "MARKET",
      quantity: 1,
      price: 1, // would have opened at $1 before the fix
    });
    expect(order.avgFillPrice).toBe(50_000);
  });

  it("reserves margin and reduces free margin", () => {
    openLong(1, 50_000); // $50k notional → $500 margin at 100x
    const account = engine.getAccount();
    expect(account.margin).toBeCloseTo(500, 2);
    expect(account.freeMargin).toBeCloseTo(99_500, 2);
  });
});

describe("resting orders", () => {
  it("keeps a buy limit below the market pending until price falls to it", () => {
    engine.mark(SYMBOL, 50_000);
    const order = engine.placeOrder({
      accountId: "demo",
      symbol: SYMBOL,
      side: "BUY",
      type: "LIMIT",
      quantity: 1,
      price: 49_000,
    });
    expect(order.status).toBe("PENDING");
    expect(engine.getPositions()).toHaveLength(0);

    engine.mark(SYMBOL, 49_500);
    expect(engine.getOrders()[0]?.status).toBe("PENDING");

    engine.mark(SYMBOL, 48_900);
    expect(engine.getOrders()[0]?.status).toBe("FILLED");
    // Price improvement: the tick was better than the limit, so we get the tick.
    expect(engine.getPositions()[0]?.entryPrice).toBe(48_900);
  });

  it("fills a marketable limit immediately", () => {
    engine.mark(SYMBOL, 50_000);
    const order = engine.placeOrder({
      accountId: "demo",
      symbol: SYMBOL,
      side: "BUY",
      type: "LIMIT",
      quantity: 1,
      price: 51_000, // already above the market
    });
    expect(order.status).toBe("FILLED");
    expect(engine.getPositions()[0]?.entryPrice).toBe(50_000);
  });

  it("rejects a buy stop placed below the market", () => {
    engine.mark(SYMBOL, 50_000);
    expect(() =>
      engine.placeOrder({
        accountId: "demo",
        symbol: SYMBOL,
        side: "BUY",
        type: "STOP",
        quantity: 1,
        stopPrice: 49_000,
      }),
    ).toThrow(/stop must be above/i);
  });

  it("triggers a buy stop when price rises through it, with slippage", () => {
    engine.mark(SYMBOL, 50_000);
    engine.placeOrder({
      accountId: "demo",
      symbol: SYMBOL,
      side: "BUY",
      type: "STOP",
      quantity: 1,
      stopPrice: 51_000,
    });
    engine.mark(SYMBOL, 51_500); // gapped through the stop
    expect(engine.getPositions()[0]?.entryPrice).toBe(51_500);
  });

  it("does not fill a pending order for a different symbol", () => {
    engine.mark(SYMBOL, 50_000);
    engine.placeOrder({
      accountId: "demo",
      symbol: SYMBOL,
      side: "BUY",
      type: "LIMIT",
      quantity: 1,
      price: 49_000,
    });
    engine.mark("ETHUSD", 10);
    expect(engine.getOrders()[0]?.status).toBe("PENDING");
  });
});

describe("cancel / modify", () => {
  it("cancels a pending order", () => {
    engine.mark(SYMBOL, 50_000);
    const order = engine.placeOrder({
      accountId: "demo",
      symbol: SYMBOL,
      side: "BUY",
      type: "LIMIT",
      quantity: 1,
      price: 49_000,
    });
    engine.cancelOrder(order.id);
    expect(engine.getOrders()[0]?.status).toBe("CANCELED");

    engine.mark(SYMBOL, 48_000);
    expect(engine.getPositions()).toHaveLength(0);
  });

  it("refuses to cancel an already-filled order", () => {
    const order = openLong();
    expect(() => engine.cancelOrder(order.id)).toThrow(/filled/i);
  });

  it("refuses to cancel an unknown order", () => {
    expect(() => engine.cancelOrder("nope")).toThrow(/not found/i);
  });

  it("modifies a pending order's limit price", () => {
    engine.mark(SYMBOL, 50_000);
    const order = engine.placeOrder({
      accountId: "demo",
      symbol: SYMBOL,
      side: "BUY",
      type: "LIMIT",
      quantity: 1,
      price: 49_000,
    });
    const updated = engine.modifyOrder(order.id, { price: 49_500 });
    expect(updated.price).toBe(49_500);
  });

  it("refuses to modify a filled order", () => {
    const order = openLong();
    expect(() => engine.modifyOrder(order.id, { price: 1 })).toThrow(/filled/i);
  });
});

describe("stop-loss / take-profit", () => {
  it("closes at the take-profit price even when the tick gaps past it", () => {
    engine.mark(SYMBOL, 50_000);
    engine.placeOrder({
      accountId: "demo",
      symbol: SYMBOL,
      side: "BUY",
      type: "MARKET",
      quantity: 1,
      takeProfit: 51_000,
    });
    engine.mark(SYMBOL, 52_000);

    expect(engine.getPositions()).toHaveLength(0);
    // A limit gets its price, not the gapped tick: +1000, not +2000.
    expect(engine.getAccount().balance).toBeCloseTo(101_000, 2);
  });

  it("closes at the tick price when a stop-loss gaps through", () => {
    engine.mark(SYMBOL, 50_000);
    engine.placeOrder({
      accountId: "demo",
      symbol: SYMBOL,
      side: "BUY",
      type: "MARKET",
      quantity: 1,
      stopLoss: 49_000,
    });
    engine.mark(SYMBOL, 48_500);

    expect(engine.getPositions()).toHaveLength(0);
    // Stops become market orders — the loss is the real one, −1500.
    expect(engine.getAccount().balance).toBeCloseTo(98_500, 2);
  });

  it("rejects moving a stop-loss to the wrong side of the market", () => {
    openLong();
    const pos = engine.getPositions()[0]!;
    expect(() => engine.modifyPosition(pos.id, { stopLoss: 60_000 })).toThrow(/Stop-loss/);
  });

  it("accepts a valid stop-loss move", () => {
    openLong();
    const pos = engine.getPositions()[0]!;
    const updated = engine.modifyPosition(pos.id, { stopLoss: 49_000 });
    expect(updated.stopLoss).toBe(49_000);
  });
});

describe("closing positions", () => {
  it("realizes profit and frees the margin", () => {
    openLong(1, 50_000);
    engine.mark(SYMBOL, 51_000);
    const pos = engine.getPositions()[0]!;
    engine.closePosition(pos.id);

    const account = engine.getAccount();
    expect(account.balance).toBeCloseTo(101_000, 2);
    expect(account.margin).toBe(0);
    expect(account.freeMargin).toBeCloseTo(101_000, 2);
  });

  it("releases margin proportionally on a partial close", () => {
    openLong(4, 50_000); // $2000 margin
    const pos = engine.getPositions()[0]!;
    engine.closePosition(pos.id, 1);

    const [remaining] = engine.getPositions();
    expect(remaining?.quantity).toBe(3);
    // 3 of 4 units left → three quarters of the margin, not all of it.
    expect(engine.getAccount().margin).toBeCloseTo(1500, 2);
  });

  it("clamps an oversized close to the position size", () => {
    openLong(1, 50_000);
    const pos = engine.getPositions()[0]!;
    engine.closePosition(pos.id, 99);
    expect(engine.getPositions()).toHaveLength(0);
  });

  it.each([0, -5, Number.NaN])("rejects close quantity %p", (qty) => {
    openLong(1, 50_000);
    const pos = engine.getPositions()[0]!;
    expect(() => engine.closePosition(pos.id, qty as number)).toThrow(/quantity/i);
    expect(engine.getPositions()).toHaveLength(1);
  });

  it("throws for an unknown position", () => {
    expect(() => engine.closePosition("nope")).toThrow(/not found/i);
  });

  it("closes every position at once", () => {
    engine.mark(SYMBOL, 50_000);
    engine.placeOrder({
      accountId: "demo",
      symbol: SYMBOL,
      side: "BUY",
      type: "MARKET",
      quantity: 1,
    });
    engine.mark("ETHUSD", 3_000);
    engine.placeOrder({
      accountId: "demo",
      symbol: "ETHUSD",
      side: "SELL",
      type: "MARKET",
      quantity: 1,
    });

    engine.closeAllPositions();
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getAccount().margin).toBe(0);
  });

  it("records a short's profit when price falls", () => {
    engine.mark(SYMBOL, 50_000);
    engine.placeOrder({
      accountId: "demo",
      symbol: SYMBOL,
      side: "SELL",
      type: "MARKET",
      quantity: 1,
    });
    engine.mark(SYMBOL, 49_000);
    engine.closePosition(engine.getPositions()[0]!.id);
    expect(engine.getAccount().balance).toBeCloseTo(101_000, 2);
  });
});

describe("account arithmetic", () => {
  it("keeps the balance at cent precision across many closes", () => {
    for (let i = 0; i < 20; i += 1) {
      engine.mark(SYMBOL, 50_000);
      engine.placeOrder({
        accountId: "demo",
        symbol: SYMBOL,
        side: "BUY",
        type: "MARKET",
        quantity: 0.1,
      });
      engine.mark(SYMBOL, 50_000.33);
      engine.closePosition(engine.getPositions()[0]!.id);
    }
    const balance = engine.getAccount().balance;
    expect(Number(balance.toFixed(2))).toBe(balance);
  });

  it("marks equity to market without touching the balance", () => {
    openLong(1, 50_000);
    engine.mark(SYMBOL, 50_500);
    const account = engine.getAccount();
    expect(account.balance).toBe(100_000);
    expect(account.equity).toBeCloseTo(100_500, 2);
  });

  it("ignores a non-finite mark price", () => {
    openLong(1, 50_000);
    engine.mark(SYMBOL, Number.NaN);
    expect(engine.getAccount().equity).toBeCloseTo(100_000, 2);
  });

  it("summarises closed trades", () => {
    openLong(1, 50_000);
    engine.mark(SYMBOL, 51_000);
    engine.closePosition(engine.getPositions()[0]!.id);

    const summary = engine.getClosedPositionsSummary();
    expect(summary.trades).toBe(1);
    expect(summary.wins).toBe(1);
    expect(summary.realizedPnl).toBeCloseTo(1000, 2);
  });
});

describe("read models", () => {
  it("hands out copies so callers cannot mutate engine state", () => {
    openLong(1, 50_000);
    const positions = engine.getPositions();
    positions[0]!.quantity = 999;
    expect(engine.getPositions()[0]?.quantity).toBe(1);
  });
});

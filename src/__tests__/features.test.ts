import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { subscribeChannel, __resetBus } from "@/services/demo/bus";
import * as replay from "@/services/replay";
import * as engine from "@/services/demo/engine";
import { safeStorage } from "@/lib/safe-storage";
import { toLocalDateString } from "@/lib/utils";

const ACCOUNT = "demo-account";

beforeEach(() => {
  engine.__resetForTests();
  replay.__resetReplay();
  __resetBus();
  safeStorage.removeItem("oc_journal_entries");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trade journal persistence", () => {
  it("starts empty", async () => {
    await expect(api.getJournalEntries(ACCOUNT)).resolves.toEqual({ entries: [], total: 0 });
  });

  it("round-trips an entry", async () => {
    const created = await api.createJournalEntry({
      accountId: ACCOUNT,
      symbolName: "BTCUSD",
      notes: "Took the breakout",
      tags: ["breakout"],
      rating: 4,
    });
    expect(created.id).toBeTruthy();

    const { entries, total } = await api.getJournalEntries(ACCOUNT);
    expect(total).toBe(1);
    expect(entries[0]).toMatchObject({
      symbolName: "BTCUSD",
      notes: "Took the breakout",
      tags: ["breakout"],
      rating: 4,
    });
  });

  it("survives a reload — entries live in storage, not memory", async () => {
    await api.createJournalEntry({ accountId: ACCOUNT, notes: "persisted" });
    const raw = safeStorage.getItem("oc_journal_entries");
    expect(raw).toContain("persisted");
  });

  it("keeps entries newest-first", async () => {
    await api.createJournalEntry({ accountId: ACCOUNT, notes: "first" });
    await api.createJournalEntry({ accountId: ACCOUNT, notes: "second" });
    const { entries } = await api.getJournalEntries(ACCOUNT);
    expect(entries[0]?.notes).toBe("second");
  });

  it("updates an entry in place", async () => {
    const created = await api.createJournalEntry({ accountId: ACCOUNT, notes: "before" });
    const updated = await api.updateJournalEntry(created.id, { notes: "after", rating: 5 });
    expect(updated).toMatchObject({ notes: "after", rating: 5 });

    const { entries } = await api.getJournalEntries(ACCOUNT);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.notes).toBe("after");
  });

  it("returns null when updating an unknown entry", async () => {
    await expect(api.updateJournalEntry("nope", { notes: "x" })).resolves.toBeNull();
  });

  it("deletes an entry", async () => {
    const created = await api.createJournalEntry({ accountId: ACCOUNT, notes: "bye" });
    await api.deleteJournalEntry(created.id);
    await expect(api.getJournalEntries(ACCOUNT)).resolves.toEqual({ entries: [], total: 0 });
  });

  it("scopes entries to their account", async () => {
    await api.createJournalEntry({ accountId: ACCOUNT, notes: "mine" });
    await api.createJournalEntry({ accountId: "other", notes: "theirs" });
    const { entries, total } = await api.getJournalEntries(ACCOUNT);
    expect(total).toBe(1);
    expect(entries[0]?.notes).toBe("mine");
  });

  it("filters by symbol", async () => {
    await api.createJournalEntry({ accountId: ACCOUNT, symbolName: "BTCUSD", notes: "btc" });
    await api.createJournalEntry({ accountId: ACCOUNT, symbolName: "ETHUSD", notes: "eth" });
    const { entries } = await api.getJournalEntries(ACCOUNT, { symbol: "ETHUSD" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.notes).toBe("eth");
  });
});

describe("session replay", () => {
  const today = toLocalDateString();

  it("builds a session from the bundled 1m history", async () => {
    const session = await replay.getSession(today);
    expect(session.tickBuffer.length).toBeGreaterThan(0);
    expect(session.meta.primarySymbol).toBeTruthy();
    expect(session.meta.tickCount).toBe(session.tickBuffer.length);
  });

  it("returns bars in chronological order inside the requested day", async () => {
    const session = await replay.getSession(today);
    const start = new Date(`${today}T00:00:00`).getTime();
    const end = start + 24 * 60 * 60 * 1000;
    for (const bar of session.tickBuffer) {
      expect(bar.t).toBeGreaterThanOrEqual(start);
      expect(bar.t).toBeLessThan(end);
    }
    const times = session.tickBuffer.map((b: { t: number }) => b.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("reports an empty session for a day with no bundled history", async () => {
    const session = await replay.getSession("2001-01-01");
    expect(session.tickBuffer).toHaveLength(0);
    expect(session.meta.primarySymbol).toBeNull();
  });

  it("broadcasts transport changes the store already understands", async () => {
    const events: Array<{ eventType?: string; action?: string; speed?: number }> = [];
    subscribeChannel("market-data", (e) => events.push(e as never));

    await replay.start(today, 2);
    replay.pause();
    replay.resume();
    replay.setSpeed(5);
    replay.stop();

    const actions = events
      .filter((e) => e.eventType === "ReplayStateChanged")
      .map((e) => e.action);
    expect(actions).toEqual(["started", "paused", "resumed", "speed", "stopped"]);
    expect(events.find((e) => e.action === "speed")?.speed).toBe(5);
  });

  it("seeks to a timestamp and reports it back", async () => {
    await replay.start(today, 1);
    const target = Date.now() - 60_000;
    const result = replay.seek(new Date(target).toISOString());
    expect(Date.parse(result.cursorTimestamp)).toBe(target);
  });

  it("starts the cursor a short way in so the chart has bars to draw", async () => {
    const session = await replay.getSession(today);
    const events: Array<{ action?: string; cursorTimestamp?: number }> = [];
    subscribeChannel("market-data", (e) => events.push(e as never));

    await replay.start(today, 1);
    const started = events.find((e) => e.action === "started");
    const first = session.tickBuffer[0]!.t;
    const last = session.tickBuffer[session.tickBuffer.length - 1]!.t;
    expect(started?.cursorTimestamp).toBeGreaterThan(first);
    expect(started?.cursorTimestamp).toBeLessThan(last);
  });

  it("includes closed trades from the replayed window as markers", async () => {
    engine.mark("BTCUSD", 50_000);
    engine.placeOrder({
      accountId: ACCOUNT,
      symbol: "BTCUSD",
      side: "BUY",
      type: "MARKET",
      quantity: 1,
    });
    engine.mark("BTCUSD", 51_000);
    engine.closePosition(engine.getPositions()[0]!.id);

    const accountId = (await api.getMyAccounts())[0]!.id;
    const session = await replay.getSession(today, "BTCUSD", accountId);
    expect(session.tradeEvents.length).toBeGreaterThan(0);
    expect(session.tradeEvents[0]).toMatchObject({ type: "exit", symbolName: "BTCUSD" });
  });

  it("ignores transport calls with no active session", () => {
    expect(() => {
      replay.pause();
      replay.resume();
      replay.patchSession({ cursorTimestamp: Date.now() });
    }).not.toThrow();
  });
});

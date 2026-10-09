import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import type { EngineState } from "../engine/types.ts";
import type { ReplayJournalEntry, ReplaySession } from "../session-types.ts";
import { DEFAULT_TAG_LIBRARY } from "../session-types.ts";
import { createIdbRepository, createMemoryRepository, type ReplayRepository } from "./repository.ts";

function session(id: string, updatedAt: string): ReplaySession {
  return {
    id,
    accountId: `acc-${id}`,
    name: `Session ${id}`,
    symbol: "XAUUSD",
    startingBalance: 10_000,
    startTime: 1_700_000_000,
    cursorTime: 1_700_000_000,
    timeframe: "15m",
    spread: 0.3,
    commissionPerLotPerSide: 0,
    leverage: 100,
    stepUnit: "chart",
    status: "active",
    createdAt: updatedAt,
    updatedAt,
    summary: { balance: 10_000, equity: 10_000, netPnl: 0, tradeCount: 0 },
  };
}

const state: EngineState = {
  cursorTime: 1_700_000_900,
  lastClose: 1950.5,
  balance: 10_000,
  positions: [],
  orders: [],
  closedTrades: [],
};

function journal(id: string, sessionId: string): ReplayJournalEntry {
  return {
    id,
    accountId: `acc-${sessionId}`,
    sessionId,
    positionId: `pos-${id}`,
    tags: [],
    notes: "note",
    createdAt: "2026-01-01T00:00:00.000Z",
    setup: "Breakout",
    mistakes: ["FOMO entry"],
  };
}

let dbCounter = 0;
const implementations: [string, () => ReplayRepository][] = [
  ["memory", () => createMemoryRepository()],
  ["indexeddb", () => createIdbRepository(`test-db-${++dbCounter}`)],
];

describe.each(implementations)("ReplayRepository (%s)", (_name, make) => {
  let repo: ReplayRepository;
  beforeEach(() => {
    repo = make();
  });

  it("stores and lists sessions newest-updated first", async () => {
    await repo.putSession(session("a", "2026-01-01T00:00:00.000Z"));
    await repo.putSession(session("b", "2026-02-01T00:00:00.000Z"));
    const list = await repo.listSessions();
    expect(list.map((s) => s.id)).toEqual(["b", "a"]);
    expect(await repo.getSession("a")).toMatchObject({ name: "Session a" });
    expect(await repo.getSession("missing")).toBeNull();
  });

  it("round-trips engine state", async () => {
    expect(await repo.loadEngineState("a")).toBeNull();
    await repo.saveEngineState("a", state);
    expect(await repo.loadEngineState("a")).toEqual(state);
  });

  it("stores journal entries per session and deletes one", async () => {
    await repo.putJournal(journal("j1", "a"));
    await repo.putJournal(journal("j2", "a"));
    await repo.putJournal(journal("j3", "b"));
    expect((await repo.listJournal("a")).map((j) => j.id).sort()).toEqual(["j1", "j2"]);
    await repo.deleteJournal("j1");
    expect((await repo.listJournal("a")).map((j) => j.id)).toEqual(["j2"]);
  });

  it("cascades session deletion to engine state and journal only for that session", async () => {
    await repo.putSession(session("a", "2026-01-01T00:00:00.000Z"));
    await repo.putSession(session("b", "2026-01-01T00:00:00.000Z"));
    await repo.saveEngineState("a", state);
    await repo.saveEngineState("b", state);
    await repo.putJournal(journal("j1", "a"));
    await repo.putJournal(journal("j2", "b"));
    await repo.deleteSession("a");
    expect(await repo.getSession("a")).toBeNull();
    expect(await repo.loadEngineState("a")).toBeNull();
    expect(await repo.listJournal("a")).toEqual([]);
    expect(await repo.getSession("b")).not.toBeNull();
    expect(await repo.loadEngineState("b")).toEqual(state);
    expect(await repo.listJournal("b")).toHaveLength(1);
  });

  it("returns the default tag library until one is saved", async () => {
    expect(await repo.getTagLibrary()).toEqual(DEFAULT_TAG_LIBRARY);
    const custom = { setups: ["ICT"], mistakes: ["Late"] };
    await repo.saveTagLibrary(custom);
    expect(await repo.getTagLibrary()).toEqual(custom);
  });
});

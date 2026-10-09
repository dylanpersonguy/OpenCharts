import type { EngineState } from "../engine/types.ts";
import {
  DEFAULT_TAG_LIBRARY,
  type ReplayJournalEntry,
  type ReplaySession,
  type TagLibrary,
} from "../session-types.ts";
import { openDb, wrapDb, type Db, type StoreSpec } from "./idb.ts";

/**
 * Storage for backtesting sessions. Engine state (balance, open positions,
 * pending orders, closed trades, cursor) is one record per session; journal
 * entries are separate rows indexed by session.
 */
export interface ReplayRepository {
  listSessions(): Promise<ReplaySession[]>;
  getSession(id: string): Promise<ReplaySession | null>;
  putSession(session: ReplaySession): Promise<void>;
  /** Deletes the session plus its engine state and journal entries. */
  deleteSession(id: string): Promise<void>;
  loadEngineState(sessionId: string): Promise<EngineState | null>;
  saveEngineState(sessionId: string, state: EngineState): Promise<void>;
  listJournal(sessionId: string): Promise<ReplayJournalEntry[]>;
  putJournal(entry: ReplayJournalEntry): Promise<void>;
  deleteJournal(id: string): Promise<void>;
  getTagLibrary(): Promise<TagLibrary>;
  saveTagLibrary(library: TagLibrary): Promise<void>;
}

const DB_VERSION = 1;
const STORES: readonly StoreSpec[] = [
  { name: "sessions", keyPath: "id" },
  { name: "engineState", keyPath: "sessionId" },
  { name: "journal", keyPath: "id", indexes: [{ name: "sessionId", keyPath: "sessionId" }] },
  { name: "settings", keyPath: "key" },
];

interface EngineStateRow {
  sessionId: string;
  state: EngineState;
}

interface SettingRow<T> {
  key: string;
  value: T;
}

const byUpdatedDesc = (a: ReplaySession, b: ReplaySession) => b.updatedAt.localeCompare(a.updatedAt);

/** IndexedDB-backed repository (the app default). The database opens lazily on first use. */
export function createIdbRepository(dbName = "opencharts-replay"): ReplayRepository {
  let dbPromise: Promise<Db> | null = null;
  const db = () => (dbPromise ??= openDb(dbName, DB_VERSION, STORES).then(wrapDb));

  return {
    listSessions: async () => (await (await db()).getAll<ReplaySession>("sessions")).sort(byUpdatedDesc),
    getSession: async (id) => (await (await db()).get<ReplaySession>("sessions", id)) ?? null,
    putSession: async (session) => (await db()).put("sessions", session),
    deleteSession: async (id) =>
      (await db()).cascadeDelete(["sessions", "engineState"], [{ store: "journal", index: "sessionId" }], id),
    loadEngineState: async (sessionId) =>
      (await (await db()).get<EngineStateRow>("engineState", sessionId))?.state ?? null,
    saveEngineState: async (sessionId, state) =>
      (await db()).put<EngineStateRow>("engineState", { sessionId, state }),
    listJournal: async (sessionId) =>
      (await db()).getAllFromIndex<ReplayJournalEntry>("journal", "sessionId", sessionId),
    putJournal: async (entry) => (await db()).put("journal", entry),
    deleteJournal: async (id) => (await db()).delete("journal", id),
    getTagLibrary: async () =>
      (await (await db()).get<SettingRow<TagLibrary>>("settings", "tags"))?.value ?? DEFAULT_TAG_LIBRARY,
    saveTagLibrary: async (library) =>
      (await db()).put<SettingRow<TagLibrary>>("settings", { key: "tags", value: library }),
  };
}

/** In-memory repository for tests and environments without IndexedDB. */
export function createMemoryRepository(): ReplayRepository {
  let sessions = new Map<string, ReplaySession>();
  let states = new Map<string, EngineState>();
  let journal = new Map<string, ReplayJournalEntry>();
  let tags: TagLibrary = DEFAULT_TAG_LIBRARY;

  const without = <V>(map: Map<string, V>, drop: (key: string, value: V) => boolean) =>
    new Map([...map].filter(([k, v]) => !drop(k, v)));

  return {
    listSessions: async () => [...sessions.values()].sort(byUpdatedDesc),
    getSession: async (id) => sessions.get(id) ?? null,
    putSession: async (session) => {
      sessions = new Map(sessions).set(session.id, session);
    },
    deleteSession: async (id) => {
      sessions = without(sessions, (k) => k === id);
      states = without(states, (k) => k === id);
      journal = without(journal, (_k, v) => v.sessionId === id);
    },
    loadEngineState: async (sessionId) => states.get(sessionId) ?? null,
    saveEngineState: async (sessionId, state) => {
      states = new Map(states).set(sessionId, state);
    },
    listJournal: async (sessionId) => [...journal.values()].filter((j) => j.sessionId === sessionId),
    putJournal: async (entry) => {
      journal = new Map(journal).set(entry.id, entry);
    },
    deleteJournal: async (id) => {
      journal = without(journal, (k) => k === id);
    },
    getTagLibrary: async () => tags,
    saveTagLibrary: async (library) => {
      tags = library;
    },
  };
}

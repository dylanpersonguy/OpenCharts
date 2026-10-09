import { api } from "../api.ts";
import { createIdbRepository, createMemoryRepository, type ReplayRepository } from "./persistence/repository.ts";
import type { CreateSessionInput, ReplaySession } from "./session-types.ts";

/** App-wide repository; falls back to memory where IndexedDB is unavailable. */
export const replayRepository: ReplayRepository =
  typeof indexedDB === "undefined" ? createMemoryRepository() : createIdbRepository();

/** Drawing-list key prefix for a session (drawings live in localStorage per symbol key). */
export const drawingsScope = (sessionId: string) => `replay:${sessionId}:`;

export const MIN_STARTING_BALANCE = 100;
export const MAX_STARTING_BALANCE = 100_000_000;

/** Validate user input for a new session; returns an error message or null. */
export function validateSessionInput(input: CreateSessionInput, dataStart: number, dataEnd: number): string | null {
  if (input.name.trim().length === 0) return "Give the session a name.";
  if (input.name.trim().length > 80) return "Keep the name under 80 characters.";
  if (!Number.isFinite(input.startingBalance) || input.startingBalance < MIN_STARTING_BALANCE) {
    return `Starting balance must be at least ${MIN_STARTING_BALANCE}.`;
  }
  if (input.startingBalance > MAX_STARTING_BALANCE) return "Starting balance is too large.";
  if (!Number.isFinite(input.spread) || input.spread < 0) return "Spread can't be negative.";
  if (!Number.isFinite(input.commissionPerLotPerSide) || input.commissionPerLotPerSide < 0) {
    return "Commission can't be negative.";
  }
  if (!Number.isFinite(input.leverage) || input.leverage < 1 || input.leverage > 1000) {
    return "Leverage must be between 1 and 1000.";
  }
  if (input.startTime < dataStart || input.startTime > dataEnd) return "Pick a start date inside the available history.";
  return null;
}

/** Build a new session record (pure). */
export function newSession(input: CreateSessionInput, now: Date, newId: () => string = () => crypto.randomUUID()): ReplaySession {
  const ts = now.toISOString();
  return {
    id: newId(),
    accountId: newId(),
    name: input.name.trim(),
    symbol: input.symbol,
    startingBalance: input.startingBalance,
    startTime: input.startTime,
    cursorTime: input.startTime,
    timeframe: input.timeframe,
    spread: input.spread,
    commissionPerLotPerSide: input.commissionPerLotPerSide,
    leverage: input.leverage,
    stepUnit: "chart",
    status: "active",
    createdAt: ts,
    updatedAt: ts,
    summary: { balance: input.startingBalance, equity: input.startingBalance, netPnl: 0, tradeCount: 0 },
  };
}

export async function createSession(input: CreateSessionInput): Promise<ReplaySession> {
  const session = newSession(input, new Date());
  await replayRepository.putSession(session);
  return session;
}

/** Delete a session with its engine state, journal and chart drawings. */
export async function deleteSession(sessionId: string): Promise<void> {
  await replayRepository.deleteSession(sessionId);
  await api.chartDrawings.clearScope(drawingsScope(sessionId));
}

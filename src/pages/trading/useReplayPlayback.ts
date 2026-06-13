import { useEffect, useRef } from "react";
import { useTradingStore } from "../../services/store.tsx";
import { useReplaySession } from "../../services/queries.ts";
import { accountsApi } from "../../services/api/accounts.ts";

/**
 * Maximum candles advanced per rAF frame when catching up (e.g. after seek).
 * Prevents blocking the main thread on high-speed or large-jump scenarios.
 */
const MAX_TICKS_PER_FRAME = 10;

/** How often to push replayCursorTimestamp to the Zustand store (ms). */
const STORE_SYNC_MS = 250;

/** How often to PATCH the server with the current cursor position (ms). */
const SERVER_SYNC_MS = 2000;

type TickBar = { t: number; o: number; h: number; l: number; c: number; v: number };

type MutableRef<T> = { current: T };

/** Advance the tick index up to the cursor, chunked to MAX_TICKS_PER_FRAME. */
function advanceTickIndex(buf: TickBar[], idxRef: MutableRef<number>, cursorMs: number): void {
  let chunk = 0;
  while (
    idxRef.current < buf.length &&
    (buf[idxRef.current]?.t ?? Infinity) <= cursorMs &&
    chunk < MAX_TICKS_PER_FRAME
  ) {
    idxRef.current++;
    chunk++;
  }
}

/** Throttled store write (drives scrubber + HUD timestamp). */
function syncCursorToStore(now: number, lastSyncRef: MutableRef<number>, cursorMs: number): void {
  if (now - lastSyncRef.current < STORE_SYNC_MS) return;
  useTradingStore.setState({ replayCursorTimestamp: cursorMs });
  lastSyncRef.current = now;
}

/** Throttled server PATCH so the cursor survives a reload. */
function syncCursorToServer(
  now: number,
  lastSyncRef: MutableRef<number>,
  accountId: string,
  sessionDate: string | null,
  cursorMs: number,
): void {
  if (now - lastSyncRef.current < SERVER_SYNC_MS || !sessionDate) return;
  lastSyncRef.current = now;
  accountsApi
    .replayPatchSession(accountId, { sessionDate, cursorTimestamp: cursorMs })
    .catch(() => null);
}

/**
 * End-of-buffer transition: pin the cursor, stop the server session (so it
 * doesn't sit in PLAYING until the TTL reaper catches it) and flip the store.
 */
function finishReplay(accountId: string, sessionDate: string | null, endMs: number): void {
  useTradingStore.setState({ replayCursorTimestamp: endMs });
  if (sessionDate) {
    accountsApi.replayStop(accountId, sessionDate).catch(() => null);
  }
  useTradingStore.getState().onReplayStateChanged("stopped");
}

/**
 * Drives the client-side replay clock using requestAnimationFrame.
 *
 * - Advances replayCursorTimestamp at replaySpeed × real time.
 * - Throttles Zustand writes to STORE_SYNC_MS to avoid per-frame re-renders.
 * - Debounces server PATCH to SERVER_SYNC_MS for cursor persistence.
 * - Advances up to MAX_TICKS_PER_FRAME tick indices per frame (chunked).
 * - Detects external seeks by comparing store cursor to local cursor ref.
 * - Auto-stops and emits "stopped" when the cursor reaches the end of the buffer.
 */
export function useReplayPlayback(accountId: string) {
  const isReplaying = useTradingStore((s) => s.isReplaying);
  const replayPaused = useTradingStore((s) => s.replayPaused);
  const replaySpeed = useTradingStore((s) => s.replaySpeed);
  const replayCursorTimestamp = useTradingStore((s) => s.replayCursorTimestamp);
  const replaySessionDate = useTradingStore((s) => s.replaySessionDate);

  const { data: sessionData } = useReplaySession(isReplaying ? accountId : null, replaySessionDate);

  // ── Stable refs (no re-render on change) ────────────────
  const speedRef = useRef(replaySpeed);
  const sessionDateRef = useRef(replaySessionDate);
  const tickBufferRef = useRef<TickBar[]>([]);
  const nextTickIdxRef = useRef(0);
  const localCursorMsRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const lastStoreSyncRef = useRef(0);
  const lastServerSyncRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);
  const isActiveRef = useRef(false);

  // Keep speed + sessionDate refs current without restarting the loop
  useEffect(() => {
    speedRef.current = replaySpeed;
  }, [replaySpeed]);
  useEffect(() => {
    sessionDateRef.current = replaySessionDate;
  }, [replaySessionDate]);

  // Reset playback position whenever a replay session (re)starts. Without this
  // the local cursor/index refs survive a stop, so replaying the same day
  // resumed from the previous end-of-buffer and auto-stopped immediately.
  useEffect(() => {
    if (isReplaying) {
      localCursorMsRef.current = null;
      nextTickIdxRef.current = 0;
    }
  }, [isReplaying]);

  // Sync tick buffer ref when session data loads
  useEffect(() => {
    if (sessionData?.tickBuffer) {
      tickBufferRef.current = sessionData.tickBuffer;
    }
  }, [sessionData]);

  // Detect external seeks: if the store cursor diverges from our local cursor
  // by more than 1s, accept the new position and recompute the tick index.
  useEffect(() => {
    if (replayCursorTimestamp == null) return;
    const local = localCursorMsRef.current;
    if (local == null || Math.abs(replayCursorTimestamp - local) > 1000) {
      localCursorMsRef.current = replayCursorTimestamp;
      // Recompute tick index after seek
      const buf = tickBufferRef.current;
      let idx = 0;
      while (idx < buf.length && (buf[idx]?.t ?? Infinity) <= replayCursorTimestamp) idx++;
      nextTickIdxRef.current = idx;
    }
  }, [replayCursorTimestamp]);

  // ── rAF playback loop ────────────────────────────────────
  useEffect(() => {
    if (!isReplaying || replayPaused) {
      isActiveRef.current = false;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      lastFrameTimeRef.current = null;
      return;
    }

    isActiveRef.current = true;
    lastFrameTimeRef.current = null;

    // One playback step; returns false when the loop must stop scheduling.
    const step = (now: number): boolean => {
      // Bootstrap frame time on first tick after play/resume
      if (lastFrameTimeRef.current === null) {
        lastFrameTimeRef.current = now;
        return true;
      }

      // Cap real delta to 100ms to handle tab-switch gaps gracefully
      const realDeltaMs = Math.min(now - lastFrameTimeRef.current, 100);
      lastFrameTimeRef.current = now;
      const replayDeltaMs = realDeltaMs * speedRef.current;

      const buf = tickBufferRef.current;
      if (buf.length === 0) return true; // session data still loading

      const endMs = buf[buf.length - 1]!.t;
      // Initialise cursor to buffer start on the first frame of a session
      const prevCursorMs = localCursorMsRef.current ?? buf[0]!.t;
      const newCursorMs = Math.min(prevCursorMs + replayDeltaMs, endMs);
      localCursorMsRef.current = newCursorMs;

      advanceTickIndex(buf, nextTickIdxRef, newCursorMs);
      syncCursorToStore(now, lastStoreSyncRef, newCursorMs);
      syncCursorToServer(now, lastServerSyncRef, accountId, sessionDateRef.current, newCursorMs);

      // Auto-stop at end of buffer
      if (newCursorMs >= endMs) {
        isActiveRef.current = false;
        finishReplay(accountId, sessionDateRef.current, endMs);
        return false;
      }
      return true;
    };

    const frame = (now: number) => {
      if (!isActiveRef.current) return;
      if (step(now)) rafIdRef.current = requestAnimationFrame(frame);
    };

    rafIdRef.current = requestAnimationFrame(frame);

    return () => {
      isActiveRef.current = false;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isReplaying, replayPaused, accountId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isActiveRef.current = false;
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);
}

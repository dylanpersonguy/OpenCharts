import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { vi } from "vitest";
import { encodeChunk, type HistoryManifest, type RawBar } from "./data/codec.ts";
import { openReplaySession, type ReplayController } from "./controller.ts";
import { createMemoryRepository, type ReplayRepository } from "./persistence/repository.ts";
import { newSession } from "./sessions.ts";
import { useReplayStore } from "./store.ts";
import { resetReplayBackends } from "../demo/replay-router.ts";

const T0 = Date.UTC(2024, 0, 1) / 1000;
const BAR = 900;
const COUNT = 60 * 96; // 60 days of 15m bars

function fixtureBars(): RawBar[] {
  return Array.from({ length: COUNT }, (_, i) => {
    const close = 40_000 + i;
    return { time: T0 + i * BAR, open: close - 0.5, high: close + 5, low: close - 5, close, volume: 1 };
  });
}

const bars = fixtureBars();
const last = bars[bars.length - 1] as RawBar;
const manifest: HistoryManifest = {
  version: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  baseTimeframe: "15m",
  symbols: {
    BTCUSD: {
      priceScale: 100,
      source: "binance",
      priceType: "last",
      from: T0,
      to: Date.UTC(2025, 0, 10) / 1000,
      chunks: [
        { year: 2024, file: "BTCUSD/2024.bin", count: COUNT, from: T0, to: last.time },
        // Listed but not served: lets a test make a data load fail.
        { year: 2025, file: "BTCUSD/2025.bin", count: 10, from: Date.UTC(2025, 0, 1) / 1000, to: Date.UTC(2025, 0, 10) / 1000 },
      ],
    },
  },
};

beforeAll(() => {
  const chunk = encodeChunk(bars, 100);
  vi.stubGlobal("fetch", async (url: string) =>
    url.endsWith("BTCUSD/2024.bin")
      ? new Response(chunk.slice().buffer as ArrayBuffer)
      : new Response("missing", { status: 404 }),
  );
});
afterAll(() => vi.unstubAllGlobals());

let controller: ReplayController | null = null;
afterEach(async () => {
  await controller?.dispose();
  controller = null;
  resetReplayBackends();
});

async function open(repo: ReplayRepository, startTime = T0 + 30 * 86_400) {
  let n = 0;
  const session = newSession(
    {
      name: "test",
      symbol: "BTCUSD",
      startingBalance: 10_000,
      startTime,
      timeframe: "15m",
      spread: 10,
      commissionPerLotPerSide: 0,
      leverage: 100,
    },
    new Date("2026-01-01T00:00:00Z"),
    () => `00000000-0000-4000-8000-00000000000${n++}`,
  );
  await repo.putSession(session);
  controller = await openReplaySession(session.id, { repository: repo, manifest, invalidateAccount: () => {} });
  return { session, controller };
}

describe("replay controller", () => {
  it("steps one 15m bar and persists the cursor", async () => {
    const repo = createMemoryRepository();
    const { session, controller: c } = await open(repo);
    const start = useReplayStore.getState().cursorTime as number;
    expect(await c.step()).toBe(true);
    expect(useReplayStore.getState().cursorTime).toBe(start + BAR);
    await c.pause();
    await vi.waitFor(async () => expect((await repo.getSession(session.id))?.cursorTime).toBe(start + BAR));
  });

  it("serializes a step racing a backward jump: the jump wins cleanly", async () => {
    const repo = createMemoryRepository();
    const { controller: c } = await open(repo);
    const target = T0 + 10 * 86_400;
    const stepping = c.step();
    const jumping = c.jumpTo(target);
    await Promise.all([stepping, jumping]);
    const s = useReplayStore.getState();
    expect(s.cursorTime).toBe(target);
    expect(s.tick?.bid).toBe(40_000 + (target - T0) / BAR);
    // The window ends exactly at the cursor (no stale bars folded in after the jump).
    expect(s.bars[s.bars.length - 1]?.time).toBe(target);
    expect(s.busy).toBe(false);
    expect(s.error).toBeNull();
  });

  it("recovers from a failed data load: error shown, not stuck busy, still steps", async () => {
    const repo = createMemoryRepository();
    const { controller: c } = await open(repo);
    const before = useReplayStore.getState().cursorTime as number;
    await c.jumpTo(Date.UTC(2025, 0, 5) / 1000); // chunk 2025 is not served → load fails
    const s = useReplayStore.getState();
    expect(s.error).toMatch(/2025/);
    expect(s.busy).toBe(false);
    expect(s.cursorTime).toBe(before);
    expect(await c.step()).toBe(true);
    expect(useReplayStore.getState().cursorTime).toBe(before + BAR);
  });

  it("writes nothing after dispose, even with a step in flight", async () => {
    const repo = createMemoryRepository();
    const { session, controller: c } = await open(repo);
    const stepping = c.step();
    await c.dispose();
    controller = null;
    await stepping;
    const saved = await repo.getSession(session.id);
    const afterDispose = saved?.updatedAt;
    await new Promise((r) => setTimeout(r, 1_200)); // past the debounced cursor save
    expect((await repo.getSession(session.id))?.updatedAt).toBe(afterDispose);
    expect(saved?.cursorTime).toBe((await repo.loadEngineState(session.id))?.cursorTime);
  });
});

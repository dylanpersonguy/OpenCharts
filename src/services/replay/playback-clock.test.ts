import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPlaybackClock } from "./playback-clock.ts";

describe("createPlaybackClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("steps at the configured rate while playing", () => {
    const onStep = vi.fn(() => true);
    const clock = createPlaybackClock({ stepsPerSecond: 2, onStep });
    clock.play();
    expect(clock.isPlaying()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(onStep).toHaveBeenCalledTimes(2);
    clock.pause();
    vi.advanceTimersByTime(5000);
    expect(onStep).toHaveBeenCalledTimes(2);
    expect(clock.isPlaying()).toBe(false);
  });

  it("changes speed without restarting from scratch", () => {
    const onStep = vi.fn(() => true);
    const clock = createPlaybackClock({ stepsPerSecond: 1, onStep });
    clock.play();
    clock.setSpeed(10);
    vi.advanceTimersByTime(1000);
    expect(onStep).toHaveBeenCalledTimes(10);
    expect(clock.isPlaying()).toBe(true);
    clock.dispose();
  });

  it("stops itself when onStep reports the end of data", () => {
    let remaining = 3;
    const onEnd = vi.fn();
    const clock = createPlaybackClock({ stepsPerSecond: 10, onStep: () => --remaining > 0, onEnd });
    clock.play();
    vi.advanceTimersByTime(2000);
    expect(remaining).toBe(0);
    expect(clock.isPlaying()).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ignores play while already playing and dispose stops it", () => {
    const onStep = vi.fn(() => true);
    const clock = createPlaybackClock({ stepsPerSecond: 1, onStep });
    clock.play();
    clock.play();
    vi.advanceTimersByTime(1000);
    expect(onStep).toHaveBeenCalledTimes(1);
    clock.dispose();
    vi.advanceTimersByTime(3000);
    expect(onStep).toHaveBeenCalledTimes(1);
  });
});

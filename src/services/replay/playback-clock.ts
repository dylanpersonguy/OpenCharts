/** Speeds offered in the replay controls, in steps per second. */
export const PLAYBACK_SPEEDS = [0.5, 1, 2, 3, 5, 10, 20] as const;

export interface PlaybackClockOptions {
  stepsPerSecond: number;
  /** Advance one step; return false when there is no more data. */
  onStep: () => boolean;
  /** Called once when playback stops because onStep returned false. */
  onEnd?: () => void;
  scheduler?: {
    setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
    clearInterval: (id: ReturnType<typeof setInterval>) => void;
  };
}

export interface PlaybackClock {
  play(): void;
  pause(): void;
  setSpeed(stepsPerSecond: number): void;
  isPlaying(): boolean;
  dispose(): void;
}

/** Interval-driven auto-step for replay "play" mode. */
export function createPlaybackClock(opts: PlaybackClockOptions): PlaybackClock {
  const scheduler = opts.scheduler ?? {
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
  };
  let speed = opts.stepsPerSecond;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (timer !== null) scheduler.clearInterval(timer);
    timer = null;
  };

  const tick = () => {
    if (opts.onStep()) return;
    stop();
    opts.onEnd?.();
  };

  const start = () => {
    timer = scheduler.setInterval(tick, Math.max(10, 1000 / speed));
  };

  return {
    play: () => {
      if (timer === null) start();
    },
    pause: stop,
    setSpeed: (next) => {
      speed = next;
      if (timer !== null) {
        stop();
        start();
      }
    },
    isPlaying: () => timer !== null,
    dispose: stop,
  };
}

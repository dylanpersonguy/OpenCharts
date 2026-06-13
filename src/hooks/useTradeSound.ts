import { useCallback, useRef, useState } from "react";

const STORAGE_KEY = "tradeSoundMuted";

/**
 * Hook that manages a trade execution sound effect with mute/unmute toggle.
 * Mute preference is persisted in localStorage.
 *
 * The sound is generated programmatically using the Web Audio API —
 * a short, satisfying "cha-ching" tone (no external audio file needed).
 */
export function useTradeSound() {
  const [muted, setMuted] = useState(() => localStorage.getItem(STORAGE_KEY) === "true");
  const ctxRef = useRef<AudioContext | null>(null);

  const getCtx = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new AudioContext();
    }
    return ctxRef.current;
  }, []);

  /** Play the trade execution sound (unless muted). */
  const playTradeSound = useCallback(() => {
    if (muted) return;
    try {
      const ctx = getCtx();
      if (ctx.state === "suspended") ctx.resume();
      const now = ctx.currentTime;

      // --- Tone 1: short high blip ---
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.06);
      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc1.connect(gain1).connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.12);

      // --- Tone 2: confirmation chime ---
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1175, now + 0.08);
      gain2.gain.setValueAtTime(0.14, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc2.connect(gain2).connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.25);
    } catch {
      // Web Audio may not be available in all environments — fail silently
    }
  }, [muted, getCtx]);

  /** Toggle mute on/off and persist to localStorage. */
  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return { muted, toggleMute, playTradeSound } as const;
}

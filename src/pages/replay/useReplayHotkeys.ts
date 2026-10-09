import { useEffect, useRef } from "react";

export interface ReplayHotkeyHandlers {
  onStep: () => void;
  onTogglePlay: () => void;
}

/** True when the key event comes from somewhere the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Shift+→ steps forward, Shift+↓ toggles play/pause (TradingView's replay keys).
 * Ignored while typing, and when another handler (e.g. nudging a selected
 * drawing with Shift+Arrow) already consumed the event.
 */
export function useReplayHotkeys(handlers: ReplayHotkeyHandlers, enabled = true): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const action =
        e.key === "ArrowRight" ? () => ref.current.onStep() : e.key === "ArrowDown" ? () => ref.current.onTogglePlay() : null;
      if (!action) return;
      // Decide after the event finishes dispatching: listeners registered later
      // (the drawing manager nudging a selected drawing) may still claim it.
      const id = setTimeout(() => {
        timers.delete(id);
        if (!e.defaultPrevented) action();
      }, 0);
      timers.add(id);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      for (const id of timers) clearTimeout(id);
    };
  }, [enabled]);
}

import { useEffect, useRef, useState } from "react";

/* ══════════════════════════════════════════════════════════════
   Shared kit for terminal themes: scope management, money
   formatting and a reduced-motion-aware count-up.
   ══════════════════════════════════════════════════════════════ */

/**
 * Applies a dark theme's token scope class to <html> while mounted.
 * Removes any user "light" preference for the duration (these themes
 * are dark-only by design) and restores it on unmount.
 */
export function useDarkThemeScope(scopeClass: string): void {
  useEffect(() => {
    const root = document.documentElement;
    const hadLight = root.classList.contains("light");
    root.classList.remove("light");
    root.classList.add(scopeClass);
    return () => {
      root.classList.remove(scopeClass);
      if (hadLight) root.classList.add("light");
    };
  }, [scopeClass]);
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtUsd(value: number): string {
  return USD.format(value);
}

export function fmtSigned(value: number): string {
  return `${value >= 0 ? "+" : "−"}${USD.format(Math.abs(value))}`;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Expo-out count-up. Animates toward `value` whenever it changes. */
export function useCountUp(value: number, durationMs = 700): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion() || fromRef.current === value) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - 2 ** (-10 * t);
      setDisplay(from + (value - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, durationMs]);

  return display;
}

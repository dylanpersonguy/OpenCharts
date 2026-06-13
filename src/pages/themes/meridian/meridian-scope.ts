import { useEffect } from "react";

/**
 * Applies the Meridian token scope to <html> while a Meridian page is
 * mounted. Forces the light palette (the theme is light-only by design)
 * and restores the trader's prior dark/light preference on unmount.
 */
export function useMeridianScope(): void {
  useEffect(() => {
    const root = document.documentElement;
    const hadLight = root.classList.contains("light");
    root.classList.add("light", "meridian");
    return () => {
      root.classList.remove("meridian");
      if (!hadLight) root.classList.remove("light");
    };
  }, []);
}

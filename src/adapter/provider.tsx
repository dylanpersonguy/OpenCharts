import { useEffect, useMemo, useState, type ReactNode } from "react";
import { setAdapter } from "./registry.ts";
import type { OpenChartsAdapter } from "./types.ts";

/**
 * Installs an adapter for everything rendered inside it.
 *
 * ```tsx
 * <OpenChartsProvider adapter={myAdapter}>
 *   <TradingPage />
 * </OpenChartsProvider>
 * ```
 *
 * The adapter is installed during the first render rather than in an effect,
 * so children can fetch on mount without racing the provider.
 */
export function OpenChartsProvider({
  adapter,
  children,
  fallback = null,
}: {
  adapter: OpenChartsAdapter;
  children: ReactNode;
  /** Rendered until the adapter is installed. Rarely needed. */
  fallback?: ReactNode;
}) {
  const [installed, setInstalled] = useState<OpenChartsAdapter | null>(null);

  // Install synchronously on first render and whenever the adapter changes,
  // using the render-phase state-adjustment pattern rather than an effect.
  if (installed !== adapter) {
    setAdapter(adapter);
    setInstalled(adapter);
  }

  useEffect(() => {
    // Keep the registry pointing at this adapter for the lifetime of the tree,
    // and restore the previous one on unmount so tests and nested hosts do not
    // leak state into each other.
    const restore = setAdapter(adapter);
    return restore;
  }, [adapter]);

  const ready = useMemo(() => installed === adapter, [installed, adapter]);
  return <>{ready ? children : fallback}</>;
}

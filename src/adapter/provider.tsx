import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary.tsx";
import { MarketDataBridge } from "../components/MarketDataBridge.tsx";
import { ToastViewport } from "../components/ToastViewport.tsx";
import { TooltipProvider } from "../components/ui/tooltip.tsx";
import { cn } from "../lib/utils.ts";
import { useAuthStore, useTradingStore } from "../services/store.tsx";
import { wsClient } from "../services/ws.ts";
import { setAdapter } from "./registry.ts";
import type { OpenChartsAdapter } from "./types.ts";

/**
 * The OpenCharts runtime.
 *
 * ```tsx
 * <OpenChartsProvider adapter={myAdapter}>
 *   <Terminal />
 * </OpenChartsProvider>
 * ```
 *
 * That is the whole integration. The provider installs the adapter, opens the
 * market-data stream, loads instruments (and accounts, when the adapter trades),
 * and supplies everything the panels depend on — a query cache, tooltips, the
 * bridge that turns stream events into state, notifications and an error
 * boundary. None of it has to be assembled by the host.
 *
 * It also renders the `.opencharts` element every stylesheet rule is scoped
 * to, so the terminal's styles cannot leak onto the host page.
 */

export interface OpenChartsProviderProps {
  adapter: OpenChartsAdapter;
  children: ReactNode;
  /** Shown while the adapter's instruments and accounts load. */
  fallback?: ReactNode;
  /** Extra classes for the scoping element, e.g. to size it. */
  className?: string;
  style?: CSSProperties;
  /**
   * Use an existing TanStack Query client. By default the terminal keeps its
   * own, so its cache never mixes with the host application's.
   */
  queryClient?: QueryClient;
  /**
   * Render the built-in notifications. Turn off to route them into your own
   * notification system via `onNotification()`.
   */
  showNotifications?: boolean;
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 2, refetchOnWindowFocus: false, staleTime: 5_000 },
    },
  });
}

/** A minimal local session; identity belongs to the host application. */
const LOCAL_USER = {
  id: "local-user",
  email: "",
  firstName: "Trader",
  lastName: "",
  roles: ["trader"],
  status: "ACTIVE",
  createdAt: new Date(0).toISOString(),
};

type BootState = { status: "loading" } | { status: "ready" } | { status: "error"; error: Error };

/**
 * Connect the stream and load what every panel needs before rendering them.
 * Re-runs when the adapter changes.
 */
function useBoot(adapter: OpenChartsAdapter, attempt: number): BootState {
  const [state, setState] = useState<{ key: unknown; boot: BootState }>({
    key: null,
    boot: { status: "loading" },
  });
  const key = `${attempt}`;

  useEffect(() => {
    let cancelled = false;

    // The terminal gates trading behind a demo flag inherited from the
    // original platform; an installed adapter is a real session by definition.
    useAuthStore.setState({
      isDemo: false,
      user: LOCAL_USER as never,
      accessToken: "local",
    });

    wsClient.connect();

    const load = async () => {
      const { loadSymbols, loadAccounts } = useTradingStore.getState();
      await loadSymbols();
      if (adapter.trading) await loadAccounts();
    };

    load()
      .then(() => {
        if (!cancelled) setState({ key: adapter, boot: { status: "ready" } });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const error = err instanceof Error ? err : new Error(String(err));
        console.error("[opencharts] adapter failed to load", error);
        setState({ key: adapter, boot: { status: "error", error } });
      });

    return () => {
      cancelled = true;
      wsClient.disconnect();
    };
  }, [adapter, key]);

  // A boot result belongs to the adapter that produced it.
  return state.key === adapter ? state.boot : { status: "loading" };
}

function DefaultFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
      Loading OpenCharts…
    </div>
  );
}

function BootError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center"
    >
      <p className="text-sm font-semibold text-foreground">The market data adapter failed to load</p>
      <p className="max-w-md break-words text-xs text-muted-foreground">{error.message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-md border border-border px-3 py-1 text-xs text-foreground hover:bg-secondary"
      >
        Retry
      </button>
    </div>
  );
}

function Runtime({
  adapter,
  fallback,
  children,
}: {
  adapter: OpenChartsAdapter;
  fallback: ReactNode;
  children: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const boot = useBoot(adapter, attempt);

  if (boot.status === "error") {
    return <BootError error={boot.error} onRetry={() => setAttempt((n) => n + 1)} />;
  }
  if (boot.status === "loading") return <>{fallback}</>;
  return <>{children}</>;
}

export function OpenChartsProvider({
  adapter,
  children,
  fallback = <DefaultFallback />,
  className,
  style,
  queryClient,
  showNotifications = true,
}: OpenChartsProviderProps) {
  const [ownClient] = useState(createQueryClient);
  const client = queryClient ?? ownClient;

  // Install the adapter during render (the documented "adjust state when a
  // prop changes" pattern) so children never render against the wrong one.
  const [installed, setInstalled] = useState<OpenChartsAdapter | null>(null);
  if (installed !== adapter) {
    setAdapter(adapter);
    setInstalled(adapter);
  }

  useEffect(() => {
    // Restore whatever was installed before on unmount, so tests and nested
    // hosts never leak an adapter into each other.
    return setAdapter(adapter);
  }, [adapter]);

  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={300}>
        <div
          className={cn("opencharts", className)}
          style={{ position: "relative", height: "100%", width: "100%", ...style }}
        >
          {installed === adapter && (
            <>
              <MarketDataBridge />
              <ErrorBoundary>
                <Runtime adapter={adapter} fallback={fallback}>
                  {children}
                </Runtime>
              </ErrorBoundary>
              {showNotifications && <ToastViewport />}
            </>
          )}
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

/* eslint-disable react-refresh/only-export-components */
/**
 * useAsync - Generic async data fetching hook with loading/error states.
 * Provides consistent loading indicators and error handling across all pages.
 */
import { useState, useCallback, useEffect, useRef } from "react";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Hook for fetching data with loading/error states.
 * @param fetcher - Async function that returns data
 * @param deps - Dependencies that trigger a re-fetch
 * @param options - Configuration options
 */
export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  options: { autoRefreshMs?: number; skipInitial?: boolean } = {},
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!options.skipInitial);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      if (mountedRef.current) {
        setData(result);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        setError((err as { message?: string }).message || "An error occurred");
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    if (!options.skipInitial) {
      refresh();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh (stale data prevention)
  useEffect(() => {
    if (!options.autoRefreshMs) return;
    const timer = setInterval(refresh, options.autoRefreshMs);
    return () => clearInterval(timer);
  }, [refresh, options.autoRefreshMs]);

  return { data, loading, error, refresh };
}

/**
 * Loading spinner component for consistent loading states.
 */
export function LoadingSpinner({
  size = "md",
  label,
}: {
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const sizeClass = { sm: "h-4 w-4", md: "h-8 w-8", lg: "h-12 w-12" }[size];
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 p-8"
      role="status"
      aria-label={label || "Loading"}
    >
      <div
        className={`${sizeClass} animate-spin rounded-full border-2 border-muted border-t-accent`}
      />
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
    </div>
  );
}

/**
 * Empty state component for lists with no data.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center" role="status">
      {icon && <span className="text-4xl mb-4">{icon}</span>}
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1 max-w-md">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 text-sm font-medium bg-accent text-accent-foreground rounded-md hover:opacity-90"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * Error display component.
 */
export function ErrorDisplay({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center" role="alert">
      <span className="text-4xl mb-2">⚠️</span>
      <h3 className="text-lg font-semibold text-destructive">Something went wrong</h3>
      <p className="text-sm text-muted-foreground mt-1">{error}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-4 py-2 text-sm font-medium bg-accent text-accent-foreground rounded-md hover:opacity-90"
        >
          Try Again
        </button>
      )}
    </div>
  );
}

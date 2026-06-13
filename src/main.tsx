import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { MarketDataBridge } from "./components/MarketDataBridge.tsx";
import "./styles/global.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
});

// ═════════════════════════════════════════════════════════════════
// Chunk Loading Failure Handler
// ═════════════════════════════════════════════════════════════════
// When a user has an old version cached and we deploy a new version,
// lazy-loaded chunks (e.g. HistoryPage-old-hash.js) no longer exist.
// This handler detects chunk load failures and reloads the page once
// to fetch the fresh version. Prevents infinite reload loops.
// ═════════════════════════════════════════════════════════════════

const RELOAD_KEY = "vite_chunk_reload_attempted";
const RELOAD_EXPIRY_MS = 10_000; // 10 seconds

function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("ChunkLoadError") ||
    /Failed to fetch.*\.(js|css)/.test(message)
  );
}

function handleChunkLoadError(event: ErrorEvent | PromiseRejectionEvent) {
  const error = "error" in event ? event.error : event.reason;
  if (!isChunkLoadError(error)) return;

  // Check if we already reloaded recently
  const lastReload = sessionStorage.getItem(RELOAD_KEY);
  if (lastReload) {
    const elapsed = Date.now() - Number(lastReload);
    if (elapsed < RELOAD_EXPIRY_MS) {
      console.warn("[ChunkLoader] Reload loop detected, skipping auto-reload:", error);
      return;
    }
  }

  console.warn("[ChunkLoader] Chunk load failed, reloading page:", error);
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  window.location.reload();
}

window.addEventListener("error", handleChunkLoadError);
window.addEventListener("unhandledrejection", handleChunkLoadError);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <BrowserRouter>
          <MarketDataBridge />
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

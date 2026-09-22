import React from "react";
import ReactDOM from "react-dom/client";
import { safeSession } from "./lib/safe-storage.ts";
import { Root } from "./Root.tsx";
import "./styles/global.css";
import "./styles/app.css";

/** Entry point for the hosted demo. The app itself lives in Root.tsx. */

// ── Stale-deploy recovery ─────────────────────────────────────────
// After a deploy, a tab still running the old build requests lazy chunks whose
// hashes no longer exist. Reload once to pick up the new build; the session
// key stops a reload loop if the failure is something else.

const RELOAD_KEY = "vite_chunk_reload_attempted";
const RELOAD_EXPIRY_MS = 10_000;

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

  const lastReload = safeSession.getItem(RELOAD_KEY);
  if (lastReload && Date.now() - Number(lastReload) < RELOAD_EXPIRY_MS) {
    console.warn("[ChunkLoader] Reload loop detected, skipping auto-reload:", error);
    return;
  }

  console.warn("[ChunkLoader] Chunk load failed, reloading page:", error);
  safeSession.setItem(RELOAD_KEY, String(Date.now()));
  window.location.reload();
}

window.addEventListener("error", handleChunkLoadError);
window.addEventListener("unhandledrejection", handleChunkLoadError);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);

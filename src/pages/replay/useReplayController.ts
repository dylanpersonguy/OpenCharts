import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { HistoryManifest } from "../../services/replay/data/codec.ts";
import { openReplaySession, type ReplayController } from "../../services/replay/controller.ts";
import { replayRepository } from "../../services/replay/sessions.ts";

/**
 * Opens the replay session for the lifetime of the component and disposes it
 * (saving state) on unmount. StrictMode's double mount opens, disposes and
 * re-opens; the disposed instance is never exposed.
 */
export function useReplayController(sessionId: string | undefined, manifest: HistoryManifest | null | undefined) {
  const queryClient = useQueryClient();
  const [controller, setController] = useState<ReplayController | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !manifest) return;
    let cancelled = false;
    let opened: ReplayController | null = null;
    setError(null);
    openReplaySession(sessionId, {
      repository: replayRepository,
      manifest,
      invalidateAccount: (accountId) => {
        for (const key of ["positions", "orders", "closedPositions"]) {
          void queryClient.invalidateQueries({ queryKey: [key, accountId] });
        }
      },
    })
      .then((c) => {
        opened = c;
        if (cancelled) {
          void c.dispose();
          return;
        }
        setController(c);
        // Position/order caches may hold rows from a previous visit.
        void queryClient.invalidateQueries({ queryKey: ["positions"] });
        void queryClient.invalidateQueries({ queryKey: ["orders"] });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      setController(null);
      if (opened) void opened.dispose();
    };
  }, [sessionId, manifest, queryClient]);

  return { controller, error };
}

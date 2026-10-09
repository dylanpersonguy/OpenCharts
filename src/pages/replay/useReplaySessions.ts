import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loadManifest } from "../../services/replay/data/manifest.ts";
import { createSession, deleteSession, replayRepository } from "../../services/replay/sessions.ts";
import type { CreateSessionInput } from "../../services/replay/session-types.ts";

export const replayKeys = {
  manifest: ["replay", "manifest"] as const,
  sessions: ["replay", "sessions"] as const,
  session: (id: string) => ["replay", "session", id] as const,
  engineState: (id: string) => ["replay", "engineState", id] as const,
  journal: (sessionId: string) => ["replay", "journal", sessionId] as const,
  tags: ["replay", "tags"] as const,
};

/** History manifest; `null` means the history files haven't been downloaded yet. */
export function useHistoryManifest() {
  return useQuery({
    queryKey: replayKeys.manifest,
    queryFn: () => loadManifest(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useReplaySessions() {
  return useQuery({ queryKey: replayKeys.sessions, queryFn: () => replayRepository.listSessions() });
}

export function useReplaySession(id: string | undefined) {
  return useQuery({
    queryKey: replayKeys.session(id ?? ""),
    queryFn: () => replayRepository.getSession(id as string),
    enabled: !!id,
  });
}

export function useSessionEngineState(id: string | undefined) {
  return useQuery({
    queryKey: replayKeys.engineState(id ?? ""),
    queryFn: () => replayRepository.loadEngineState(id as string),
    enabled: !!id,
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSessionInput) => createSession(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: replayKeys.sessions }),
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: replayKeys.sessions }),
  });
}

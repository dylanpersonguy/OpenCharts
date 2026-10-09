import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { replayRepository } from "../../services/replay/sessions.ts";
import type { ReplayJournalEntry, TagLibrary } from "../../services/replay/session-types.ts";
import { replayKeys } from "./useReplaySessions.ts";

export function useReplayJournal(sessionId: string) {
  return useQuery({
    queryKey: replayKeys.journal(sessionId),
    queryFn: () => replayRepository.listJournal(sessionId),
  });
}

export function useSaveJournalEntry(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entry: ReplayJournalEntry) => replayRepository.putJournal(entry),
    onSuccess: () => qc.invalidateQueries({ queryKey: replayKeys.journal(sessionId) }),
  });
}

export function useDeleteJournalEntry(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => replayRepository.deleteJournal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: replayKeys.journal(sessionId) }),
  });
}

export function useTagLibrary() {
  return useQuery({ queryKey: replayKeys.tags, queryFn: () => replayRepository.getTagLibrary() });
}

export function useSaveTagLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (library: TagLibrary) => replayRepository.saveTagLibrary(library),
    onSuccess: () => qc.invalidateQueries({ queryKey: replayKeys.tags }),
  });
}

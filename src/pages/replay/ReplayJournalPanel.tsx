import { useMemo, useState } from "react";
import { BookCheck } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  EMPTY_JOURNAL_VALUES,
  JournalEntryForm,
  type JournalFormValues,
} from "../../components/trading-dialogs/JournalEntryForm.tsx";
import type { ClosedTrade } from "../../services/replay/engine/types.ts";
import { DEFAULT_TAG_LIBRARY, type ReplayJournalEntry } from "../../services/replay/session-types.ts";
import { useReplayStore } from "../../services/replay/store.ts";
import { toast } from "../../services/toast.ts";
import {
  useDeleteJournalEntry,
  useReplayJournal,
  useSaveJournalEntry,
  useSaveTagLibrary,
  useTagLibrary,
} from "./useReplayJournal.ts";

/** One row per position: partial closes merged. */
export interface JournalTradeRow {
  positionId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  entryTime: number;
  exitTime: number;
  exitReasons: string[];
  netPnl: number;
  rMultiple: number | null;
}

export function journalRows(trades: readonly ClosedTrade[]): JournalTradeRow[] {
  const byPosition = new Map<string, ClosedTrade[]>();
  for (const t of trades) byPosition.set(t.positionId, [...(byPosition.get(t.positionId) ?? []), t]);
  return [...byPosition.entries()]
    .map(([positionId, slices]) => {
      const first = slices[0] as ClosedTrade;
      const rs = slices.filter((s) => s.rMultiple !== null).map((s) => s.rMultiple as number);
      return {
        positionId,
        symbol: first.symbol,
        side: first.side,
        quantity: slices.reduce((q, s) => q + s.quantity, 0),
        entryPrice: first.entryPrice,
        entryTime: first.entryTime,
        exitTime: Math.max(...slices.map((s) => s.exitTime)),
        exitReasons: [...new Set(slices.map((s) => s.exitReason))],
        netPnl: slices.reduce((p, s) => p + s.netPnl, 0),
        rMultiple: rs.length ? rs.reduce((a, b) => a + b, 0) : null,
      };
    })
    .sort((a, b) => b.exitTime - a.exitTime);
}

const fmt = (sec: number) =>
  new Date(sec * 1000).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "short", timeStyle: "short" });

function toValues(e: ReplayJournalEntry | undefined): JournalFormValues {
  if (!e) return EMPTY_JOURNAL_VALUES;
  return {
    setup: e.setup ?? null,
    mistakes: e.mistakes ?? [],
    emotion: e.emotion ?? null,
    rating: e.rating ?? 0,
    tags: e.tags,
    notes: e.notes,
  };
}

/** Closed trades of the session with a journal form for the selected one. */
export function ReplayJournalPanel({ sessionId }: { sessionId: string }) {
  const closedTrades = useReplayStore((s) => s.closedTrades);
  const accountId = useReplayStore((s) => s.session?.accountId ?? "");
  const rows = useMemo(() => journalRows(closedTrades), [closedTrades]);
  const journal = useReplayJournal(sessionId);
  const tags = useTagLibrary();
  const saveEntry = useSaveJournalEntry(sessionId);
  const deleteEntry = useDeleteJournalEntry(sessionId);
  const saveTags = useSaveTagLibrary();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const entries = useMemo(() => new Map((journal.data ?? []).map((e) => [e.positionId, e])), [journal.data]);
  const library = tags.data ?? DEFAULT_TAG_LIBRARY;
  const selected = rows.find((r) => r.positionId === (selectedId ?? rows[0]?.positionId));
  const existing = selected ? entries.get(selected.positionId) : undefined;

  const addLabel = (kind: "setups" | "mistakes", label: string) => {
    if (library[kind].includes(label)) return;
    saveTags.mutate({ ...library, [kind]: [...library[kind], label] });
  };

  const save = (values: JournalFormValues) => {
    if (!selected) return;
    const now = new Date().toISOString();
    const entry: ReplayJournalEntry = {
      id: existing?.id ?? crypto.randomUUID(),
      accountId,
      sessionId,
      positionId: selected.positionId,
      symbolName: selected.symbol,
      side: selected.side === "LONG" ? "BUY" : "SELL",
      entryPrice: selected.entryPrice,
      pnl: selected.netPnl,
      emotion: values.emotion,
      rating: values.rating || null,
      setup: values.setup,
      mistakes: values.mistakes,
      tags: values.tags,
      notes: values.notes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    saveEntry.mutate(entry, {
      onSuccess: () => toast.success("Journal", "Entry saved"),
      onError: (e) => toast.error("Journal", e instanceof Error ? e.message : "Could not save"),
    });
  };

  if (rows.length === 0) {
    return <div className="p-4 text-xs text-muted-foreground">Closed trades appear here so you can journal them.</div>;
  }

  return (
    <div className="flex h-full min-h-0 text-xs">
      <div className="w-[46%] min-w-[260px] overflow-auto border-r border-border">
        <table className="w-full">
          <thead className="sticky top-0 bg-card text-[10px] text-muted-foreground">
            <tr className="text-left">
              <th className="px-2 py-1 font-normal">Closed</th>
              <th className="px-1 font-normal">Side</th>
              <th className="px-1 font-normal text-right">Net</th>
              <th className="px-1 font-normal text-right">R</th>
              <th className="px-1 font-normal">Exit</th>
              <th className="px-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.positionId}
                onClick={() => setSelectedId(r.positionId)}
                className={cn(
                  "cursor-pointer border-t border-border/50 hover:bg-secondary/50",
                  r.positionId === selected?.positionId && "bg-primary/10",
                )}
              >
                <td className="px-2 py-1 font-mono">{fmt(r.exitTime)}</td>
                <td className={cn("px-1", r.side === "LONG" ? "text-buy" : "text-sell")}>{r.side}</td>
                <td className={cn("px-1 text-right font-mono", r.netPnl >= 0 ? "text-buy" : "text-sell")}>
                  {formatCurrency(r.netPnl)}
                </td>
                <td className="px-1 text-right font-mono">{r.rMultiple === null ? "—" : r.rMultiple.toFixed(2)}</td>
                <td className="px-1">{r.exitReasons.join("/")}</td>
                <td className="px-1">
                  {entries.has(r.positionId) && <BookCheck className="h-3.5 w-3.5 text-primary" aria-label="Journaled" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {selected && (
          <>
            <div className="mb-2 text-[11px] text-muted-foreground">
              {selected.side} {selected.quantity} {selected.symbol} @ {selected.entryPrice} · opened {fmt(selected.entryTime)}
            </div>
            <JournalEntryForm
              key={selected.positionId + (existing?.updatedAt ?? "")}
              initial={toValues(existing)}
              setups={library.setups}
              mistakes={library.mistakes}
              saving={saveEntry.isPending}
              onAddSetup={(l) => addLabel("setups", l)}
              onAddMistake={(l) => addLabel("mistakes", l)}
              onSave={save}
              onDelete={existing ? () => deleteEntry.mutate(existing.id) : undefined}
            />
          </>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, BarChart3, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { toast } from "../../services/toast.ts";
import type { ReplaySession } from "../../services/replay/session-types.ts";
import { CreateSessionDialog } from "./CreateSessionDialog.tsx";
import { useCreateSession, useDeleteSession, useHistoryManifest, useReplaySessions } from "./useReplaySessions.ts";

const fmtDate = (sec: number) =>
  new Date(sec * 1000).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" });

function NoHistory() {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-border bg-card p-6 text-sm">
      <h2 className="font-semibold mb-2">No market history downloaded yet</h2>
      <p className="text-muted-foreground mb-3">
        Bar replay needs 15-minute history. Download BTCUSD once with:
      </p>
      <pre className="rounded-md bg-background border border-border px-3 py-2 font-mono text-xs">npm run fetch:history</pre>
      <p className="text-muted-foreground mt-3 mb-2">
        Gold (XAUUSD) is imported from 1-minute CSV files you download (histdata.com or Dukascopy) into{" "}
        <code className="font-mono">history-import/XAUUSD/</code>:
      </p>
      <pre className="rounded-md bg-background border border-border px-3 py-2 font-mono text-xs">npm run import:history -- --symbol XAUUSD</pre>
      <p className="text-muted-foreground mt-3 text-xs">Then reload this page. See the README for details.</p>
    </div>
  );
}

function SessionCard({ session, onDelete }: { session: ReplaySession; onDelete: () => void }) {
  const { summary } = session;
  const pct = session.startingBalance > 0 ? (summary.equity / session.startingBalance - 1) * 100 : 0;
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold truncate">{session.name}</h3>
          <p className="text-xs text-muted-foreground">
            {session.symbol} · {session.timeframe} · cursor {fmtDate(session.cursorTime)} UTC
          </p>
        </div>
        <span className={cn("font-mono text-sm font-semibold", pct >= 0 ? "text-buy" : "text-sell")}>
          {pct >= 0 ? "+" : ""}
          {pct.toFixed(2)}%
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Start" value={formatCurrency(session.startingBalance)} />
        <Stat label="Equity" value={formatCurrency(summary.equity)} />
        <Stat label="Trades" value={String(summary.tradeCount)} />
      </div>
      <div className="flex gap-2">
        <Button asChild size="sm" className="flex-1">
          <Link to={`/replay/${session.id}`}>
            <Play className="h-3.5 w-3.5 mr-1" /> Resume
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to={`/replay/${session.id}/stats`} aria-label="Session stats">
            <BarChart3 className="h-3.5 w-3.5" />
          </Link>
        </Button>
        <Button size="sm" variant="outline" onClick={onDelete} aria-label="Delete session">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-background/60 border border-border px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}

/** List, create, resume and delete backtesting sessions. */
export function ReplaySessionsPage() {
  const navigate = useNavigate();
  const manifest = useHistoryManifest();
  const sessions = useReplaySessions();
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ReplaySession | null>(null);

  const handleCreate = (input: Parameters<typeof createSession.mutate>[0]) =>
    createSession.mutate(input, {
      onSuccess: (s) => navigate(`/replay/${s.id}`),
      onError: (e) => toast.error("Could not create session", e instanceof Error ? e.message : String(e)),
    });

  const handleDelete = (s: ReplaySession) =>
    deleteSession.mutate(s.id, {
      onSuccess: () => setConfirmDelete(null),
      onError: (e) => toast.error("Could not delete session", e instanceof Error ? e.message : String(e)),
    });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button asChild size="sm" variant="ghost">
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-1" /> Live terminal
          </Link>
        </Button>
        <h1 className="text-sm font-semibold">Backtesting sessions</h1>
        <div className="flex-1" />
        {manifest.data && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1" /> New session
          </Button>
        )}
      </header>
      <main className="p-4">
        {manifest.isLoading || sessions.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !manifest.data ? (
          <NoHistory />
        ) : sessions.data?.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.data.map((s) => (
              <SessionCard key={s.id} session={s} onDelete={() => setConfirmDelete(s)} />
            ))}
          </div>
        ) : (
          <div className="mx-auto max-w-md text-center text-sm text-muted-foreground py-16">
            <p className="mb-3">No sessions yet. Create one to start replaying history bar by bar.</p>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4 mr-1" /> New session
            </Button>
          </div>
        )}
      </main>
      {creating && manifest.data && (
        <CreateSessionDialog
          manifest={manifest.data}
          submitting={createSession.isPending}
          onSubmit={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}
      {confirmDelete && (
        <>
          <div className="fixed inset-0 z-[70] bg-black/50" onClick={() => setConfirmDelete(null)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
            <div className="pointer-events-auto w-full max-w-sm rounded-xl border border-border bg-card p-5 text-sm">
              <p className="mb-4">
                Delete <strong>{confirmDelete.name}</strong>? Its trades, journal entries and drawings are removed
                permanently.
              </p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                  Cancel
                </Button>
                <Button size="sm" variant="destructive" loading={deleteSession.isPending} onClick={() => handleDelete(confirmDelete)}>
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

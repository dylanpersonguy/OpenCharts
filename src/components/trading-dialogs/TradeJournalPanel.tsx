import { useState } from "react";
import { cn, formatCurrency, formatNumber, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BookOpen, Star, Pencil, Trash2, Plus } from "lucide-react";

const EMOTIONS = [
  "Calm",
  "Confident",
  "Anxious",
  "Greedy",
  "Fearful",
  "FOMO",
  "Revenge",
  "Bored",
] as const;

interface JournalEntry {
  id: string;
  accountId: string;
  positionId?: string | null;
  symbolName?: string | null;
  side?: string | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  pnl?: number | null;
  emotion?: string | null;
  rating?: number | null;
  tags: string[];
  notes: string;
  createdAt: string;
}

interface TradeJournalPanelProps {
  entries: JournalEntry[];
  isLoading: boolean;
  accountId: string | null;
  onCreateEntry: (data: Partial<JournalEntry> & { notes: string; tags: string[] }) => void;
  onUpdateEntry: (
    id: string,
    data: Partial<JournalEntry> & { notes: string; tags: string[] },
  ) => void;
  onDeleteEntry: (id: string) => void;
}

export function TradeJournalPanel({
  entries,
  isLoading,
  accountId,
  onCreateEntry,
  onUpdateEntry,
  onDeleteEntry,
}: TradeJournalPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [symbolName, setSymbolName] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [entryPrice, setEntryPrice] = useState("");
  const [exitPrice, setExitPrice] = useState("");
  const [pnl, setPnl] = useState("");
  const [emotion, setEmotion] = useState("");
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");

  const resetForm = () => {
    setSymbolName("");
    setSide("BUY");
    setEntryPrice("");
    setExitPrice("");
    setPnl("");
    setEmotion("");
    setRating(0);
    setTags("");
    setNotes("");
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (entry: JournalEntry) => {
    setEditingId(entry.id);
    setSymbolName(entry.symbolName || "");
    setSide((entry.side as "BUY" | "SELL") || "BUY");
    setEntryPrice(entry.entryPrice != null ? String(entry.entryPrice) : "");
    setExitPrice(entry.exitPrice != null ? String(entry.exitPrice) : "");
    setPnl(entry.pnl != null ? String(entry.pnl) : "");
    setEmotion(entry.emotion || "");
    setRating(entry.rating || 0);
    setTags(entry.tags.join(", "));
    setNotes(entry.notes);
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!accountId) return;
    const data: Partial<JournalEntry> & { notes: string; tags: string[] } = {
      notes,
      emotion: emotion || undefined,
      rating: rating || undefined,
      tags: tags
        ? tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    };

    if (editingId) {
      onUpdateEntry(editingId, data);
    } else {
      data.accountId = accountId;
      data.symbolName = symbolName || undefined;
      data.side = side;
      data.entryPrice = entryPrice ? parseFloat(entryPrice) : undefined;
      data.exitPrice = exitPrice ? parseFloat(exitPrice) : undefined;
      data.pnl = pnl ? parseFloat(pnl) : undefined;
      onCreateEntry(data);
    }
    resetForm();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
        Loading journal...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <BookOpen className="h-3 w-3" />
          Trade Journal
        </h3>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-primary/10 text-primary hover:bg-primary/20"
        >
          <Plus className="h-3 w-3" /> New
        </button>
      </div>

      {showForm && (
        <div className="px-3 py-2 border-b border-border/50 bg-secondary/30 space-y-2 text-xs">
          {!editingId && (
            <>
              <div className="grid grid-cols-3 gap-1">
                <div className="col-span-2">
                  <label className="text-[10px] text-muted-foreground">Symbol</label>
                  <input
                    value={symbolName}
                    onChange={(e) => setSymbolName(e.target.value)}
                    className="w-full mt-0.5 text-xs"
                    placeholder="e.g. EURUSD"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Side</label>
                  <select
                    value={side}
                    onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}
                    className="w-full mt-0.5 text-xs"
                  >
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1">
                <div>
                  <label className="text-[10px] text-muted-foreground">Entry</label>
                  <input
                    type="number"
                    value={entryPrice}
                    onChange={(e) => setEntryPrice(e.target.value)}
                    className="w-full mt-0.5 text-xs font-mono"
                    step="0.00001"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Exit</label>
                  <input
                    type="number"
                    value={exitPrice}
                    onChange={(e) => setExitPrice(e.target.value)}
                    className="w-full mt-0.5 text-xs font-mono"
                    step="0.00001"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">P&L</label>
                  <input
                    type="number"
                    value={pnl}
                    onChange={(e) => setPnl(e.target.value)}
                    className="w-full mt-0.5 text-xs font-mono"
                  />
                </div>
              </div>
            </>
          )}
          <div>
            <label className="text-[10px] text-muted-foreground">Emotion</label>
            <div className="flex gap-1 flex-wrap mt-0.5">
              {EMOTIONS.map((em) => (
                <button
                  key={em}
                  onClick={() => setEmotion(emotion === em ? "" : em)}
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] border border-border",
                    emotion === em
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-secondary",
                  )}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Rating</label>
            <div className="flex gap-0.5 mt-0.5">
              {[1, 2, 3, 4, 5].map((r) => (
                <button
                  key={r}
                  onClick={() => setRating(rating === r ? 0 : r)}
                  className={cn(
                    "text-sm",
                    r <= rating ? "text-yellow-400" : "text-muted-foreground/30",
                  )}
                >
                  <Star className="h-3.5 w-3.5" fill={r <= rating ? "currentColor" : "none"} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Tags (comma-separated)</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full mt-0.5 text-xs"
              placeholder="e.g. breakout, trend"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full mt-0.5 text-xs min-h-[60px] resize-y"
              placeholder="What happened? What did you learn?"
            />
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="text-[10px] h-6" onClick={resetForm}>
              Cancel
            </Button>
            <Button size="sm" className="text-[10px] h-6" onClick={handleSubmit}>
              {editingId ? "Update" : "Save Entry"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2">
            <BookOpen className="h-8 w-8 opacity-30" />
            <span>No journal entries yet</span>
            <span className="text-[10px]">Click "New" to record your first trade</span>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {entries.map((entry) => (
              <div key={entry.id} className="px-3 py-2 hover:bg-secondary/30 group text-xs">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {entry.symbolName && <span className="font-semibold">{entry.symbolName}</span>}
                    {entry.side && (
                      <span
                        className={cn(
                          "text-[10px] font-medium",
                          entry.side === "BUY" ? "text-buy" : "text-sell",
                        )}
                      >
                        {entry.side}
                      </span>
                    )}
                    {entry.pnl != null && (
                      <span
                        className={cn(
                          "font-mono text-[10px] font-semibold",
                          entry.pnl >= 0 ? "text-buy" : "text-sell",
                        )}
                      >
                        {entry.pnl >= 0 ? "+" : ""}
                        {formatCurrency(entry.pnl)}
                      </span>
                    )}
                    {entry.emotion && (
                      <span className="px-1 py-0.5 rounded bg-accent/10 text-accent text-[9px]">
                        {entry.emotion}
                      </span>
                    )}
                    {entry.rating != null && entry.rating > 0 && (
                      <span className="text-yellow-400 text-[10px]">
                        {"★".repeat(entry.rating)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEdit(entry)}
                      className="p-0.5 rounded hover:bg-secondary"
                    >
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => onDeleteEntry(entry.id)}
                      className="p-0.5 rounded hover:bg-destructive/20"
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </button>
                  </div>
                </div>
                {entry.tags.length > 0 && (
                  <div className="flex gap-1 mb-1">
                    {entry.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1 py-0.5 rounded bg-secondary text-[9px] text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {entry.notes && (
                  <p className="text-[11px] text-foreground/80 leading-relaxed">{entry.notes}</p>
                )}
                <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                  {entry.entryPrice != null && (
                    <span>Entry: {formatNumber(entry.entryPrice, 5)}</span>
                  )}
                  {entry.exitPrice != null && <span>Exit: {formatNumber(entry.exitPrice, 5)}</span>}
                  <span>{formatDate(entry.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

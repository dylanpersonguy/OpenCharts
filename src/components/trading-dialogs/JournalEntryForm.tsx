import { useState } from "react";
import { Plus, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const EMOTIONS = ["Calm", "Confident", "Anxious", "Greedy", "Fearful", "FOMO", "Revenge", "Bored"] as const;

export interface JournalFormValues {
  setup: string | null;
  mistakes: string[];
  emotion: string | null;
  rating: number;
  tags: string[];
  notes: string;
}

export const EMPTY_JOURNAL_VALUES: JournalFormValues = {
  setup: null,
  mistakes: [],
  emotion: null,
  rating: 0,
  tags: [],
  notes: "",
};

interface JournalEntryFormProps {
  initial: JournalFormValues;
  setups: readonly string[];
  mistakes: readonly string[];
  saving?: boolean;
  onAddSetup: (label: string) => void;
  onAddMistake: (label: string) => void;
  onSave: (values: JournalFormValues) => void;
  onDelete?: () => void;
}

const chip = (active: boolean) =>
  cn(
    "px-1.5 py-0.5 rounded text-[10px] border",
    active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-secondary",
  );

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] text-muted-foreground mb-0.5">{children}</div>;
}

/** Inline "+ add" input for extending a tag list. */
function AddLabel({ onAdd }: { onAdd: (label: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  if (!open) {
    return (
      <button type="button" className={chip(false)} onClick={() => setOpen(true)} aria-label="Add label">
        <Plus className="h-2.5 w-2.5" />
      </button>
    );
  }
  const commit = () => {
    const label = value.trim();
    if (label) onAdd(label);
    setValue("");
    setOpen(false);
  };
  return (
    <input
      autoFocus
      value={value}
      maxLength={40}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") setOpen(false);
      }}
      className="h-5 w-28 rounded border border-border bg-background px-1 text-[10px]"
      placeholder="New label"
    />
  );
}

const toggle = (list: readonly string[], item: string) =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

/** Journal fields for one trade: setup, mistakes, emotion, rating, free tags and notes. */
export function JournalEntryForm({
  initial,
  setups,
  mistakes,
  saving,
  onAddSetup,
  onAddMistake,
  onSave,
  onDelete,
}: JournalEntryFormProps) {
  const [values, setValues] = useState<JournalFormValues>(initial);
  const [tagText, setTagText] = useState(initial.tags.join(", "));
  const patch = (p: Partial<JournalFormValues>) => setValues((v) => ({ ...v, ...p }));

  const save = () =>
    onSave({
      ...values,
      notes: values.notes.slice(0, 10_000),
      tags: tagText.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20),
    });

  return (
    <div className="space-y-2 text-xs">
      <div>
        <Label>Setup</Label>
        <div className="flex flex-wrap gap-1">
          {setups.map((s) => (
            <button type="button" key={s} className={chip(values.setup === s)} onClick={() => patch({ setup: values.setup === s ? null : s })}>
              {s}
            </button>
          ))}
          <AddLabel onAdd={(l) => (onAddSetup(l), patch({ setup: l }))} />
        </div>
      </div>
      <div>
        <Label>Mistakes</Label>
        <div className="flex flex-wrap gap-1">
          {mistakes.map((m) => (
            <button type="button" key={m} className={chip(values.mistakes.includes(m))} onClick={() => patch({ mistakes: toggle(values.mistakes, m) })}>
              {m}
            </button>
          ))}
          <AddLabel onAdd={(l) => (onAddMistake(l), patch({ mistakes: [...values.mistakes, l] }))} />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <div>
          <Label>Emotion</Label>
          <div className="flex flex-wrap gap-1">
            {EMOTIONS.map((em) => (
              <button type="button" key={em} className={chip(values.emotion === em)} onClick={() => patch({ emotion: values.emotion === em ? null : em })}>
                {em}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Rating</Label>
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((r) => (
              <button
                type="button"
                key={r}
                aria-label={`${r} star${r > 1 ? "s" : ""}`}
                onClick={() => patch({ rating: values.rating === r ? 0 : r })}
                className={r <= values.rating ? "text-yellow-400" : "text-muted-foreground/30"}
              >
                <Star className="h-3.5 w-3.5" fill={r <= values.rating ? "currentColor" : "none"} />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <Label>Tags (comma-separated)</Label>
        <input
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          className="w-full h-6 rounded border border-border bg-background px-1.5"
          placeholder="e.g. london open, news"
        />
      </div>
      <div>
        <Label>Notes</Label>
        <textarea
          value={values.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          className="w-full min-h-[64px] resize-y rounded border border-border bg-background px-1.5 py-1"
          placeholder="Why did you take it? What did you learn?"
        />
      </div>
      <div className="flex gap-1">
        <Button size="sm" className="h-6 text-[10px]" loading={saving} onClick={save}>
          Save
        </Button>
        {onDelete && (
          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={onDelete}>
            Delete entry
          </Button>
        )}
      </div>
    </div>
  );
}

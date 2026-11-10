import { useEffect, useId, useMemo, useRef, useState } from "react";
import { termsItems } from "./termsCopy.ts";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface TermsDialogProps {
  onAccept: () => void;
}

/**
 * Mandatory terms and risk acknowledgement. Deliberately NOT dismissible
 * (no Escape, no backdrop click, no close button): the only way forward is to
 * tick every box and press the button. Focus is trapped inside.
 */
export function TermsDialog({ onAccept }: TermsDialogProps) {
  const items = useMemo(() => termsItems(), []);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const all = checked.size === items.length;

  useEffect(() => {
    const root = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    (root?.querySelector<HTMLElement>(FOCUSABLE) ?? root)?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        // Not dismissible; swallow so a parent handler cannot close anything behind us.
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const list = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0] as HTMLElement;
      const last = list[list.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (active && !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, []);

  const toggle = (id: string): void =>
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-lg border border-border bg-card p-5 text-card-foreground shadow-xl outline-none"
      >
        <h2 id={titleId} className="mb-1 text-base font-semibold">
          Before you trade
        </h2>
        <p id={descId} className="mb-3 text-xs text-muted-foreground">
          Please read and confirm each statement. You can only continue once all of them are ticked.
        </p>
        <ul className="mb-4 space-y-3 overflow-y-auto pr-1">
          {items.map((it) => {
            const inputId = `${titleId}-${it.id}`;
            return (
              <li key={it.id} className="flex items-start gap-3 text-sm">
                <input
                  id={inputId}
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0"
                  checked={checked.has(it.id)}
                  onChange={() => toggle(it.id)}
                />
                <label htmlFor={inputId} className="cursor-pointer leading-snug">
                  {it.text}
                </label>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          disabled={!all}
          onClick={onAccept}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          I understand and agree
        </button>
        {!all && (
          <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
            {items.length - checked.size} statement{items.length - checked.size === 1 ? "" : "s"} left to confirm.
          </p>
        )}
      </div>
    </div>
  );
}

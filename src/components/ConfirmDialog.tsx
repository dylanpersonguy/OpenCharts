/* eslint-disable react-refresh/only-export-components */
/**
 * ConfirmDialog - Reusable confirmation dialog for destructive actions.
 * Uses native dialog element with accessible patterns.
 */
import { useCallback, useRef, useEffect, useState } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    },
    [onCancel],
  );

  // Always render the <dialog> so close() can fire before unmount.
  // Hide content when not open to avoid flash.
  return (
    <dialog
      ref={dialogRef}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[70] bg-transparent backdrop:bg-black/50"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-desc"
    >
      {open && (
        <div className="bg-card border border-border rounded-lg shadow-lg p-6 max-w-md mx-auto mt-[20vh]">
          <h2 id="confirm-title" className="text-lg font-semibold text-foreground">
            {title}
          </h2>
          <p id="confirm-desc" className="text-sm text-muted-foreground mt-2">
            {description}
          </p>
          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted"
              autoFocus
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              className={`px-4 py-2 text-sm font-medium rounded-md text-white ${
                variant === "destructive"
                  ? "bg-destructive hover:bg-destructive/90"
                  : "bg-accent hover:bg-accent/90"
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

/**
 * Hook to manage confirm dialog state.
 */
export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    description: string;
    variant: "default" | "destructive";
    resolve: ((val: boolean) => void) | null;
  }>({
    open: false,
    title: "",
    description: "",
    variant: "default",
    resolve: null,
  });

  const confirm = useCallback(
    (opts: {
      title: string;
      description: string;
      variant?: "default" | "destructive";
    }): Promise<boolean> => {
      return new Promise((resolve) => {
        setState({
          open: true,
          title: opts.title,
          description: opts.description,
          variant: opts.variant || "default",
          resolve,
        });
      });
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    state.resolve?.(true);
    setState((s) => ({ ...s, open: false, resolve: null }));
  }, [state]);

  const handleCancel = useCallback(() => {
    state.resolve?.(false);
    setState((s) => ({ ...s, open: false, resolve: null }));
  }, [state]);

  return {
    confirm,
    dialogProps: { ...state, onConfirm: handleConfirm, onCancel: handleCancel },
  };
}

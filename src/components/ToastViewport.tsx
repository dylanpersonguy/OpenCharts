import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";
import { toast, type ToastPayload } from "../services/toast.ts";

/**
 * Renders the terminal's notifications.
 *
 * Everything that reports an outcome — a rejected order and its reason, a
 * filled one, a position closed, a validation warning — goes through the
 * `toast` bus. Without a viewport subscribed to it those messages are dropped
 * silently, which is how a trader ends up clicking "Buy" on an invalid order
 * and seeing nothing happen.
 *
 * Errors are announced assertively and stay longer; everything else is polite
 * and short. Identical messages fired in quick succession (a double-clicked
 * button) collapse into one.
 */

type ActiveToast = ToastPayload & { id: number; count: number };

const MAX_VISIBLE = 4;
const DURATION_MS: Record<ToastPayload["type"], number> = {
  info: 4_000,
  success: 3_500,
  warning: 6_000,
  error: 8_000,
};
const DEDUPE_WINDOW_MS = 1_500;

const ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const;

const ACCENT: Record<ToastPayload["type"], string> = {
  info: "text-accent",
  success: "text-success",
  warning: "text-warning",
  error: "text-destructive",
};

export function ToastViewport() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const lastSeen = useRef(new Map<string, { id: number; at: number }>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const schedule = useCallback(
    (id: number, type: ToastPayload["type"]) => {
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION_MS[type]),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const unsubscribe = toast.subscribe((payload) => {
      const key = `${payload.type}|${payload.title}|${payload.message}`;
      const now = Date.now();
      const recent = lastSeen.current.get(key);

      // A repeat of a message still on screen bumps a counter instead of
      // stacking a duplicate.
      if (recent && now - recent.at < DEDUPE_WINDOW_MS) {
        lastSeen.current.set(key, { id: recent.id, at: now });
        setToasts((prev) =>
          prev.map((t) => (t.id === recent.id ? { ...t, count: t.count + 1 } : t)),
        );
        schedule(recent.id, payload.type);
        return;
      }

      const id = nextId.current++;
      lastSeen.current.set(key, { id, at: now });
      setToasts((prev) => [...prev, { ...payload, id, count: 1 }].slice(-MAX_VISIBLE));
      schedule(id, payload.type);
    });

    const pending = timers.current;
    return () => {
      unsubscribe();
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, [schedule]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[1000] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
      aria-label="Notifications"
    >
      {toasts.map((t) => {
        const Icon = ICON[t.type];
        const urgent = t.type === "error" || t.type === "warning";
        return (
          <div
            key={t.id}
            role={urgent ? "alert" : "status"}
            aria-live={urgent ? "assertive" : "polite"}
            className="pointer-events-auto flex items-start gap-2.5 rounded-md border border-border bg-card px-3 py-2.5 text-card-foreground shadow-xl"
          >
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", ACCENT[t.type])} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold leading-tight">
                {t.title}
                {t.count > 1 && (
                  <span className="ml-1.5 font-normal text-muted-foreground">×{t.count}</span>
                )}
              </p>
              {t.message && (
                <p className="mt-0.5 break-words text-xs leading-snug text-muted-foreground">
                  {t.message}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

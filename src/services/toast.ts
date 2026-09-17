// ── Global toast store ──────────────────────────────────────
// Lightweight pub-sub so any module can fire toasts without React context.

export interface ToastPayload {
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
}

type Listener = (t: ToastPayload) => void;
const listeners = new Set<Listener>();

export const toast = {
  /** Fire a toast (the ToastContainer picks it up). */
  fire(type: ToastPayload["type"], title: string, message: string) {
    // Snapshot: a listener may unsubscribe while handling the event. Isolate
    // failures so one broken subscriber cannot silence every later toast —
    // toasts are how the terminal reports rejected orders.
    for (const fn of [...listeners]) {
      try {
        fn({ type, title, message });
      } catch (err) {
        console.error("[toast] listener threw", err);
      }
    }
  },

  success(title: string, message: string) {
    toast.fire("success", title, message);
  },
  error(title: string, message: string) {
    toast.fire("error", title, message);
  },
  info(title: string, message: string) {
    toast.fire("info", title, message);
  },
  warning(title: string, message: string) {
    toast.fire("warning", title, message);
  },

  /** Subscribe — returns unsubscribe function. */
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

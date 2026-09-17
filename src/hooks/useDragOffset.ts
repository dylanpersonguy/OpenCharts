import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from "react";

/**
 * Drag-to-move for floating dialogs/panels (TradingView-style).
 *
 * Attach `onPointerDown` to the drag handle (usually the dialog header) and
 * spread `style` onto the floating element. The offset accumulates across
 * drags and `reset()` re-centres (call it when the dialog closes so it
 * reopens centred).
 */
export interface UseDragOffsetOptions {
  /** Optional localStorage key to persist the dragged offset across page reloads. */
  storageKey?: string;
  /** When true, the element is centered vertically (e.g. top-1/2 translateY(-50%)) and vertical offsets apply relative to center. */
  defaultCenterY?: boolean;
}

export function useDragOffset(options?: UseDragOffsetOptions): {
  style: CSSProperties;
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  reset: () => void;
} {
  const { storageKey, defaultCenterY = false } = options ?? {};

  const [offset, setOffset] = useState<{ x: number; y: number }>(() => {
    if (storageKey && typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
            return { x: parsed.x, y: parsed.y };
          }
        }
      } catch {
        // ignore parse or storage errors
      }
    }
    return { x: 0, y: 0 };
  });

  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      // Ignore drags starting on interactive elements inside the handle.
      if ((e.target as HTMLElement).closest("button, input, select, textarea, a")) return;
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: offsetRef.current.x,
        baseY: offsetRef.current.y,
      };

      const onMove = (ev: globalThis.PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const next = {
          x: drag.baseX + (ev.clientX - drag.startX),
          y: drag.baseY + (ev.clientY - drag.startY),
        };
        offsetRef.current = next;
        setOffset(next);
      };

      const onUp = () => {
        dragRef.current = null;
        if (storageKey && typeof window !== "undefined") {
          try {
            localStorage.setItem(storageKey, JSON.stringify(offsetRef.current));
          } catch {
            // ignore
          }
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [storageKey],
  );

  const reset = useCallback(() => {
    const zero = { x: 0, y: 0 };
    offsetRef.current = zero;
    setOffset(zero);
    if (storageKey && typeof window !== "undefined") {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    }
  }, [storageKey]);

  return {
    style: defaultCenterY
      ? { transform: `translate(${offset.x}px, calc(-50% + ${offset.y}px))` }
      : offset.x !== 0 || offset.y !== 0
        ? { transform: `translate(${offset.x}px, ${offset.y}px)` }
        : {},
    onPointerDown,
    reset,
  };
}

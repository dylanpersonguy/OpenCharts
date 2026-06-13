import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from "react";

/**
 * Drag-to-move for floating dialogs/panels (TradingView-style).
 *
 * Attach `onPointerDown` to the drag handle (usually the dialog header) and
 * spread `style` onto the floating element. The offset accumulates across
 * drags and `reset()` re-centres (call it when the dialog closes so it
 * reopens centred).
 */
export function useDragOffset(): {
  style: CSSProperties;
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  reset: () => void;
} {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      // Ignore drags starting on interactive elements inside the handle.
      if ((e.target as HTMLElement).closest("button, input, select, textarea, a")) return;
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };

      const onMove = (ev: globalThis.PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        setOffset({
          x: drag.baseX + (ev.clientX - drag.startX),
          y: drag.baseY + (ev.clientY - drag.startY),
        });
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [offset.x, offset.y],
  );

  const reset = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  return {
    style:
      offset.x !== 0 || offset.y !== 0
        ? { transform: `translate(${offset.x}px, ${offset.y}px)` }
        : {},
    onPointerDown,
    reset,
  };
}

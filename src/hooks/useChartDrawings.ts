import { useCallback, useEffect, useRef, useState } from "react";
import type { DrawingLine } from "../pages/trading/constants";
import { api } from "../services/api";

// One reversible mutation for the undo/redo stacks.
type HistoryOp =
  | { kind: "add"; drawing: DrawingLine }
  | { kind: "update"; before: DrawingLine; after: DrawingLine }
  | { kind: "remove"; drawing: DrawingLine }
  | { kind: "clear"; drawings: DrawingLine[] };

const HISTORY_LIMIT = 100;

// Render order: lower zIndex first (drawn underneath). Stable for ties, so
// drawings without an explicit zIndex keep creation order.
function sortByZ(list: DrawingLine[]): DrawingLine[] {
  return [...list].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
}

export function useChartDrawings(symbol: string, timeframe: string) {
  const [drawings, setDrawings] = useState<DrawingLine[]>([]);
  const symbolRef = useRef(symbol);
  const timeframeRef = useRef(timeframe);
  // Mirror of `drawings` so mutators can read current state synchronously
  // (needed to capture `before` snapshots for undo without stale closures).
  const drawingsRef = useRef<DrawingLine[]>([]);
  const undoStackRef = useRef<HistoryOp[]>([]);
  const redoStackRef = useRef<HistoryOp[]>([]);

  useEffect(() => {
    symbolRef.current = symbol;
    timeframeRef.current = timeframe;
  });

  // Drawings load per symbol and are shared across timeframes (TradingView
  // behavior) — switching TF keeps them in place with no refetch.
  useEffect(() => {
    let cancelled = false;
    setDrawings([]);
    drawingsRef.current = [];
    undoStackRef.current = [];
    redoStackRef.current = [];
    api.chartDrawings
      .list(symbol)
      .then((data) => {
        if (cancelled) return;
        const sorted = sortByZ(data ?? []);
        setDrawings(sorted);
        drawingsRef.current = sorted;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // ── Primitive applies (state + ref mirror + server, no history) ──

  const applyAdd = useCallback((d: DrawingLine) => {
    drawingsRef.current = sortByZ([...drawingsRef.current, d]);
    setDrawings(drawingsRef.current);
    api.chartDrawings.save(symbolRef.current, timeframeRef.current, d).catch(() => {});
  }, []);

  // The drawings POST endpoint upserts by drawingId, so edits reuse save().
  const applyUpdate = useCallback((d: DrawingLine) => {
    drawingsRef.current = sortByZ(drawingsRef.current.map((x) => (x.id === d.id ? d : x)));
    setDrawings(drawingsRef.current);
    api.chartDrawings.save(symbolRef.current, timeframeRef.current, d).catch(() => {});
  }, []);

  const applyRemove = useCallback((id: string) => {
    drawingsRef.current = drawingsRef.current.filter((x) => x.id !== id);
    setDrawings(drawingsRef.current);
    api.chartDrawings.remove(id).catch(() => {});
  }, []);

  const pushHistory = useCallback((op: HistoryOp) => {
    undoStackRef.current.push(op);
    if (undoStackRef.current.length > HISTORY_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = [];
  }, []);

  // ── Public mutators (record history) ──

  const addDrawing = useCallback(
    (d: DrawingLine) => {
      pushHistory({ kind: "add", drawing: d });
      applyAdd(d);
    },
    [pushHistory, applyAdd],
  );

  const updateDrawing = useCallback(
    (d: DrawingLine) => {
      const before = drawingsRef.current.find((x) => x.id === d.id);
      if (before) pushHistory({ kind: "update", before, after: d });
      applyUpdate(d);
    },
    [pushHistory, applyUpdate],
  );

  const removeDrawing = useCallback(
    (id: string) => {
      const drawing = drawingsRef.current.find((x) => x.id === id);
      if (drawing) pushHistory({ kind: "remove", drawing });
      applyRemove(id);
    },
    [pushHistory, applyRemove],
  );

  const clearDrawings = useCallback(() => {
    if (drawingsRef.current.length > 0) {
      pushHistory({ kind: "clear", drawings: drawingsRef.current });
    }
    drawingsRef.current = [];
    setDrawings([]);
    api.chartDrawings.clear(symbolRef.current).catch(() => {});
  }, [pushHistory]);

  // ── Undo / redo ──

  const revertOp = useCallback(
    (op: HistoryOp) => {
      if (op.kind === "add") applyRemove(op.drawing.id);
      else if (op.kind === "update") applyUpdate(op.before);
      else if (op.kind === "remove") applyAdd(op.drawing);
      else for (const d of op.drawings) applyAdd(d);
    },
    [applyAdd, applyUpdate, applyRemove],
  );

  const replayOp = useCallback(
    (op: HistoryOp) => {
      if (op.kind === "add") applyAdd(op.drawing);
      else if (op.kind === "update") applyUpdate(op.after);
      else if (op.kind === "remove") applyRemove(op.drawing.id);
      else for (const d of op.drawings) applyRemove(d.id);
    },
    [applyAdd, applyUpdate, applyRemove],
  );

  const undo = useCallback(() => {
    const op = undoStackRef.current.pop();
    if (!op) return;
    revertOp(op);
    redoStackRef.current.push(op);
  }, [revertOp]);

  const redo = useCallback(() => {
    const op = redoStackRef.current.pop();
    if (!op) return;
    replayOp(op);
    undoStackRef.current.push(op);
  }, [replayOp]);

  return { drawings, addDrawing, updateDrawing, removeDrawing, clearDrawings, undo, redo };
}

import { useState, useEffect, useRef, type RefObject } from "react";
import type { IChartApi, ISeriesApi, IPriceLine } from "lightweight-charts";
import type { DrawingTool } from "./constants.ts";

// ── Types ────────────────────────────────────────────────────

export interface DragPriceState {
  price: number;
  y: number;
  field: "TP" | "SL";
  pnlUsd: number;
}

export interface SlTpLineEntry {
  positionId: string;
  field: "takeProfit" | "stopLoss";
  line: IPriceLine;
  price: number;
  entryPrice: number;
  quantity: number;
  side: string;
}

export interface SymbolInfo {
  contractSize?: number;
  [key: string]: unknown;
}

// ── Hook ─────────────────────────────────────────────────────

export function useSlTpDrag(
  containerRef: RefObject<HTMLDivElement | null>,
  chartRef: RefObject<IChartApi | null>,
  candleSeriesRef: RefObject<ISeriesApi<"Candlestick"> | null>,
  slTpLinesRef: RefObject<Map<string, SlTpLineEntry>>,
  drawingTool: DrawingTool,
  onModifyPosition:
    | ((posId: string, mods: { takeProfit?: number | null; stopLoss?: number | null }) => void)
    | undefined,
  pipDigits: number,
  symbolInfo: SymbolInfo | null | undefined,
  chartEpoch: number,
): DragPriceState | null {
  const dragRef = useRef<{
    active: boolean;
    positionId: string;
    field: "takeProfit" | "stopLoss";
    priceLine: IPriceLine;
    startPrice: number;
    entryPrice: number;
    quantity: number;
    side: string;
  } | null>(null);
  const [dragPrice, setDragPrice] = useState<DragPriceState | null>(null);

  const onModifyPositionRef = useRef(onModifyPosition);
  onModifyPositionRef.current = onModifyPosition;
  const pipDigitsRef = useRef(pipDigits);
  pipDigitsRef.current = pipDigits;
  const symbolInfoRef = useRef(symbolInfo);
  symbolInfoRef.current = symbolInfo;

  useEffect(() => {
    const container = containerRef.current;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!container || !chart || !series) return;

    const SNAP_PX = 8;

    const yToPrice = (clientY: number): number | null => {
      const rect = container.getBoundingClientRect();
      const y = clientY - rect.top;
      const price = series.coordinateToPrice(y);
      return typeof price === "number" && isFinite(price) ? price : null;
    };

    const findNearestLine = (
      clientY: number,
    ): { key: string; entry: SlTpLineEntry; dist: number } | null => {
      const rect = container.getBoundingClientRect();
      const mouseY = clientY - rect.top;
      let closest: { key: string; entry: SlTpLineEntry; dist: number } | null = null;

      for (const [key, entry] of slTpLinesRef.current) {
        const lineY = series.priceToCoordinate(entry.price);
        if (lineY === null || lineY === undefined) continue;
        const dist = Math.abs(mouseY - (lineY as number));
        if (dist <= SNAP_PX && (!closest || dist < closest.dist)) {
          closest = { key, entry, dist };
        }
      }
      return closest;
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || drawingTool !== "none") return;
      const nearest = findNearestLine(e.clientY);
      if (!nearest) return;

      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        active: true,
        positionId: nearest.entry.positionId,
        field: nearest.entry.field,
        priceLine: nearest.entry.line,
        startPrice: nearest.entry.price,
        entryPrice: nearest.entry.entryPrice,
        quantity: nearest.entry.quantity,
        side: nearest.entry.side,
      };
      chart.applyOptions({
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: false,
          horzTouchDrag: false,
          vertTouchDrag: false,
        },
      });
      container.style.cursor = "grabbing";
    };

    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;

      if (drag?.active) {
        const price = yToPrice(e.clientY);
        if (price !== null) {
          const rounded = parseFloat(price.toFixed(pipDigitsRef.current));
          drag.priceLine.applyOptions({ price: rounded });

          const cSize = symbolInfoRef.current?.contractSize || 100000;
          const dir = drag.side === "LONG" ? 1 : -1;
          const pnlUsd = parseFloat(
            ((rounded - drag.entryPrice) * dir * drag.quantity * cSize).toFixed(2),
          );

          const label = drag.field === "takeProfit" ? "TP" : "SL";
          const sign = pnlUsd >= 0 ? "+" : "";
          drag.priceLine.applyOptions({
            title: `${label}  ${sign}$${pnlUsd.toFixed(2)}`,
          });

          const rect = container.getBoundingClientRect();
          setDragPrice({
            price: rounded,
            y: e.clientY - rect.top,
            field: drag.field === "takeProfit" ? "TP" : "SL",
            pnlUsd,
          });
        }
        return;
      }

      const nearest = findNearestLine(e.clientY);
      if (nearest && drawingTool === "none") {
        container.style.cursor = "grab";
      } else if (!drag?.active && drawingTool === "none") {
        container.style.cursor = "default";
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag?.active) return;

      const newPrice = yToPrice(e.clientY);
      dragRef.current = null;
      setDragPrice(null);

      chart.applyOptions({
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: true,
        },
      });
      container.style.cursor = "default";

      if (newPrice === null) return;
      const rounded = parseFloat(newPrice.toFixed(pipDigitsRef.current));

      if (Math.abs(rounded - drag.startPrice) < Math.pow(10, -pipDigitsRef.current)) return;

      if (onModifyPositionRef.current) {
        onModifyPositionRef.current(drag.positionId, {
          [drag.field]: rounded,
        });
      }
    };

    container.addEventListener("mousedown", handleMouseDown, true);
    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      container.removeEventListener("mousedown", handleMouseDown, true);
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chart/series/container live in refs; chartEpoch re-binds after every chart (re)create so the listeners never capture a destroyed instance
  }, [drawingTool, chartEpoch]);

  return dragPrice;
}

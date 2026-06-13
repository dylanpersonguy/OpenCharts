import type { DrawingLine } from "../../pages/trading/constants";
import { request } from "./request";

export const chartDrawingsApi = {
  // No timeframe filter: drawings are shared across all timeframes of a
  // symbol (TradingView behavior); per-TF visibility lives on the drawing.
  list: (symbol: string) =>
    request<DrawingLine[]>(`/trader/charts/drawings?symbol=${encodeURIComponent(symbol)}`),

  save: (symbol: string, timeframe: string, drawing: DrawingLine) =>
    request<{ saved: boolean }>("/trader/charts/drawings", {
      method: "POST",
      body: JSON.stringify({
        symbol,
        timeframe,
        drawingId: drawing.id,
        data: drawing,
      }),
    }),

  remove: (drawingId: string) =>
    request<{ deleted: boolean }>(`/trader/charts/drawings/${encodeURIComponent(drawingId)}`, {
      method: "DELETE",
    }),

  clear: (symbol: string) =>
    request<{ cleared: boolean }>(`/trader/charts/drawings?symbol=${encodeURIComponent(symbol)}`, {
      method: "DELETE",
    }),
};

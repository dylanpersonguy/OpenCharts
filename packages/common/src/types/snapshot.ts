/** Shared chart snapshot types */

export interface ChartSnapshot {
  id: string;
  /** Symbol at the time of snapshot */
  symbol: string;
  resolution: string;
  chartType: string;
  /** Indicators active on the chart */
  indicators: { type: string; params?: Record<string, number> }[];
  /** Optional title/description */
  title: string | null;
  /** Base64-encoded PNG image of the chart */
  imageData: string | null;
  /** Chart state for reconstruction */
  chartState: Record<string, unknown> | null;
  createdAt: string;
  /** Short share code */
  shareCode: string;
}

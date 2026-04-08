import type { ChartType, Resolution } from '../index';

export interface Layout {
  id: string;
  userId: string;
  name: string;
  symbol: string;
  resolution: Resolution;
  chartType: ChartType;
  indicators: LayoutIndicator[];
  createdAt: string;
  updatedAt: string;
}

export interface LayoutIndicator {
  id: string;
  type: string;
  params: Record<string, number | string | boolean>;
  pane: 'overlay' | 'lower';
}

export interface SaveLayoutRequest {
  name: string;
  symbol: string;
  resolution: Resolution;
  chartType: ChartType;
  indicators: LayoutIndicator[];
}

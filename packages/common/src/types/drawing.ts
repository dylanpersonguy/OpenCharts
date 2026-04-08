export type DrawingType =
  | 'horizontal_line'
  | 'trend_line'
  | 'rectangle'
  | 'fib_retracement'
  | 'text_annotation';

export interface DrawingPoint {
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  layoutId: string;
  type: DrawingType;
  points: DrawingPoint[];
  style: DrawingStyle;
  text?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DrawingStyle {
  color: string;
  lineWidth: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  fillColor?: string;
  fontSize?: number;
}

export interface CreateDrawingRequest {
  layoutId: string;
  type: DrawingType;
  points: DrawingPoint[];
  style: DrawingStyle;
  text?: string;
}

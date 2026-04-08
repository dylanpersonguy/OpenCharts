export interface User {
  id: string;
  email: string;
  username: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserPreferences {
  userId: string;
  theme: 'dark' | 'light';
  defaultResolution: string;
  defaultChartType: ChartType;
  favoriteSymbols: string[];
  recentSymbols: string[];
}

export type ChartType = 'candlestick' | 'line' | 'area';

export interface AuthPayload {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

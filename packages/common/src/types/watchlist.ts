export interface Watchlist {
  id: string;
  userId: string;
  name: string;
  items: WatchlistItem[];
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistItem {
  id: string;
  watchlistId: string;
  symbol: string;
  sortOrder: number;
}

export interface CreateWatchlistRequest {
  name: string;
  symbols?: string[];
}

export interface UpdateWatchlistRequest {
  name?: string;
  symbols?: string[];
}

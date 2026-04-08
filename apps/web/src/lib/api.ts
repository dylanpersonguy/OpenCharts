const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('oc_token') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Symbols
  getSymbols: () => request<Record<string, unknown>[]>('/api/symbols'),
  searchSymbols: (q: string) => request<Record<string, unknown>[]>(`/api/symbols/search?q=${encodeURIComponent(q)}`),
  resolveSymbol: (ticker: string) => request<Record<string, unknown>>(`/api/symbols/${encodeURIComponent(ticker)}`),

  // Bars
  getBars: (symbol: string, resolution: string, limit?: number) =>
    request<{ bars: { time: number; open: number; high: number; low: number; close: number; volume: number }[] }>(
      `/api/bars/${encodeURIComponent(symbol)}/${resolution}${limit ? `?limit=${limit}` : ''}`,
    ),

  getIndicators: (symbol: string, resolution: string, indicators: { type: string; params?: Record<string, number> }[]) =>
    request<{ indicators: { type: string; series: Record<string, (number | null)[]> }[] }>(
      `/api/bars/${encodeURIComponent(symbol)}/${resolution}/indicators`,
      { method: 'POST', body: JSON.stringify({ indicators }) },
    ),

  // Auth
  login: (email: string, password: string) =>
    request<{ token: string; user: Record<string, unknown> }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, username: string, password: string) =>
    request<{ token: string; user: Record<string, unknown> }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, username, password }),
    }),
  getMe: () => request<Record<string, unknown>>('/api/auth/me'),

  // Watchlists
  getWatchlists: () => request<Record<string, unknown>[]>('/api/watchlists'),
  createWatchlist: (name: string, symbols?: string[]) =>
    request<Record<string, unknown>>('/api/watchlists', {
      method: 'POST',
      body: JSON.stringify({ name, symbols }),
    }),
  updateWatchlist: (id: string, data: { name?: string; symbols?: string[] }) =>
    request<Record<string, unknown>>(`/api/watchlists/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteWatchlist: (id: string) =>
    request<Record<string, unknown>>(`/api/watchlists/${id}`, { method: 'DELETE' }),

  // Layouts
  getLayouts: () => request<Record<string, unknown>[]>('/api/layouts'),
  getLayout: (id: string) => request<Record<string, unknown>>(`/api/layouts/${id}`),
  saveLayout: (data: Record<string, unknown>) =>
    request<{ id: string }>('/api/layouts', { method: 'POST', body: JSON.stringify(data) }),
  updateLayout: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/layouts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLayout: (id: string) =>
    request<Record<string, unknown>>(`/api/layouts/${id}`, { method: 'DELETE' }),

  // Drawings
  getDrawings: (layoutId: string) => request<Record<string, unknown>[]>(`/api/drawings/layout/${layoutId}`),
  createDrawing: (data: Record<string, unknown>) =>
    request<{ id: string }>('/api/drawings', { method: 'POST', body: JSON.stringify(data) }),
  updateDrawing: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/drawings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDrawing: (id: string) =>
    request<Record<string, unknown>>(`/api/drawings/${id}`, { method: 'DELETE' }),

  // Transpile
  transpile: (source: string, target: 'typescript' | 'python') =>
    request<{ code: string; version: number | null; target: string }>('/api/transpile', {
      method: 'POST',
      body: JSON.stringify({ source, target }),
    }),

  // Exchanges
  getExchanges: () => request<{ id: string; name: string; connected: boolean; symbols: string[]; lastUpdate: number | null; latencyMs: number | null }[]>('/api/exchanges'),
  getOrderBook: (symbol: string, depth?: number) =>
    request<Record<string, unknown>>(`/api/exchanges/orderbook/${encodeURIComponent(symbol)}${depth ? `?depth=${depth}` : ''}`),
  getTicker: (symbol: string) =>
    request<Record<string, unknown>>(`/api/exchanges/ticker/${encodeURIComponent(symbol)}`),
  addExchange: (id: string, symbols: string[]) =>
    request<Record<string, unknown>>('/api/exchanges', { method: 'POST', body: JSON.stringify({ id, symbols }) }),
  removeExchange: (id: string) =>
    request<Record<string, unknown>>(`/api/exchanges/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Calendar
  getCalendarEvents: (opts?: { from?: string; to?: string; country?: string; impact?: string }) => {
    const params = new URLSearchParams();
    if (opts?.from) params.set('from', opts.from);
    if (opts?.to) params.set('to', opts.to);
    if (opts?.country) params.set('country', opts.country);
    if (opts?.impact) params.set('impact', opts.impact);
    const qs = params.toString();
    return request<{ events: { id: string; title: string; country: string; date: string; impact: string; forecast: string | null; previous: string | null; actual: string | null; currency: string }[] }>(`/api/calendar${qs ? `?${qs}` : ''}`);
  },

  // Snapshots
  createSnapshot: (data: { symbol: string; resolution: string; chartType: string; indicators?: unknown[]; title?: string; imageData?: string; chartState?: Record<string, unknown> }) =>
    request<{ id: string; shareCode: string; url: string }>('/api/snapshots', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getSnapshot: (code: string) =>
    request<Record<string, unknown>>(`/api/snapshots/${encodeURIComponent(code)}`),
};

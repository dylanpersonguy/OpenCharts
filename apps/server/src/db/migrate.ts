import { pool } from './pool';

const MIGRATION_SQL = `
-- Enable uuid generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User preferences
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme VARCHAR(10) DEFAULT 'dark',
  default_resolution VARCHAR(10) DEFAULT '1m',
  default_chart_type VARCHAR(20) DEFAULT 'candlestick',
  favorite_symbols TEXT[] DEFAULT '{}',
  recent_symbols TEXT[] DEFAULT '{}'
);

-- Symbols
CREATE TABLE IF NOT EXISTS symbols (
  ticker VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT DEFAULT '',
  exchange VARCHAR(100) DEFAULT '',
  asset_class VARCHAR(50) NOT NULL DEFAULT 'crypto',
  session_open VARCHAR(10) DEFAULT '00:00',
  session_close VARCHAR(10) DEFAULT '23:59',
  timezone VARCHAR(100) DEFAULT 'UTC',
  min_tick NUMERIC(20, 10) DEFAULT 0.01,
  pricescale INTEGER DEFAULT 100,
  supported_resolutions TEXT[] DEFAULT '{1m,5m,15m,1h,4h,1d,1w}',
  has_intraday BOOLEAN DEFAULT TRUE,
  logo_url TEXT
);

-- Historical bars (partitioned by symbol for scalability)
CREATE TABLE IF NOT EXISTS historical_bars (
  symbol VARCHAR(50) NOT NULL REFERENCES symbols(ticker),
  resolution VARCHAR(10) NOT NULL,
  time BIGINT NOT NULL,
  open NUMERIC(20, 10) NOT NULL,
  high NUMERIC(20, 10) NOT NULL,
  low NUMERIC(20, 10) NOT NULL,
  close NUMERIC(20, 10) NOT NULL,
  volume NUMERIC(30, 10) DEFAULT 0,
  PRIMARY KEY (symbol, resolution, time)
);

CREATE INDEX IF NOT EXISTS idx_bars_symbol_res_time
  ON historical_bars (symbol, resolution, time DESC);

-- Watchlists
CREATE TABLE IF NOT EXISTS watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Watchlist items
CREATE TABLE IF NOT EXISTS watchlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id UUID NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  symbol VARCHAR(50) NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_wl
  ON watchlist_items (watchlist_id);

-- Layouts
CREATE TABLE IF NOT EXISTS layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  symbol VARCHAR(50) NOT NULL,
  resolution VARCHAR(10) NOT NULL DEFAULT '1m',
  chart_type VARCHAR(20) NOT NULL DEFAULT 'candlestick',
  indicators JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_layouts_user
  ON layouts (user_id);

-- Layout drawings
CREATE TABLE IF NOT EXISTS layout_drawings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  layout_id UUID NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  points JSONB NOT NULL DEFAULT '[]',
  style JSONB NOT NULL DEFAULT '{}',
  text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drawings_layout
  ON layout_drawings (layout_id);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(50) NOT NULL,
  condition VARCHAR(20) NOT NULL,
  price NUMERIC(20, 10) NOT NULL,
  message TEXT,
  active BOOLEAN DEFAULT TRUE,
  triggered BOOLEAN DEFAULT FALSE,
  triggered_at TIMESTAMPTZ,
  webhook_url TEXT,
  webhook_headers JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_user
  ON alerts (user_id);

CREATE INDEX IF NOT EXISTS idx_alerts_symbol_active
  ON alerts (symbol, active) WHERE active = TRUE;

-- Chart snapshots
CREATE TABLE IF NOT EXISTS chart_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_code VARCHAR(12) UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  symbol VARCHAR(50) NOT NULL,
  resolution VARCHAR(10) NOT NULL,
  chart_type VARCHAR(20) NOT NULL,
  indicators JSONB DEFAULT '[]',
  title TEXT,
  image_data TEXT,
  chart_state JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_share_code
  ON chart_snapshots (share_code);
`;

async function migrate() {
  console.log('Running database migrations...');
  try {
    await pool.query(MIGRATION_SQL);
    console.log('Migrations completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  numeric,
  bigint,
  timestamp,
  jsonb,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── Users ──────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: varchar('email', { length: 255 }).unique().notNull(),
  username: varchar('username', { length: 100 }).unique().notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ── User Preferences ──────────────────────────────────
export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  theme: varchar('theme', { length: 10 }).default('dark'),
  defaultResolution: varchar('default_resolution', { length: 10 }).default('1m'),
  defaultChartType: varchar('default_chart_type', { length: 20 }).default('candlestick'),
  favoriteSymbols: text('favorite_symbols').array().default(sql`'{}'`),
  recentSymbols: text('recent_symbols').array().default(sql`'{}'`),
});

// ── Symbols ───────────────────────────────────────────
export const symbols = pgTable('symbols', {
  ticker: varchar('ticker', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').default(''),
  exchange: varchar('exchange', { length: 100 }).default(''),
  assetClass: varchar('asset_class', { length: 50 }).notNull().default('crypto'),
  sessionOpen: varchar('session_open', { length: 10 }).default('00:00'),
  sessionClose: varchar('session_close', { length: 10 }).default('23:59'),
  timezone: varchar('timezone', { length: 100 }).default('UTC'),
  minTick: numeric('min_tick', { precision: 20, scale: 10 }).default('0.01'),
  pricescale: integer('pricescale').default(100),
  supportedResolutions: text('supported_resolutions').array().default(sql`'{1m,5m,15m,1h,4h,1d,1w}'`),
  hasIntraday: boolean('has_intraday').default(true),
  logoUrl: text('logo_url'),
});

// ── Historical Bars ───────────────────────────────────
export const historicalBars = pgTable(
  'historical_bars',
  {
    symbol: varchar('symbol', { length: 50 }).notNull().references(() => symbols.ticker),
    resolution: varchar('resolution', { length: 10 }).notNull(),
    time: bigint('time', { mode: 'number' }).notNull(),
    open: numeric('open', { precision: 20, scale: 10 }).notNull(),
    high: numeric('high', { precision: 20, scale: 10 }).notNull(),
    low: numeric('low', { precision: 20, scale: 10 }).notNull(),
    close: numeric('close', { precision: 20, scale: 10 }).notNull(),
    volume: numeric('volume', { precision: 30, scale: 10 }).default('0'),
  },
  (table) => [
    primaryKey({ columns: [table.symbol, table.resolution, table.time] }),
    index('idx_bars_symbol_res_time').on(table.symbol, table.resolution, table.time),
  ],
);

// ── Watchlists ────────────────────────────────────────
export const watchlists = pgTable('watchlists', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ── Watchlist Items ───────────────────────────────────
export const watchlistItems = pgTable(
  'watchlist_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    watchlistId: uuid('watchlist_id').notNull().references(() => watchlists.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 50 }).notNull(),
    sortOrder: integer('sort_order').default(0),
  },
  (table) => [
    index('idx_watchlist_items_wl').on(table.watchlistId),
  ],
);

// ── Layouts ───────────────────────────────────────────
export const layouts = pgTable(
  'layouts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    symbol: varchar('symbol', { length: 50 }).notNull(),
    resolution: varchar('resolution', { length: 10 }).notNull().default('1m'),
    chartType: varchar('chart_type', { length: 20 }).notNull().default('candlestick'),
    indicators: jsonb('indicators').default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_layouts_user').on(table.userId),
  ],
);

// ── Layout Drawings ───────────────────────────────────
export const layoutDrawings = pgTable(
  'layout_drawings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    layoutId: uuid('layout_id').notNull().references(() => layouts.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    points: jsonb('points').notNull().default([]),
    style: jsonb('style').notNull().default({}),
    text: text('text'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_drawings_layout').on(table.layoutId),
  ],
);

// ── Chart Snapshots ───────────────────────────────────
export const chartSnapshots = pgTable(
  'chart_snapshots',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    shareCode: varchar('share_code', { length: 12 }).unique().notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    symbol: varchar('symbol', { length: 50 }).notNull(),
    resolution: varchar('resolution', { length: 10 }).notNull(),
    chartType: varchar('chart_type', { length: 20 }).notNull(),
    indicators: jsonb('indicators').default([]),
    title: text('title'),
    imageData: text('image_data'),
    chartState: jsonb('chart_state'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_snapshots_share_code').on(table.shareCode),
  ],
);

// ── Alerts ────────────────────────────────────────────
export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 50 }).notNull(),
    condition: varchar('condition', { length: 20 }).notNull(),
    price: numeric('price', { precision: 20, scale: 10 }).notNull(),
    message: text('message'),
    active: boolean('active').default(true),
    triggered: boolean('triggered').default(false),
    triggeredAt: timestamp('triggered_at', { withTimezone: true }),
    webhookUrl: text('webhook_url'),
    webhookHeaders: jsonb('webhook_headers'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_alerts_user').on(table.userId),
    index('idx_alerts_symbol_active').on(table.symbol, table.active),
  ],
);

import { pool } from './pool';
import bcrypt from 'bcryptjs';

const SEED_SYMBOLS = [
  { ticker: 'BTC/USD', name: 'Bitcoin', description: 'Bitcoin / US Dollar', exchange: 'Crypto', asset_class: 'crypto', min_tick: 0.01, pricescale: 100 },
  { ticker: 'ETH/USD', name: 'Ethereum', description: 'Ethereum / US Dollar', exchange: 'Crypto', asset_class: 'crypto', min_tick: 0.01, pricescale: 100 },
  { ticker: 'SOL/USD', name: 'Solana', description: 'Solana / US Dollar', exchange: 'Crypto', asset_class: 'crypto', min_tick: 0.01, pricescale: 100 },
  { ticker: 'EUR/USD', name: 'Euro/Dollar', description: 'Euro / US Dollar', exchange: 'Forex', asset_class: 'forex', min_tick: 0.00001, pricescale: 100000 },
  { ticker: 'GBP/USD', name: 'Pound/Dollar', description: 'British Pound / US Dollar', exchange: 'Forex', asset_class: 'forex', min_tick: 0.00001, pricescale: 100000 },
  { ticker: 'AAPL', name: 'Apple Inc', description: 'Apple Inc.', exchange: 'NASDAQ', asset_class: 'stocks', min_tick: 0.01, pricescale: 100, session_open: '09:30', session_close: '16:00', timezone: 'America/New_York' },
  { ticker: 'MSFT', name: 'Microsoft', description: 'Microsoft Corporation', exchange: 'NASDAQ', asset_class: 'stocks', min_tick: 0.01, pricescale: 100, session_open: '09:30', session_close: '16:00', timezone: 'America/New_York' },
  { ticker: 'TSLA', name: 'Tesla Inc', description: 'Tesla, Inc.', exchange: 'NASDAQ', asset_class: 'stocks', min_tick: 0.01, pricescale: 100, session_open: '09:30', session_close: '16:00', timezone: 'America/New_York' },
];

function generateBars(symbol: string, basePrice: number, days: number, resolution: string, resMs: number) {
  const bars: { symbol: string; resolution: string; time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  const now = Math.floor(Date.now() / 1000);
  const resSec = resMs / 1000;
  const count = Math.floor((days * 86400) / resSec);
  let price = basePrice;

  for (let i = count; i >= 0; i--) {
    const time = now - i * resSec;
    const volatility = basePrice * 0.002;
    const change = (Math.random() - 0.48) * volatility;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    const volume = Math.floor(Math.random() * 1000 + 100);
    price = close;

    bars.push({
      symbol,
      resolution,
      time: Math.floor(time),
      open: parseFloat(open.toFixed(6)),
      high: parseFloat(high.toFixed(6)),
      low: parseFloat(low.toFixed(6)),
      close: parseFloat(close.toFixed(6)),
      volume,
    });
  }
  return bars;
}

async function seed() {
  console.log('Seeding database...');

  // Seed symbols
  for (const s of SEED_SYMBOLS) {
    await pool.query(
      `INSERT INTO symbols (ticker, name, description, exchange, asset_class, min_tick, pricescale, session_open, session_close, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (ticker) DO UPDATE SET name = $2, description = $3`,
      [s.ticker, s.name, s.description, s.exchange, s.asset_class, s.min_tick, s.pricescale,
       s.session_open ?? '00:00', s.session_close ?? '23:59', s.timezone ?? 'UTC'],
    );
  }
  console.log(`Seeded ${SEED_SYMBOLS.length} symbols.`);

  // Generate historical bars for BTC/USD and ETH/USD
  const barConfigs = [
    { symbol: 'BTC/USD', basePrice: 67000, days: 30, resolution: '1m', resMs: 60000 },
    { symbol: 'BTC/USD', basePrice: 67000, days: 365, resolution: '1d', resMs: 86400000 },
    { symbol: 'BTC/USD', basePrice: 67000, days: 7, resolution: '5m', resMs: 300000 },
    { symbol: 'ETH/USD', basePrice: 3500, days: 30, resolution: '1m', resMs: 60000 },
    { symbol: 'ETH/USD', basePrice: 3500, days: 365, resolution: '1d', resMs: 86400000 },
    { symbol: 'AAPL', basePrice: 190, days: 365, resolution: '1d', resMs: 86400000 },
    { symbol: 'AAPL', basePrice: 190, days: 30, resolution: '1h', resMs: 3600000 },
  ];

  for (const bc of barConfigs) {
    const bars = generateBars(bc.symbol, bc.basePrice, bc.days, bc.resolution, bc.resMs);
    // Batch insert
    const batchSize = 500;
    for (let i = 0; i < bars.length; i += batchSize) {
      const batch = bars.slice(i, i + batchSize);
      const values: unknown[] = [];
      const placeholders = batch.map((b, idx) => {
        const offset = idx * 7;
        values.push(b.symbol, b.resolution, b.time, b.open, b.high, b.low, b.close, b.volume);
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`;
      });

      // Fix: recount placeholders
      const vals: unknown[] = [];
      const phs = batch.map((b, idx) => {
        const o = idx * 8;
        vals.push(b.symbol, b.resolution, b.time, b.open, b.high, b.low, b.close, b.volume);
        return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8})`;
      });

      await pool.query(
        `INSERT INTO historical_bars (symbol, resolution, time, open, high, low, close, volume)
         VALUES ${phs.join(', ')}
         ON CONFLICT (symbol, resolution, time) DO NOTHING`,
        vals,
      );
    }
    console.log(`Seeded ${bars.length} bars for ${bc.symbol} @ ${bc.resolution}`);
  }

  // Create demo user
  const passwordHash = await bcrypt.hash('demo1234', 10);
  await pool.query(
    `INSERT INTO users (email, username, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING`,
    ['demo@opencharts.dev', 'demo', passwordHash],
  );
  console.log('Seeded demo user (demo@opencharts.dev / demo1234)');

  // Create default watchlist for demo user
  const userResult = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, ['demo@opencharts.dev']);
  if (userResult.rows[0]) {
    const userId = userResult.rows[0].id;
    await pool.query(
      `INSERT INTO user_preferences (user_id, favorite_symbols, recent_symbols)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, ['BTC/USD', 'ETH/USD', 'AAPL'], ['BTC/USD']],
    );

    const wlResult = await pool.query<{ id: string }>(
      `INSERT INTO watchlists (user_id, name) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING id`,
      [userId, 'My Watchlist'],
    );
    if (wlResult.rows[0]) {
      const wlId = wlResult.rows[0].id;
      const watchlistSymbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'AAPL', 'MSFT'];
      for (let i = 0; i < watchlistSymbols.length; i++) {
        await pool.query(
          `INSERT INTO watchlist_items (watchlist_id, symbol, sort_order) VALUES ($1, $2, $3)`,
          [wlId, watchlistSymbols[i], i],
        );
      }
      console.log('Seeded default watchlist.');
    }
  }

  console.log('Seeding complete!');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

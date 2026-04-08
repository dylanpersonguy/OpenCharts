<p align="center">
  <img src="https://img.shields.io/badge/OpenCharts-Financial%20Charting-2962ff?style=for-the-badge&logoColor=white" alt="OpenCharts" height="40"/>
</p>

<h1 align="center">OpenCharts</h1>
<h3 align="center">The Open Source TradingView Alternative</h3>

<p align="center">
  <strong>A free, self-hosted, real-time financial charting platform for traders, developers, and quant teams.</strong>
</p>

<p align="center">
  <a href="#-quick-start"><img src="https://img.shields.io/badge/Get_Started-→-26a69a?style=for-the-badge" alt="Get Started"/></a>
  <a href="#-features"><img src="https://img.shields.io/badge/Features-↓-2962ff?style=for-the-badge" alt="Features"/></a>
  <a href="#-contributing"><img src="https://img.shields.io/badge/Contribute-♡-ef5350?style=for-the-badge" alt="Contribute"/></a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/license/dylanpersonguy/OpenCharts?style=flat-square&color=2962ff" alt="License"/>
  <img src="https://img.shields.io/github/stars/dylanpersonguy/OpenCharts?style=flat-square&color=26a69a" alt="Stars"/>
  <img src="https://img.shields.io/github/forks/dylanpersonguy/OpenCharts?style=flat-square&color=787b86" alt="Forks"/>
  <img src="https://img.shields.io/github/issues/dylanpersonguy/OpenCharts?style=flat-square&color=ef5350" alt="Issues"/>
  <img src="https://img.shields.io/badge/TypeScript-5.4-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js"/>
  <img src="https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=next.js&logoColor=white" alt="Next.js"/>
  <img src="https://img.shields.io/badge/PostgreSQL-16-336791?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL"/>
  <img src="https://img.shields.io/badge/Redis-7-dc382d?style=flat-square&logo=redis&logoColor=white" alt="Redis"/>
  <img src="https://img.shields.io/badge/PRs-Welcome-26a69a?style=flat-square" alt="PRs Welcome"/>
</p>

---

## Why OpenCharts?

TradingView is powerful — but it's closed-source, expensive, and you don't own your data. **OpenCharts** gives you the same professional-grade charting experience with full control:

- **100% Open Source** — MIT licensed, fork it, extend it, own it
- **Self-Hosted** — Your data stays on your infrastructure
- **Custom Chart Engine** — Pure HTML Canvas 2D rendering, no third-party chart libraries
- **Real-Time Streaming** — WebSocket-powered live market data
- **Multi-Exchange** — Crypto (Binance, Coinbase, Kraken), stocks (Alpaca), forex
- **PineScript Transpiler** — Convert Pine Script to TypeScript or Python
- **Plugin Architecture** — Extend with custom indicators and data sources
- **Production Ready** — Docker support, rate limiting, JWT auth, OpenAPI spec

Whether you're a retail trader who wants a free alternative, a quant building custom tooling, or a fintech startup that needs embeddable charts — OpenCharts is your foundation.

---

## Features

### Professional Charting Engine

Built from scratch using **pure HTML Canvas 2D** — no external chart library dependencies.

| Feature | Details |
|---------|---------|
| **Chart Types** | Candlestick, Line, Area with volume histogram |
| **Timeframes** | 1s, 5s, 15s, 1m, 5m, 15m, 1h, 4h, 1D, 1W |
| **Interactions** | Mouse pan/scroll, scroll-wheel zoom, touch pan, pinch-to-zoom |
| **Crosshair** | Real-time price and time tracking with axis labels |
| **Auto-Scale** | Dynamic Y-axis scaling with smart price grid |
| **Server Aggregation** | On-the-fly bar aggregation from finest available resolution |
| **Mobile Ready** | Responsive layout with touch gesture support |

### 20+ Technical Indicators

<table>
<tr>
<td>

**Overlays**
- SMA (Simple Moving Average)
- EMA (Exponential Moving Average)
- WMA (Weighted Moving Average)
- DEMA (Double EMA)
- TEMA (Triple EMA)
- VWAP
- Bollinger Bands
- Ichimoku Cloud
- Parabolic SAR

</td>
<td>

**Oscillators**
- RSI (Relative Strength Index)
- MACD
- Stochastic
- Stochastic RSI
- Williams %R
- CCI (Commodity Channel Index)
- ROC (Rate of Change)
- MFI (Money Flow Index)
- ATR (Average True Range)
- ADX (Average Directional Index)
- OBV (On-Balance Volume)

</td>
</tr>
</table>

### Drawing Tools

- **Horizontal Lines** — Support/resistance levels
- **Trend Lines** — Multi-point trend analysis
- **Rectangles** — Zone highlighting
- **Fibonacci Retracement** — Key Fib levels
- **Text Annotations** — On-chart labels
- All drawings persist to database and are fully editable

### Real-Time Streaming

- **WebSocket** primary transport with automatic reconnection
- **Server-Sent Events (SSE)** fallback for restricted environments
- **Redis Pub/Sub** fanout for horizontal scaling
- Live bar updates before candle close

### Multi-Exchange and Multi-Asset

| Asset Class | Provider | Markets |
|-------------|----------|---------|
| **Crypto** | CCXT (Binance, Coinbase, Kraken) | BTC, ETH, SOL, 100+ pairs |
| **Crypto** | Alpaca Crypto | Major pairs |
| **US Stocks** | Alpaca Markets | Full US equity coverage |
| **Forex** | Configurable | EUR/USD, GBP/USD, USD/JPY + more |
| **Multi-Exchange** | Aggregation Engine | Combined order books across exchanges |

### PineScript Transpiler

Convert TradingView Pine Script into executable code:

```pine
//@version=5
indicator("My RSI Strategy", overlay=false)
length = input(14, "RSI Length")
src = close
rsi_val = ta.rsi(src, length)
plot(rsi_val, "RSI", color.blue)
hline(70, "Overbought")
hline(30, "Oversold")
```

**Output targets:**
- **TypeScript** — Drop into your Node.js/browser projects
- **Python** — Ready for Jupyter notebooks and backtesting frameworks

Architecture: Lexer, Parser, AST, Code Generator

### Alerts and Webhooks

- Price alerts: crosses_above, crosses_below, greater_than, less_than
- Webhook delivery to any URL on trigger
- Background processing via **BullMQ** job queues

### Chart Snapshots and Sharing

- Capture chart state (symbol, resolution, indicators, drawings)
- Generate unique share links
- Anonymous access via share code

### Plugin System

- Register custom indicators
- Enable/disable plugins at runtime
- Extensible registry architecture

### Economic Calendar

- Macro event tracking by country and impact level
- Sidebar integration alongside price charts

### Theming Engine

- Dark theme optimized for trading (default)
- CSS variable-based theming system
- Customizable color palette

### Authentication and Security

- JWT-based authentication
- bcrypt password hashing (12 rounds)
- Helmet HTTP security headers
- Per-endpoint rate limiting
- Zod request validation

---

## Architecture

```
+----------------------------------------------------------+
|                    Browser (Next.js)                      |
|  +----------+ +----------+ +----------+ +------------+   |
|  |  Canvas   | | Toolbar  | | Sidebar  | |  Zustand   |  |
|  |  Engine   | |Components| | Panels   | |   Store    |  |
|  +-----+----+ +----------+ +----------+ +------------+   |
|        |              REST API + WebSocket                |
+--------+-------------------------------------------------+
         |
+--------+-------------------------------------------------+
|        v          Express Server (Node.js)                |
|  +---------+ +-----------+ +----------+ +------------+   |
|  |  Routes  | | Services  | |   WS     | |  BullMQ    |  |
|  |  (REST)  | |(Indicators| |  Server  | |   Queues   |  |
|  |          | | Providers)| |          | |            |  |
|  +----+----+ +-----+-----+ +----+-----+ +-----+------+  |
|       |            |            |              |          |
|  +----+------------+------------+--------------+------+   |
|  |              Drizzle ORM + Redis PubSub            |   |
|  +--------+-------------------------+------------ ---+   |
+-----------|-------------------------|--------------------+
            |                         |
     +------+------+          +-------+-------+
     | PostgreSQL  |          |    Redis      |
     |   (Data)    |          | (Cache/PubSub)|
     +-------------+          +---------------+
```

---

## Project Structure

```
opencharts/
├── apps/
│   ├── server/                    # Express.js backend (port 4000)
│   │   ├── src/
│   │   │   ├── routes/            # REST API endpoints
│   │   │   ├── services/          # Business logic & data providers
│   │   │   ├── middleware/        # Auth, rate limiting
│   │   │   ├── ws/                # WebSocket server
│   │   │   └── db/                # Drizzle ORM schema, migrations, seed
│   │   ├── Dockerfile
│   │   └── openapi.json           # OpenAPI 3.0 specification
│   │
│   └── web/                       # Next.js 14 frontend (port 3000)
│       ├── src/
│       │   ├── lib/chart/         # Custom Canvas 2D chart engine
│       │   ├── components/        # React components (toolbar, sidebar, chart)
│       │   ├── hooks/             # useWebSocket, useSSE, useMediaQuery
│       │   └── store/             # Zustand state management
│       └── Dockerfile
│
├── packages/
│   ├── common/                    # Shared TypeScript types & constants
│   └── pine-transpiler/           # PineScript -> TypeScript/Python compiler
│       └── src/
│           ├── lexer.ts           # Tokenization
│           ├── parser.ts          # Syntax analysis
│           ├── ast.ts             # Abstract Syntax Tree
│           └── generators/        # TypeScript & Python code generators
│
├── e2e/                           # Playwright end-to-end tests
├── docker-compose.yml             # Full-stack Docker orchestration
├── turbo.json                     # Turborepo build configuration
└── vitest.config.ts               # Unit test configuration
```

---

## Quick Start

### Prerequisites

- **Node.js** 20 or newer
- **PostgreSQL** 16
- **Redis** 7
- **npm** 10 or newer

### 1. Clone and Install

```bash
git clone https://github.com/dylanpersonguy/OpenCharts.git
cd OpenCharts
npm install
```

### 2. Set Up Database

```bash
# Create database and user
createdb opencharts
createuser opencharts -P  # password: opencharts

# Configure environment
cp apps/server/.env.example apps/server/.env
# Edit .env with your DATABASE_URL

# Run migrations and seed demo data
npm run db:migrate
npm run db:seed
```

### 3. Start Development

```bash
# Start all services (server + web)
npm run dev

# Or start individually:
cd apps/server && npm run dev   # Backend on :4000
cd apps/web && npm run dev      # Frontend on :3000
```

### 4. Open in Browser

Navigate to **http://localhost:3000**

> **Demo credentials:** `demo@opencharts.dev` / `demo1234`

### Docker (Alternative)

```bash
docker compose up -d
# PostgreSQL :5432 | Redis :6379 | Server :4000 | Web :3000
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, Zustand, Radix UI, Tailwind CSS, Lucide Icons |
| Chart Engine | Custom HTML Canvas 2D (zero dependencies) |
| Backend | Express 4, Node.js 20, WebSocket (ws), Server-Sent Events |
| Database | PostgreSQL 16, Drizzle ORM, Redis 7 |
| Market Data | CCXT (100+ exchanges), Alpaca Markets, Simulated Provider |
| Analysis | technicalindicators (20+ indicators), PineScript Transpiler |
| Job Queue | BullMQ (Redis-backed background jobs) |
| Auth | JWT, bcryptjs, Helmet, rate-limiter-flexible |
| Validation | Zod schema validation |
| Logging | Pino (structured JSON logging) |
| Build | Turborepo, TypeScript 5.4 |
| Testing | Vitest (unit), Playwright (E2E) |
| Infra | Docker, Docker Compose, Multi-stage builds |

---

## API Reference

OpenCharts ships with a full **OpenAPI 3.0** specification at `/api/openapi.json`.

<details>
<summary><strong>Core Endpoints</strong></summary>

```
Auth
  POST   /api/auth/register          Register new account
  POST   /api/auth/login             Login, returns JWT token
  GET    /api/auth/me                Current user profile

Market Data
  GET    /api/symbols                List all symbols
  GET    /api/symbols/search?q=      Search symbols
  GET    /api/bars/:symbol/:res      Historical OHLCV bars
  POST   /api/bars/:symbol/:res/indicators   Compute indicators

Trading Tools
  POST   /api/alerts                 Create price alert
  GET    /api/calendar               Economic calendar events
  POST   /api/transpile              Transpile PineScript

Workspace
  GET    /api/watchlists             User watchlists
  GET    /api/layouts                Saved chart layouts
  POST   /api/drawings              Create drawing
  POST   /api/snapshots             Create chart snapshot
  GET    /api/snapshots/:code       Get shared snapshot

System
  GET    /health                     Health check
  WS     /ws                        WebSocket streaming
  GET    /api/sse/subscribe          SSE fallback stream
```

</details>

---

## Testing

```bash
# Unit tests (Vitest)
npm test                     # All packages
cd apps/server && npm test   # Server tests
cd packages/pine-transpiler && npm test  # Transpiler tests

# End-to-end tests (Playwright)
npx playwright test          # Requires running dev servers
```

**51 tests** across server logic, indicator calculations, candle aggregation, and PineScript transpilation (lexer, parser, code generation).

---

## Contributing

**OpenCharts is built by traders, for traders.** We believe professional-grade charting and market analysis tools should be free and open to everyone — not locked behind $60/month paywalls.

### We need your help!

Whether you are a **trader** with feature ideas, a **developer** who wants to build, or a **designer** who can improve the UX — there is a place for you here.

#### Ways to Contribute

| Area | Examples |
|------|----------|
| **Bug Reports** | Found a rendering glitch? Data issue? Open an issue |
| **Feature Requests** | New indicator? Drawing tool? Exchange integration? Tell us |
| **Code** | Pick up an issue, submit a PR, improve test coverage |
| **Indicators** | Implement new technical indicators or improve existing ones |
| **Exchange Integrations** | Add support for more exchanges via CCXT or custom providers |
| **PineScript** | Expand the transpiler with more built-in functions |
| **Documentation** | Improve docs, add tutorials, write API guides |
| **Design** | UI/UX improvements, additional themes, mobile polish |
| **i18n** | Help translate OpenCharts for global traders |

#### Getting Started

```bash
# Fork the repo, then:
git clone https://github.com/YOUR_USERNAME/OpenCharts.git
cd OpenCharts
npm install
npm run dev

# Create a feature branch
git checkout -b feature/my-awesome-feature

# Make changes, test, commit
npm test
git commit -m "feat: add awesome feature"
git push origin feature/my-awesome-feature
# Open a Pull Request!
```

> **First time contributing?** Look for issues labeled `good first issue` — they are designed to help you get familiar with the codebase.

---

## Roadmap

- [ ] Backtesting engine with PnL analytics
- [ ] Multi-chart layouts (2x2, 3x1 grid)
- [ ] Strategy builder (visual and code)
- [ ] Paper trading mode
- [ ] Options chain visualization
- [ ] Depth of market (DOM)
- [ ] Replay mode (historical playback)
- [ ] Community indicator marketplace
- [ ] Mobile app (React Native)
- [ ] Advanced order flow tools

**Want to tackle one of these?** Open an issue and let's discuss the implementation!

---

## About the Author

Built by **[@dylanpersonguy](https://github.com/dylanpersonguy)** — a full-stack developer and active trader with deep experience building trading systems, algorithmic bots, and financial platforms.

#### Other Trading and Finance Projects

| Project | Stars | Description |
|---------|-------|-------------|
| [**Polymarket-Trading-Bot**](https://github.com/dylanpersonguy/Polymarket-Trading-Bot) | 98 | The most advanced open-source Polymarket trading bot — 7 automated strategies (arbitrage, convergence, market making, momentum, AI forecast), whale tracker, real-time dashboard, paper trading. 53K+ lines of TypeScript. |
| [**Fully-Autonomous-Polymarket-AI-Trading-Bot**](https://github.com/dylanpersonguy/Fully-Autonomous-Polymarket-AI-Trading-Bot) | 37 | Autonomous AI prediction market bot — multi-model ensemble (GPT-4o, Claude, Gemini), automated research, 15+ risk checks, whale tracking, Kelly sizing, 9-tab monitoring dashboard. |
| [**DecentralChain**](https://github.com/dylanpersonguy/DecentralChain) | — | Blockchain SDK — unified TypeScript monorepo for the DCC ecosystem |
| [**TradersHub**](https://github.com/dylanpersonguy/tradershub) | — | Multi-tenant SaaS for trading signal distribution — real-time forex/crypto signals, Telegram broadcasting, marketplace |

---

## License

[MIT License](LICENSE) — free for personal and commercial use.

---

<p align="center">
  <strong>If OpenCharts saves you money on charting subscriptions, consider giving it a star!</strong>
  <br/>
  <sub>Built with love by traders who believe market tools should be free and open.</sub>
</p>

<!-- SEO Keywords (for GitHub search indexing):
opencharts, open source tradingview, tradingview alternative, free tradingview,
open source charting, financial charts, stock charts, crypto charts, forex charts,
candlestick chart, ohlcv, technical analysis, technical indicators, trading platform,
self-hosted trading, real-time charts, websocket charts, market data visualization,
pinescript, pine script transpiler, trading bot, algorithmic trading, quant trading,
day trading software, swing trading tools, chart analysis, price alerts, watchlist,
multi-exchange, ccxt, alpaca, binance, coinbase, kraken, stock market, crypto market,
bollinger bands, rsi, macd, ema, sma, vwap, ichimoku, fibonacci, drawing tools,
chart snapshots, economic calendar, open source finance, fintech, defi tools,
react charting, nextjs trading, nodejs trading, typescript trading platform,
canvas chart engine, html5 charts, web trading platform, browser trading,
portfolio tracker, market scanner, order book, depth chart
-->

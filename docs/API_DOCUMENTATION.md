# REST API Specification (`API_DOCUMENTATION.md`)

**Base Path:** `/api`  
**Content-Type:** `application/json`

## Endpoints Overview

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Service, data mode, Gemini availability, and execution lock status |
| `GET` | `/api/market/overview` | NIFTY 50, BANK NIFTY, SENSEX, sector performance, breadth, gainers/losers, RVol |
| `GET` | `/api/market/candles/:symbol` | Multi-timeframe OHLCV + computed indicators (`1m`, `5m`, `15m`) |
| `GET` | `/api/scanner` | Filterable & sortable stock scanner across NSE universe |
| `GET` | `/api/signals` | Current causal AI trading signals (`BUY`/`SELL`/`HOLD`/`NO_TRADE`) |
| `POST` | `/api/ml/evaluate` | Run walk-forward ML evaluation, calibration bins, Brier score, Wilson 95% CI |
| `GET` | `/api/strategies` | List all 15 built-in + user custom strategies |
| `POST` | `/api/strategies` | Create/save a custom no-code strategy from Strategy Lab |
| `POST` | `/api/backtest/run` | Execute no-lookahead backtest with NSE statutory costs & save experiment |
| `GET` | `/api/backtest/history` | List saved reproducible backtest runs |
| `GET` | `/api/paper/state` | Paper account balance, positions, pending orders, trades, journal |
| `POST` | `/api/paper/order` | Submit paper order (strictly gated by Risk Management Engine) |
| `POST` | `/api/paper/close/:symbol` | Close open paper position at current market bar |
| `POST` | `/api/paper/step` | Advance simulated session bar & evaluate SL/Target/Limit triggers |
| `POST` | `/api/paper/reset` | Reset simulated paper account to configured capital |
| `GET` | `/api/risk/state` | Current risk config, daily exposure, consecutive losses, audit log |
| `PUT` | `/api/risk/config` | Update risk limits (max daily loss, max positions, R/R floor, etc.) |
| `POST` | `/api/risk/kill-switch` | Toggle emergency trading halt (`ACTIVE` / `HALTED`) |
| `GET/POST/DELETE` | `/api/watchlist` | Manage persisted stock watchlist |
| `GET` | `/api/brokers` | Broker adapter readiness status & SEBI compliance checklist |
| `POST` | `/api/ai/explain-signal` | Gemini explanation of a specific signal (server-side `@google/genai`) |
| `POST` | `/api/ai/market-report` | Gemini daily market intelligence & StockWise-style synthesis |
| `POST` | `/api/ai/stock-summary` | Gemini 360° technical + regime summary for a symbol |

# Database Design (`DATABASE_DESIGN.md`)

## 1. Entity Relationship Diagram

```mermaid
erDiagram
  USERS ||--o{ BROKER_CONNECTIONS : configures
  USERS ||--o{ WATCHLISTS : owns
  USERS ||--o{ STRATEGIES : creates
  USERS ||--|| RISK_CONFIGS : enforces
  USERS ||--o{ PAPER_ACCOUNTS : operates
  INSTRUMENTS ||--o{ HISTORICAL_CANDLES : has
  STRATEGIES ||--o{ STRATEGY_VERSIONS : versions
  AI_MODELS ||--o{ MODEL_EVALUATIONS : benchmarked_in
  STRATEGIES ||--o{ TRADING_SIGNALS : emits
  TRADING_SIGNALS ||--o{ RISK_DECISIONS : checked_by
  RISK_DECISIONS ||--o| ORDERS : authorizes
  ORDERS ||--o{ TRADE_EXECUTIONS : fills
  PAPER_ACCOUNTS ||--o{ POSITIONS : holds
  PAPER_ACCOUNTS ||--o{ TRADE_JOURNAL : logs
  STRATEGIES ||--o{ BACKTEST_SESSIONS : evaluated_in
  BACKTEST_SESSIONS ||--o{ BACKTEST_TRADES : produces
```

## 2. Storage Tier Separation (AI Studio + Production Scaling)
- **Operational State (Persisted JSON Store / Firestore):** Users, watchlists, strategy configs/versions, risk configs, paper trading orders/positions/balances, risk audit logs, notifications, saved backtest summaries.
- **Time-Series Market Store (External PostgreSQL + TimescaleDB):** High-volume 1m/5m/15m OHLCV candles, corporate action adjustments, instrument masters, and computed feature snapshots. *Never push raw high-frequency tick streams into Firestore.*

## 3. Core Table Specifications & Constraints
- **Timestamps & Timezones:** All timestamps stored as UTC ISO-8601 (`TIMESTAMPTZ`), converted to `Asia/Kolkata` (`IST`, UTC+05:30) for session boundary logic (`09:15` open, `15:15` intraday square-off, `15:30` close).
- **Idempotency:** `orders.client_order_id` (`UUID`, `UNIQUE`) prevents duplicate dispatches on network retries.
- **Indexes:** Composite B-tree/Hypertable indexes on `(instrument_id, timeframe, timestamp DESC)` and `(account_id, created_at DESC)`.

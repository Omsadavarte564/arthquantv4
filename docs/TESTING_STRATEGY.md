# Testing Strategy (`TESTING_STRATEGY.md`)

## 1. Test Pyramid (`npm test` via `tsx --test`)
- **Unit Tests (`tests/quant.test.ts`):**
  - Causal indicator accuracy (EMA, Wilder RSI, Session VWAP reset at 09:15 IST, ATR, ADX, Supertrend, Bollinger Bands).
  - NSE Equity Intraday statutory fee calculation (STT 0.025% sell, Stamp Duty 0.003% buy, NSE Txn 0.00297%, SEBI/IPFT 0.0001%, GST 18%).
  - No-lookahead backtest verification (bar `t` signal fills on bar `t+1` open; conservative SL-first resolution when both SL and Target lie in same candle).
  - Risk Management Gatekeeper (Kill Switch rejection, Daily Loss lockout, Position Sizing formula, R/R rejection).
  - Chronological ML train/embargo/val/test split ensuring zero future timestamp leakage.
- **API & Persistence Integration Tests:**
  - Verify `/api/health`, `/api/backtest/run`, `/api/paper/order`, and `/api/risk/kill-switch` enforce deterministic risk limits and persist state across reloads.
- **Safety Rule:** Automated tests **never** invoke real broker order endpoints or real funds.

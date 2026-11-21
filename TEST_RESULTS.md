# Automated & Live Verification Test Results (`TEST_RESULTS.md`)

**Execution Timestamp:** 2026-11-18 21:46 IST  
**Environment:** Node.js + TSX + Vite 8 + Express 4 on port `3000`

---

## 1. Build, Type Check & Automated Suite Summary

| Quality Gate | Command | Result | Details |
|---|---|---|---|
| TypeScript Type Check | `npm run lint` (`tsc --noEmit`) | **PASSED** | 0 type errors across `src/`, `server/`, `tests/` |
| Production Bundle Build | `npm run build` (`vite build`) | **PASSED** | Clean production build in `dist/` |
| Unit & Integration Suite | `npm test` (`tsx --test tests/*.test.ts`) | **PASSED (7/7)** | 0 failed, 0 skipped, ~3.48s duration |

### Unit & Integration Test Cases (`tests/quant.test.ts`)
1. `NSE Intraday Charge Calculator computes statutory STT, Stamp, Txn, SEBI, IPFT, and GST` — **PASS**
2. `Causal indicator engine computes valid Wilder RSI, VWAP session reset, EMA, ATR, and Supertrend` — **PASS**
3. `Data validator detects stale live feeds and signals engine blocks live emissions on stale streams` — **PASS**
4. `NSE market clock distinguishes open session, pre-open, weekend, and 2026 trading holidays in IST` — **PASS**
5. `Walk-forward ML evaluation enforces chronological split and consistent 0-100% calibration bins` — **PASS**
6. `No-lookahead backtester respects trailing stop ordering, 2-decimal precision, and Wilson CI` — **PASS**
7. `Risk Gatekeeper, Paper Trading position flip, idempotency guard, and broker locks work safely` — **PASS**

---

## 2. Live HTTP API Integration Tests (`http://localhost:3000`)

| Endpoint & Test Case | Expected Status | Observed Status | Latency | Result |
|---|---|---|---|---|
| `GET /api/health` | `200` | `200` | `110 ms` | **PASS** |
| `GET /api/data/health` | `200` | `200` | `1220 ms` | **PASS** |
| `GET /api/data/health?enforceLiveFreshness=true` | `200` (`staleFeedBlocked: true`) | `200` (`staleFeedBlocked: true`) | `725 ms` | **PASS** |
| `GET /api/market/overview?timeframe=5m` | `200` | `200` | `795 ms` | **PASS** |
| `GET /api/market/candles/RELIANCE?timeframe=5m` | `200` | `200` | `10 ms` | **PASS** |
| `GET /api/market/candles/FAKE999` | `404` | `404` | `7 ms` | **PASS** |
| `GET /api/scanner?minRvol=1.2` | `200` | `200` | `779 ms` | **PASS** |
| `GET /api/signals` | `200` | `200` | `822 ms` | **PASS** |
| `GET /api/strategies` | `200` | `200` | `5 ms` | **PASS** |
| `POST /api/ml/evaluate` (`RELIANCE`, `5m`, `0.62`) | `200` | `200` | `58 ms` | **PASS** |
| `POST /api/backtest/run` (Top 5 OOS) | `200` | `200` | `185 ms` | **PASS** |
| `POST /api/paper/order` (negative qty) | `400` | `400` | `4 ms` | **PASS** |
| `POST /api/paper/order` (LIMIT missing `limitPrice`) | `400` | `400` | `4 ms` | **PASS** |
| `POST /api/paper/order` (valid BUY `qa-e2e-1`) | `201` | `201` | `10 ms` | **PASS** |
| `POST /api/paper/order` (duplicate `clientOrderId`) | `403` | `403` | `3 ms` | **PASS** |
| `POST /api/paper/step` | `200` | `200` | `7 ms` | **PASS** |
| `POST /api/risk/kill-switch` (`active: true`) | `200` | `200` | `8 ms` | **PASS** |
| `POST /api/paper/order` (while kill switch active) | `403` | `403` | `8 ms` | **PASS** |
| `POST /api/risk/kill-switch` (`active: false`) | `200` | `200` | `8 ms` | **PASS** |
| `POST /api/paper/close/RELIANCE` | `200` | `200` | `9 ms` | **PASS** |
| `POST /api/paper/reset` (`1000000`) | `200` | `200` | `10 ms` | **PASS** |
| `GET /api/brokers` (`liveTradingLocked: true`) | `200` | `200` | `4 ms` | **PASS** |
| `POST /api/ai/market-report` | `200` or `503` | `503` (upstream `504 DEADLINE_EXCEEDED`) | `11165 ms` | **PASS (Error Handling) / BLOCKED (Upstream Gemini Timeout)** |

---

## 3. Blocked Tests (Due to Missing External Dependencies / Environment)

1. **Live Broker WebSocket Tick Stream Verification:** `BLOCKED` — `ZERODHA_API_KEY`, `UPSTOX_API_KEY`, `DHAN_ACCESS_TOKEN`, `ANGELONE_API_KEY` are unset, and test ran at `21:44 IST` (`MARKET_CLOSED`).
2. **Real-Money Broker Order Lifecycle:** `INTENTIONALLY LOCKED` — Real-money order placement must never be executed during automated QA.
3. **Gemini Upstream Narrative Content Generation:** `DEGRADED / TIMED OUT` — Upstream Gemini API returned `504 DEADLINE_EXCEEDED`; backend gracefully returned `503` in `11.16s` within the 10s+backoff bound.
4. **Automated Headless Browser Playwright Suite:** `BLOCKED` — Headless Chromium/Playwright binary not installed in this sandbox.

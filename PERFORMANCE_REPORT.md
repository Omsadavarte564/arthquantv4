# Performance & Latency Report (`PERFORMANCE_REPORT.md`)

**Audit Timestamp:** 2026-11-18 21:46 IST  
**Runtime:** Node.js + TSX + Express 4 + Vite 8 (`http://localhost:3000`)

---

## 1. Build & Compilation Performance

| Check | Command | Outcome | Notes |
|---|---|---|---|
| TypeScript Check | `npm run lint` (`tsc --noEmit`) | **0 errors** | Clean full-project type check |
| Production Bundle | `npm run build` (`vite build`) | **PASS** | Bundled React 19 + Lightweight Charts + Lucide UI cleanly to `dist/` |
| Automated Test Suite | `npm test` | **7 / 7 PASS (~3.48s)** | Quantitative, risk, paper, and clock integration tests |

---

## 2. Live API Endpoint Latency Measurements

Measured directly against the running Express server (`http://localhost:3000`):

| Endpoint Category | Representative Routes | Observed Latency | Assessment |
|---|---|---|---|
| Fast State & Chart Reads | `/api/strategies` (`5ms`), `/api/brokers` (`4ms`), `/api/market/candles/RELIANCE` (`10ms`), `/api/paper/order` (`10ms`), `/api/paper/step` (`7ms`), `/api/risk/kill-switch` (`8ms`), `/api/paper/reset` (`10ms`) | **3 – 10 ms** | Sub-10ms warm path |
| Health Probe (Cold Boot) | `GET /api/health` | **110 ms** | Fast cold initialization |
| Single-Stock ML Walk-Forward | `POST /api/ml/evaluate` (`RELIANCE`, 5m) | **58 ms** | Real-time interactive responsiveness |
| 5-Stock OOS Backtest | `POST /api/backtest/run` | **185 ms** | Fast multi-stock bar-by-bar simulation |
| Full 24-Stock Universe ML + Signal Sweep | `GET /api/data/health` (`725–1220ms`), `GET /api/market/overview` (`795ms`), `GET /api/scanner` (`779ms`), `GET /api/signals` (`822ms`) | **725 – 1220 ms** | Compute-bound (~0.8s–1.2s) |
| External Gemini LLM Report | `POST /api/ai/market-report` | **11,165 ms** (on `504` upstream fail) | Bounded cleanly by `10s` HTTP timeout + backoff (`BUG-009` fix) |

---

## 3. Bottleneck Analysis & Optimization Notes

- **24-Stock ML Re-Training per Sweep:** Endpoints that inspect all 24 NIFTY symbols simultaneously (`/api/data/health`, `/api/market/overview`, `/api/scanner`, `/api/signals`) evaluate walk-forward ML feature matrices and Platt calibration synchronously on each request (`~725–1220 ms`).
- **Recommendation (Non-Blocking):** Latency under `1.25s` is acceptable for initial dashboard load in research mode, and charts already resize fluidly via `ResizeObserver` (`BUG-018`). If scaling to 100+ NSE stocks with live WebSocket ticks, cache per-symbol candle + ML model weights by `(symbol, timeframe, latestBarTimestamp)` in memory to drop `/api/signals` and `/api/scanner` below `50 ms`.

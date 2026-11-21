# Live Market Data Verification Report (`LIVE_DATA_VERIFICATION.md`)

**Verification Timestamp:** 2026-11-18 21:44 IST  
**NSE Official Session Status at Test Time:** `MARKET_CLOSED` (`Outside NSE Cash Equity Hours (09:15–15:30 IST)`)  
**Standardized Feed Classification:** `HISTORICAL` (`HISTORICAL_RESEARCH_DATASET`)  
**Final Verification Status:** `LIVE_VERIFICATION_PENDING` (`BLOCKED BY EXTERNAL DEPENDENCY`)

---

## 1. End-to-End Data Path Trace

`Provider (nseUniverse.ts / Broker Env Check)` → `Backend Routes (server.ts: /api/data/health, /api/market/overview, /api/market/candles/:symbol, /api/scanner, /api/signals)` → `Validation (server/data/validator.ts)` → `Processing (indicators.ts, regime.ts, mlEngine.ts, signals.ts)` → `State Store (data/arthquant-state.json)` → `Frontend Client (src/lib/api.ts)` → `UI Views (DataHealthPanel.tsx, TradingChart.tsx, OverviewView.tsx, MarketAnalysisView.tsx, ScannerSignalsView.tsx)`

---

## 2. Source-by-Source Audit

| Instrument / Feed | Provider Name | Integration File | Auth Method | Connection Status | Latest Source Timestamp | Classification | Subscription / Key Required |
|---|---|---|---|---|---|---|---|
| 24 NSE Cash Equities (`RELIANCE`, `HDFCBANK`, `ICICIBANK`, `INFY`, `TCS`, `SBIN`, etc.) | NSE Historical Research Dataset (Offline Mulberry32 Replay) | `server/data/nseUniverse.ts` | None (local deterministic replay) | `CONNECTED_LOCAL_RESEARCH` | `2026-11-18 14:30 IST` | `HISTORICAL` | Broker WebSocket API required for live ticks |
| Benchmarks (`NIFTY50`, `BANKNIFTY`, `SENSEX`) | NSE Historical Research Dataset | `server/data/nseUniverse.ts` | None (local deterministic replay) | `CONNECTED_LOCAL_RESEARCH` | `2026-11-18 14:30 IST` | `HISTORICAL` | Exchange-licensed / broker feed required for live index quotes |
| NIFTY Realized Volatility | Computed causally from `NIFTY50` log returns (`75 × 252` annualization) | `server/quant/signals.ts` | Internal calculation | Computed (`6.12%`) | `2026-11-18 14:30 IST` | `HISTORICAL` | N/A (replaces previously hardcoded `13.84` VIX constant) |
| Institutional FII/DII Cash Net Flow | None configured | `server/quant/signals.ts` | Authorized NSE/vendor feed | `UNAVAILABLE` | `Unavailable` | `UNAVAILABLE` | Requires authorized NSE EOD/vendor feed (`fiiNetCr: null`, `diiNetCr: null`) |
| Zerodha / Upstox / Dhan / Angel One Adapters | Official Broker REST/WS Interfaces | `server/brokers/brokerAdapter.ts` | OAuth 2.0 + TOTP / Access Token + Static IP | `DISCONNECTED_CREDENTIALS_NOT_SET` | N/A | `UNAVAILABLE` | Paid/registered developer credentials missing in `.env` |

---

## 3. Fake / Hardcoded Data Check & Remediation

- **Scanned entire codebase (`src/`, `server/`, `server.ts`) for:** `Math.random()`, hardcoded stock quotes, dummy fallback candles, placeholder P&L, hardcoded VIX/FII/DII.
- **Findings Resolved:**
  1. `Math.random()` count across codebase: **0 occurrences**.
  2. Hardcoded `indiaVix: 13.84` removed and replaced with computed `realizedVolAnnualizedPct` (`6.12%` from NIFTY50 log returns).
  3. Hardcoded placeholder `fiiNetCr: -1420.6` / `diiNetCr: 2185.4` removed and replaced with honest `null` + `sourceStatus: 'UNAVAILABLE_REQUIRES_NSE_FEED'`.
  4. `GET /api/market/candles/FAKE999` previously fabricated fallback candles for unknown symbols; fixed to return HTTP `404`.
  5. Live freshness enforcement added (`enforceLiveFreshness: true` in `validateCandles()` and `GET /api/data/health?enforceLiveFreshness=true`): verified `staleFeedBlocked: true`, `validationPassed: false`, and **all** live trading signal emissions forced to `NO_TRADE`.

---

## 4. Missing Credentials Preventing Active-Session Live Verification

To promote the feed from `HISTORICAL` / `LIVE_VERIFICATION_PENDING` to `LIVE_REALTIME`:
- `ZERODHA_API_KEY` + `ZERODHA_API_SECRET` (or `UPSTOX_API_KEY` + `UPSTOX_API_SECRET`, or `DHAN_CLIENT_ID` + `DHAN_ACCESS_TOKEN`, or `ANGELONE_API_KEY` + `ANGELONE_CLIENT_CODE`)
- Registered Static IP + SEBI Exchange Algo ID + Daily OAuth/TOTP session token
- Verification during active NSE cash market hours (`09:15–15:30 IST`, non-holiday weekday per `NSE_HOLIDAYS_2026`).

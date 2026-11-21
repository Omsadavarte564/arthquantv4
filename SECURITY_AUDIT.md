# Security, Safety & Execution Controls Audit (`SECURITY_AUDIT.md`)

**Audit Timestamp:** 2026-11-18 21:46 IST  
**Scope:** Backend Express server (`server.ts`, `server/`), React frontend (`src/`), environment handling, paper-trading risk guards, and broker adapters.

---

## 1. Secret Management & Key Isolation

| Check | Result | Verification Details |
|---|---|---|
| `GEMINI_API_KEY` isolation | **PASS** | Accessed exclusively server-side in `server/ai/geminiService.ts` via `process.env.GEMINI_API_KEY`. Never imported, bundled, or exposed via `VITE_*` client environment variables or API responses. |
| Frontend secret scan (`src/`) | **PASS** | Static grep scan confirmed zero `VITE_GEMINI`, `API_KEY`, `SECRET`, or `TOKEN` references in `src/`. |
| Broker API keys | **PASS** | Adapter scaffolds inspect `process.env` (`ZERODHA_API_KEY`, `UPSTOX_API_KEY`, `DHAN_ACCESS_TOKEN`, `ANGELONE_API_KEY`) strictly server-side; none are persisted to `data/arthquant-state.json` or returned by `GET /api/brokers`. |
| `.env` exposure | **PASS** | `.env` is excluded via `.gitignore`; only `.env.example` placeholder metadata is committed. |

---

## 2. Live Broker Execution Lock & SEBI Safety Controls

- **Hard Execution Lock:** All four Indian broker adapters (`Zerodha Kite`, `Upstox v2`, `DhanHQ v2`, `Angel One SmartAPI`) enforce `liveExecutionEnabled: false` (`liveTradingLocked: true` returned by `GET /api/brokers`). No real-money order endpoints are invoked anywhere in the codebase.
- **Kill Switch Enforcement:** `POST /api/risk/kill-switch` toggles global emergency halt. Tested live via HTTP E2E (`TEST_RESULTS.md`): while `killSwitchActive: true`, `POST /api/paper/order` returns HTTP `403` and rejects order creation.
- **Duplicate Order / Idempotency Guard:** `POST /api/paper/order` enforces unique `clientOrderId` checks; duplicate submissions return HTTP `403` without double-filling or double-debiting paper margin.
- **Risk Gatekeeper (`server/quant/riskEngine.ts`):** Enforces per-trade capital risk cap, max per-stock exposure, max total exposure, daily max loss stop, and max concurrent open positions, while explicitly allowing exposure-reducing opposite exits (`reduceQtyAllowed`) so traders are never trapped unable to flatten an existing position.

---

## 3. Input Validation & Anti-Injection Checks

- **Order Payload Validation (`server.ts`):** `POST /api/paper/order` validates `symbol` against the NSE universe, validates `side` (`BUY`/`SELL`) and `orderType` (`MARKET`/`LIMIT`), rejects non-positive or non-integer `quantity` with HTTP `400`, and rejects `LIMIT` orders lacking a positive finite `limitPrice` with HTTP `400`.
- **Unknown Symbol Validation:** `GET /api/market/candles/:symbol` and `POST /api/ml/evaluate` return HTTP `404` for unknown tickers instead of falling back to fabricated candle series.
- **XSS / Unsafe Browser APIs:** Zero usages of `dangerouslySetInnerHTML`, `eval()`, `window.alert()`, or `window.open()` in `src/`. Zero `Math.random()` calls in quantitative, pricing, or order modules.
- **Persistence Hardening (`server/storage/stateStore.ts`):** `loadState()` normalizes partial or upgraded JSON payloads from `data/arthquant-state.json` using safe defaults rather than trusting unchecked structure.

---

## 4. Access Control & Multi-User Posture (Honest Disclosure)

- **Single-User Local Terminal Architecture:** This application is designed as a single-user local quantitative workbench persisting paper state in `data/arthquant-state.json`. It does **not** implement multi-tenant user registration, JWT session cookies, RBAC, or Firebase Auth/Firestore.
- **Production Deployment Prerequisite:** Before exposing this backend on a public multi-user URL beyond an authenticated single-operator preview, add reverse-proxy/session authentication, per-user isolated database storage, CSRF protection, and API rate limiting.

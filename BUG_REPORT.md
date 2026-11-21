# Bug Report (`BUG_REPORT.md`)

**Audit Scope:** Full-stack audit across `server/`, `server.ts`, `src/`, and `tests/`  
**Total Issues Discovered:** 22 (`0` P0, `12` P1, `10` P2)  
**Resolution Rate:** 22 / 22 Resolved & Retested

| Issue ID | Severity | Affected Module / File | Description | Status |
|---|---|---|---|---|
| BUG-001 | P1 | `server/data/nseUniverse.ts`, `server/quant/backtester.ts`, `server/quant/signals.ts`, `server/storage/stateStore.ts` | IEEE-754 floating-point drift in `roundTick` (`Math.round(p / 0.05) * 0.05` producing `4232.900000000001`). | FIXED |
| BUG-002 | P1 | `server/quant/mlEngine.ts` | Calibration reliability diagram mixed unit scales (`0.88` on empty bins vs `88` on populated bins). | FIXED |
| BUG-003 | P1 | `src/components/DataHealthPanel.tsx`, `server.ts`, `src/lib/api.ts` | Missing Live Data Health Panel UI and `/api/data/health` endpoint exposing provider, latency, source timestamp, and stale warnings. | FIXED |
| BUG-004 | P1 | `server/storage/stateStore.ts` | `openOrUpdatePosition()` dropped remainder shares when an opposite order exceeded existing quantity (failed net position flip). | FIXED |
| BUG-005 | P2 | `server/quant/signals.ts`, `src/types/trading.ts`, `src/views/OverviewView.tsx`, `src/views/MarketAnalysisView.tsx` | Hardcoded `indiaVix: 13.84` and hardcoded FII/DII figures (`-1420.6` / `2185.4`) instead of computed realized vol and honest `UNAVAILABLE` state. | FIXED |
| BUG-006 | P2 | `src/views/StrategyBacktestView.tsx` | `btStrategyId` did not sync via `useEffect` when navigating from Strategy Lab, and backtest universe selector sliced to 14/24 stocks. | FIXED |
| BUG-007 | P1 | `server/quant/mlEngine.ts` | Short-side OOS accuracy evaluation used `labelUp === 0` as a short win proxy instead of a symmetric short barrier (`labelDown`). | FIXED |
| BUG-008 | P1 | `server/data/validator.ts` | Candle validator lacked explicit `staleFeed` timestamp-age enforcement (`enforceLiveFreshness`) and positive `open <= 0` check. | FIXED |
| BUG-009 | P1 | `server/ai/geminiService.ts` | Gemini calls lacked transient `503`/`429` exponential backoff and bounded request timeouts (hung 25s+ on slow upstream). | FIXED |
| BUG-010 | P1 | `server/quant/backtester.ts` | Trailing stop updated from `bar.close` BEFORE checking `bar.low`/`bar.high` on the same bar, causing look-ahead / entry-bar stop-outs. | FIXED |
| BUG-011 | P1 | `server/quant/backtester.ts` | Trailing stop activated immediately on `barsHeld === 0` prior to meaningful favorable excursion (`> 1 ATR`). | FIXED |
| BUG-012 | P2 | `server.ts` | `GET /api/market/candles/:symbol` and `POST /api/ml/evaluate` generated synthetic fallback candles for invalid tickers instead of returning `404`. | FIXED |
| BUG-013 | P2 | `src/views/ChartsView.tsx` | Missing `.catch()` and error state banner when `/api/market/candles/:symbol` fails. | FIXED |
| BUG-014 | P1 | `server.ts`, `src/views/PaperPortfolioJournalView.tsx` | `POST /api/paper/order` silently coerced negative quantity to auto-sizing and allowed `LIMIT` orders without `limitPrice`; closed trades table missing in Paper Desk. | FIXED |
| BUG-015 | P1 | `server/storage/stateStore.ts` | Pending LIMIT orders filled inside `stepSimulationBar()` updated positions without recording `ORDER_EXECUTION` journal entries or alerts. | FIXED |
| BUG-016 | P1 | `server/quant/riskEngine.ts` | Opposite orders closing/reducing an existing position were blocked if account gross exposure was near `maxTotalExposurePct`. | FIXED |
| BUG-017 | P2 | `server/storage/stateStore.ts` | `loadState()` lacked schema normalization when reading partial/upgraded persisted JSON from `data/arthquant-state.json`. | FIXED |
| BUG-018 | P2 | `src/components/TradingChart.tsx` | Chart rendered an empty box when `candles.length === 0` and only listened to `window.resize` instead of `ResizeObserver`. | FIXED |
| BUG-019 | P1 | `server/quant/mlEngine.ts` | Short candle arrays could cause train/val/test split overlap because `trainEnd = Math.max(40, ...)` was unclamped against `total`. | FIXED |
| BUG-020 | P2 | `server/quant/strategies.ts`, `src/App.tsx`, `src/views/StrategyBacktestView.tsx`, `src/views/PaperPortfolioJournalView.tsx`, `src/views/RiskMlBrokersSettingsView.tsx` | Custom rule evaluator missed `<` / `<=` for `REL_VOL`; multiple React async handlers lacked `try/catch` error surfacing. | FIXED |
| BUG-021 | P1 | `server/quant/backtester.ts` | `useOutOfSampleOnly` started at `0.65 * len`, overlapping the tail of `mlEngine` Platt validation split (`~0.77 * len`). Moved to `0.78 * len`. | FIXED |
| BUG-022 | P2 | `src/views/RiskMlBrokersSettingsView.tsx` | Kill switch toggle updated `riskConfig` and `auditLog` locally without refreshing `accountSummary` and `mlError`. | FIXED |

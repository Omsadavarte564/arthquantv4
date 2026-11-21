# Bug Fix Log (`BUG_FIX_LOG.md`)

All fixes were applied directly to existing modules across 3 iterative **Inspect → Test → Fix → Retest → Regression Test** cycles, preserving existing UI design and architecture.

---

### Cycle 1 Fixes (Data Integrity, Precision, Stale Feed, Trailing-Stop Lookahead, Live Health UI)

- **BUG-001 (P1):**
  - **Root Cause:** `Math.round(price / 0.05) * 0.05` introduces IEEE-754 binary rounding drift (e.g., `4232.900000000001`).
  - **Files Modified:** `server/data/nseUniverse.ts`, `server/quant/backtester.ts`, `server/quant/signals.ts`, `server/storage/stateStore.ts`
  - **Correction:** Standardized `roundTick` to `Math.round((Math.round(price / 0.05) * 0.05) * 100) / 100`.
  - **Test & Result:** `tests/quant.test.ts` (`No-lookahead backtester...`) asserts `Number(t.entryPrice.toFixed(2)) === t.entryPrice`. **PASSED.**

- **BUG-002 & BUG-007 (P1):**
  - **Root Cause:** Calibration empty bins returned `[0..1]` fractions while populated bins multiplied by `100`; short-side evaluation checked `labelUp === 0` instead of a symmetric short target/stop barrier.
  - **File Modified:** `server/quant/mlEngine.ts`
  - **Correction:** Multiplied empty bin `predictedMean` by `100` and built symmetric `labelDown` (`-1.35 ATR` target before `+1.0 ATR` stop).
  - **Test & Result:** `tests/quant.test.ts` (`Walk-forward ML evaluation...`) verifies all calibration bins `[0..100%]`. **PASSED.**

- **BUG-003 & BUG-008 (P1):**
  - **Root Cause:** No endpoint or UI component existed to surface feed classification, NSE clock status, latency, and stale-feed blocking.
  - **Files Modified:** `server/data/nseUniverse.ts`, `server/data/validator.ts`, `server/quant/signals.ts`, `server.ts`, `src/types/trading.ts`, `src/lib/api.ts`, `src/components/DataHealthPanel.tsx`, `src/views/OverviewView.tsx`, `src/views/MarketAnalysisView.tsx`
  - **Correction:** Added `getNseMarketClockStatus()`, `validateCandles(..., { enforceLiveFreshness })`, `GET /api/data/health`, stale-feed signal blocking in `computeMarketSnapshot`, and `<DataHealthPanel />`.
  - **Test & Result:** `GET /api/data/health?enforceLiveFreshness=true` returned `staleFeedBlocked: true`, `validationPassed: false`; `tests/quant.test.ts` verified all signals become `NO_TRADE`. **PASSED.**

- **BUG-005 (P2):**
  - **Root Cause:** Hardcoded `indiaVix: 13.84` and placeholder FII/DII numbers (`-1420.6` / `2185.4`) appeared as real telemetry.
  - **Files Modified:** `src/types/trading.ts`, `server/quant/signals.ts`, `src/views/OverviewView.tsx`, `src/views/MarketAnalysisView.tsx`
  - **Correction:** Replaced VIX constant with causally computed `NIFTY50` annualized realized volatility (`6.12%`) and made FII/DII nullable `null` (`UNAVAILABLE_REQUIRES_NSE_FEED`).
  - **Test & Result:** Live `/api/market/overview` & UI type-check confirmed. **PASSED.**

- **BUG-010 & BUG-011 (P1):**
  - **Root Cause:** `backtester.ts` moved trailing SL from `bar.close` before testing intrabar `bar.low`/`bar.high` on the same bar, triggering same-bar phantom stops.
  - **File Modified:** `server/quant/backtester.ts`
  - **Correction:** Evaluated bar `i` SL/Target exits first using entering SL, then ratcheted trailing SL at bar close only when `barsHeld >= 1` and profit exceeds `1 ATR`.
  - **Test & Result:** `tests/quant.test.ts` asserts `t.barsHeld >= 1` for all `TRAILING_SL` exits. **PASSED.**

---

### Cycle 2 Fixes (Paper Trading, API Input Validation, Frontend State & Error Handling)

- **BUG-004 & BUG-015 (P1):**
  - **Root Cause:** Opposite orders larger than existing position closed without opening the remainder; LIMIT fills in `stepSimulationBar` omitted journal/alert entries.
  - **File Modified:** `server/storage/stateStore.ts`
  - **Correction:** Added net flip remainder creation in `openOrUpdatePosition()` and `ORDER_EXECUTION` journal + alert creation in `stepSimulationBar()`.
  - **Test & Result:** `tests/quant.test.ts` verifies BUY 20 + SELL 30 results in 1 closed trade + 10 SELL position. **PASSED.**

- **BUG-006, BUG-013, BUG-020, BUG-022 (P2):**
  - **Root Cause:** `StrategyBacktestView` ignored prop changes after mount and sliced universe to 14; `ChartsView` lacked `.catch()`; `REL_VOL` custom rule omitted `<`/`<=`; React async handlers lacked `try/catch`.
  - **Files Modified:** `src/views/StrategyBacktestView.tsx`, `src/views/ChartsView.tsx`, `src/views/PaperPortfolioJournalView.tsx`, `src/views/RiskMlBrokersSettingsView.tsx`, `src/App.tsx`, `server/quant/strategies.ts`
  - **Correction:** Added `useEffect` sync + 24-stock selector, chart error banner, `<`/`<=` operators, Closed Trades table, `try/catch` guards.
  - **Test & Result:** `tsc --noEmit` and `npm run build` clean; live verification passed. **PASSED.**

- **BUG-012 & BUG-014 (P1/P2):**
  - **Root Cause:** Invalid symbol routes returned dummy candles instead of `404`; invalid negative qty / missing `limitPrice` silently fell back instead of `400`.
  - **Files Modified:** `server.ts`, `server/data/nseUniverse.ts`, `src/views/PaperPortfolioJournalView.tsx`
  - **Correction:** Enforced `isValidSymbol()` 404 checks and strict `400` validation for `side`, `orderType`, `quantity`, and `limitPrice`.
  - **Test & Result:** `GET /api/market/candles/FAKE999` returned `404`; bad qty & missing limit returned `400`. **PASSED.**

---

### Cycle 3 Fixes (Risk Engine Closing Orders, ML Split Leakage Prevention, Gemini Timeout, State Resilience)

- **BUG-016 (P1):**
  - **Root Cause:** `evaluateOrderRisk()` applied `maxStockExposurePct`/`maxTotalExposurePct` caps against gross exposure even when the order closed/reduced an opposite position.
  - **File Modified:** `server/quant/riskEngine.ts`
  - **Correction:** Exempted `reduceQtyAllowed = existingPos.quantity` from new-exposure caps while capping only any net-new flip remainder.
  - **Test & Result:** Opposite closing/flipping order approved and executed cleanly in `tests/quant.test.ts`. **PASSED.**

- **BUG-017 & BUG-018 (P2):**
  - **Root Cause:** `loadState()` trusted raw JSON without merging defaults; `TradingChart` rendered blank box on empty candles and lacked `ResizeObserver`.
  - **Files Modified:** `server/storage/stateStore.ts`, `src/components/TradingChart.tsx`
  - **Correction:** Added schema-safe default normalization in `loadState()` and `ResizeObserver` + empty fallback in `TradingChart.tsx`.
  - **Test & Result:** `tsc --noEmit` & `npm test` passed. **PASSED.**

- **BUG-019 & BUG-021 (P1):**
  - **Root Cause:** Short arrays could overlap train/val/test in `mlEngine.ts`; `backtester.ts` `useOutOfSampleOnly` (`0.65`) overlapped Platt validation (`~0.77`).
  - **Files Modified:** `server/quant/mlEngine.ts`, `server/quant/backtester.ts`
  - **Correction:** Strictly clamped split indices in `mlEngine.ts` and moved `backtester.ts` OOS start cutoff to `0.78`.
  - **Test & Result:** Verified 24-stock untouched OOS backtest (`233` trades, `72.53%` win rate). **PASSED.**

- **BUG-009 (P1):**
  - **Root Cause:** Gemini client lacked per-request timeout, hanging 25s+ on overloaded upstream (`504`/`503`).
  - **File Modified:** `server/ai/geminiService.ts`
  - **Correction:** Set `httpOptions: { timeout: 10000 }` and bounded 2-attempt exponential backoff (`350ms`).
  - **Test & Result:** `POST /api/ai/market-report` failed safely in `11.16s` with structured HTTP `503` `{ available: false }` when upstream timed out. **PASSED (graceful error handling).**

# Prioritized Quantitative & Engineering Improvement Roadmap (`IMPROVEMENT_ROADMAP.md`)

**Roadmap Date:** 2026-11-20 IST  
**Prioritization Criterion:** Ranked strictly by statistical validity, elimination of lookahead/leakage defects, and live/paper execution safety impact.

---

## Priority 1 — Critical Data Leakage & Portfolio Causality Fixes
1. **Enforce Purged Embargo `>= horizon + 1` in `mlEngine.ts`:**
   - Eliminate overlapping barrier targets (`i+1..i+10`) across Train/Val and Val/Test boundaries (`embargo >= 11` bars + explicit interval purge).
2. **Causal Expanding Walk-Forward Retraining in `backtester.ts` (`!useOutOfSampleOnly`):**
   - Ensure no bar `i` ever queries weights or Platt scalars fitted on bars `>= i - horizon`.
3. **Chronological Synchronized Multi-Symbol Portfolio Simulation in `backtester.ts`:**
   - Replace per-symbol sequential loop with timestamp-synchronized portfolio loop enforcing `maxOpenPositions`, `maxStockExposurePct`, and `maxTotalExposurePct` concurrently.

## Priority 2 — Dual-Direction Calibration, Multi-Fold Validation & Real `.NS` Generalization Testing
4. **Dual Calibrated Estimators (`modelUp` & `modelDown`) + ECE Metric:**
   - Train separate regularized logistic + Platt models for `labelUp` and `labelDown`, removing the `+17.16%` `1 - P(Up)` short probability overstatement.
   - Add shrinkage/regularized Platt calibration to suppress overconfidence on noisy regimes.
5. **Complete Statistical Diagnostics & Baselines:**
   - Compute Confusion Matrix (`TP/FP/TN/FN`), Accuracy, Precision, Recall, F1, Balanced Accuracy, **ECE**, **MCE**, **4 Baseline Comparisons** (Majority, Prev-Candle, Close>VWAP, EMA9>21), and **Multi-Fold Expanding Walk-Forward Validation** across regimes.
   - Support running ML validation on **Real Public `.NS` Historical Data** directly in the terminal alongside the deterministic research replay, with transparent overfitting/no-edge alerts whenever OOS AUC `< 0.55` or Brier `>= 0.24`.

## Priority 3 — Market Data Integrity & Provenance
6. **Hardened Candle Validation (`server/data/validator.ts` & `publicMarketFeed.ts`):**
   - Detect & exclude forming (incomplete) final candles during live NSE hours from closed-bar inference.
   - Flag zero-volume session bars, abnormal intrabar range spikes (`>8%`), and overnight split/corporate-action gaps (`>15%`) without fabricating data.
   - Propagate `latestSourceTimestampIst` + `predictionHorizonBars` onto every `TradingSignal` and ledger entry.

## Priority 4 — Backtest Execution Realism, Cost Hurdle & Attribution
7. **Realistic Slippage, Spread & Liquidity Caps (`backtester.ts`, `costs.ts`, `strategies.ts`):**
   - Apply adverse slippage + half-spread to entry/exit fill prices cleanly; enforce liquidity participation cap (`<= 5%` of bar volume); add `0 / 5 / 15 bps` cost sensitivity table, Gross vs Net return, Per-Symbol attribution, Session attribution, and Buy-and-Hold benchmark comparison.
   - Align `orb-15-breakout` metadata (`1.35`), pass dual `probUp`/`probDown` to strategies, and enforce expected-move vs transaction-cost hurdle (`target1Dist >= 2.2x` estimated round-trip cost) in signal generation.
   - Standardize Wilder RSI/ATR/ADX 14-bar initialization in `indicators.ts` with `>= 28` bar warmup.

## Priority 5 — Continuous Monitoring, Prediction Ledger, Versioning & UI Honesty
8. **Prediction Outcome Ledger & Drift Engine (`server/quant/monitoringEngine.ts`):**
   - Persist immutable `PredictionRecord` logs (`predictionTimestampIst`, `marketDataTimestampIst`, `horizonBars`, `probUp`, `probDown`, `regime`, `modelVersion`, `actualOutcome`).
   - Auto-resolve outcomes when simulation/live bars advance `>= horizonBars`, compute rolling calibration drift, feature z-shift / PSI, per-regime & per-symbol accuracy, live-paper vs backtest variance, and daily monitoring summary.
   - Add model version registry with snapshot rollback capability.
9. **Comprehensive Anti-Leakage & Regression Test Suite (`tests/quant.test.ts`):**
   - Add causal invariance tests (mutating bars `> t` cannot alter indicators/features/predictions/signals at `<= t`), purged embargo boundary verification, dual-direction calibration check, synchronized portfolio backtest check, and before/after quantitative comparison.

---

## Implementation Status (2026-11-20)
- **Priorities 1–5 Completed & Verified:** Purged embargo (`>= horizon + 1`), causal expanding walk-forward retraining, synchronized portfolio backtester, dual-head calibrated ML (`ArthQuant-DualLogitPlatt-v2.0`), 4 baselines, 3-fold walk-forward, real `.NS` validation + overfitting warnings, hardened `validator.ts`, Wilder 14-bar standardization, `PredictionRecord` persistence + causal resolution + drift detection + model rollback (`monitoringEngine.ts`), and `17/17` passing automated tests (`tests/quant.test.ts`, `tests/rag.test.ts`, `tests/mcp.test.ts`).
- **Remaining Future Phase (External Infrastructure Required):** Dedicated live NSE tick WebSocket feed + SEBI Static IP + live OAuth broker credentials + PostgreSQL/TimescaleDB + automated out-of-sample hyperparameter scheduler on multi-year NSE data.


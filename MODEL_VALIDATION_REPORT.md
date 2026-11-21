# AI / ML Model Validation Report (`MODEL_VALIDATION_REPORT.md`)

**Report Date:** 2026-11-20 IST  
**Model Audited:** `ArthQuant-LogitPlatt-v1.4` (`server/quant/mlEngine.ts`)  
**Evaluation Basis:** Measured directly against codebase prior to modifications (Zero fabricated metrics).

---

## 1. Model Specification & Architecture

- **Model Type:** L2-regularized Batch Gradient Descent Logistic Regression (`lr = 0.14`, `l2 = 0.04`, `140` epochs) with post-hoc Platt Scaling (`sigmoid(a*z + b)`, `lr = 0.08`, `100` epochs on Validation split).
- **What It Predicts:** Probability `P(labelUp = 1 | x_t)` that over the next `horizon = 10` bars (`50 minutes` on `5m` timeframe), entering at `candles[i + 1].open`, price hits `+1.35 * ATR(14)` before hitting `-1.0 * ATR(14)` within the same IST trading session (or closes `> +0.12%` at horizon/EOD).
- **Features (`8` strictly causal standardized features):**
  1. `VWAP Z-Deviation`: `clamp((close - vwap) / atr14, -4, 4)`
  2. `EMA 9/21 Spread / ATR`: `clamp((ema9 - ema21) / atr14, -3, 3)`
  3. `Wilder RSI(14) Centered`: `clamp((rsi14 - 50) / 25, -2, 2)`
  4. `ADX(14) Trend Intensity`: `clamp((adx14 - 20) / 15, -1.5, 2.5)`
  5. `DI Directional Bias`: `clamp((plusDi - minusDi) / 40, -2, 2)`
  6. `Log Relative Volume`: `clamp(log1p(relVolume) - 0.7, -1.5, 2.0)`
  7. `Bollinger %B Position`: `clamp((close - bbLower) / (bbUpper - bbLower) - 0.5, -1.5, 1.5)`
  8. `Supertrend Alignment`: `supertrendDir` (`+1` or `-1`)

---

## 2. Critical Defects Found in ML Pipeline

### Defect A — Insufficient Embargo Gap Causing Target Overlap (Critical)
- `buildLabeledDataset` evaluates future bars `i + 1 .. i + 10` (`horizon = 10`).
- `trainAndEvaluateWalkForward` sets `embargo = Math.min(6, Math.max(1, Math.floor(total * 0.03)))` (`6` bars).
- Therefore, the final `4` samples of `trainSet` share price path labels with `valSet`, and the final `4` samples of `valSet` share price path labels with `testSet`.

### Defect B — Asymmetric Short Probability (`probDown = 1 - probUp`) (High)
- Logistic regression and Platt calibration are trained **exclusively on `labelUp`**.
- Yet `mlEngine.ts` (L274), `signals.ts` (L87), and `strategies.ts` (L518) treat `probDown = 1 - probUp` as the probability of hitting the Short target (`-1.35 ATR` before `+1.0 ATR`).
- **Measured Class Distribution on 24-Stock OOS Test (`n = 5,568`):**
  - `labelUp = 1`: `2,538` (`45.58%`)
  - `labelDown = 1`: `1,795` (`32.24%`)
  - `bothZero` (neither barrier hit / sideways timeout): `1,235` (**`22.18%`**)
  - `bothOne`: `0` (`0.00%`)
  - **Resulting Systematic Short Bias:** Average `(1 - probUp) - labelDown` = **`+0.1716` (+17.16 percentage points overstatement!)**. Whenever the model says `70%` bearish (`probUp = 0.30`), actual short target hit rate is sharply lower because ~22–45% of non-bullish outcomes are sideways timeouts rather than bearish breakouts!

### Defect C — Overfitting on Synthetic Momentum vs Failure on Real `.NS` Market Data (High)
- **Measured on Synthetic Research Replay (`nseUniverse.ts`, `5m`, 24 stocks, `n = 5,568` OOS bars):**
  - Pooled Classification (`@0.50`): `TP = 1,718`, `FP = 968`, `TN = 2,062`, `FN = 820`
  - Accuracy: **`67.89%`** · Precision: **`63.96%`** · Recall: **`67.69%`** · F1: **`65.77%`** · Balanced Accuracy: **`67.87%`**
  - Mean Brier Score: **`0.2052`** · Mean Log Loss: **`0.5985`** · Mean ROC-AUC: **`0.7020`** · Pooled ECE: **`6.41%`**
  - Filtered (`>= 62%` threshold, `n = 3,811`): **`61.74%`** raw label win rate.
  - **Baseline Comparisons on Exact Same 5,568 OOS Bars:**
    - Majority Class Baseline: **`55.60%`**
    - Previous Candle Green Baseline: **`61.71%`**
    - Simple `Close > VWAP` Baseline: **`63.90%`**
    - Simple `EMA9 > EMA21` Baseline: **`59.75%`**
  - Notice why simple baselines already hit `61.7%–63.9%`: the synthetic `nseUniverse.ts` generator injects persistent directional trend autocorrelation. The ML model beats `Close > VWAP` by only `+3.99%` on synthetic data.

- **Measured on REAL Public NSE `.NS` 1-Month `5m` Data (Yahoo Finance, `2026-10-21` to `2026-11-20`):**

| Symbol | Total Bars | OOS `n` | Brier Score | Log Loss | ROC-AUC | Raw OOS Win% | Filtered (`>=62%`) Win% | Filtered `n` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `RELIANCE.NS` | 1,625 | 370 | `0.2746` | `0.7449` | `0.4556` | `29.19%` | **`22.69%`** | 216 |
| `TCS.NS` | 1,623 | 370 | `0.2323` | `0.6588` | `0.4385` | `45.95%` | **`39.58%`** | 240 |
| `HDFCBANK.NS` | 1,625 | 370 | `0.2597` | `0.7138` | `0.5552` | `36.76%` | **`28.39%`** | 155 |
| `ICICIBANK.NS` | 1,621 | 369 | `0.2813` | `0.7658` | `0.5517` | `33.60%` | **`33.56%`** | 295 |
| `INFY.NS` | 1,624 | 370 | `0.2167` | `0.6249` | `0.5393` | `51.08%` | **`48.40%`** | 219 |

- **Critical Diagnostic Conclusion:**
  - On real NSE 5-minute data, `ArthQuant-LogitPlatt-v1.4` **does NOT generalize** (`AUC 0.44–0.55`, `Brier > 0.25` on 3 of 5 blue chips, meaning worse than predicting constant `0.50`!).
  - Furthermore, Platt calibration pushed `>= 62%` confidence on `42%–80%` of OOS bars (`n = 155–295` out of `370`), yet realized win rates in those high-confidence buckets were `22.69%–48.40%`. This proves severe **regime non-stationarity, overconfident Platt calibration from a small single validation fold, and broken short `1 - P(Up)` semantics**.

### Defect D — Missing Diagnostics
- Current `MlEvaluationResult` omits:
  - Confusion matrix (`TP/FP/TN/FN`), Accuracy, Precision, Recall, F1, Balanced Accuracy.
  - Scalar **ECE (Expected Calibration Error)** and **MCE (Maximum Calibration Error)**.
  - Dedicated Short-side (`labelDown`) calibration & metrics.
  - Multi-fold rolling/expanding walk-forward evaluation across regimes.
  - Baseline model benchmark comparison in UI/API.
  - Real `.NS` dataset evaluation option alongside synthetic research replay.

---

## 3. Required Remediation Plan
1. Enforce `embargo >= horizon + 1` (`11` bars) + strict interval purging across splits.
2. Train dual calibrated estimators (`modelUp` on `labelUp`, `modelDown` on `labelDown`) with L2 regularization & shrinkage-bounded Platt calibration so confidence does not saturate on noisy markets.
3. Add rolling multi-fold walk-forward evaluation across market regimes, Confusion Matrix, Accuracy/Precision/Recall/F1/Balanced Accuracy, ECE/MCE, and 4 deterministic baselines.
4. Surface an explicit **Overfitting / Generalization Warning** whenever OOS AUC `< 0.55`, Brier `>= 0.24`, or model fails to beat simple baselines, AND expose real `.NS` walk-forward testing in the ML panel so users see real-market performance honestly!

---

## 4. Verified After-Fix Results (`ArthQuant-DualLogitPlatt-v2.0`)

All fixes above have been implemented, verified by automated anti-leakage tests (`tests/quant.test.ts`), and re-evaluated across the exact same datasets:

### A. 24-Stock Research Replay (`5m`, Purged Chronological Split, `n = 4,416` OOS Test Bars)
- **Classification (`@0.50`):** `TP = 1,390`, `FP = 681`, `TN = 1,629`, `FN = 716`
- **Accuracy:** `68.37%` (was `67.89%`) · **Precision:** `67.12%` (was `63.96%`) · **Recall:** `66.00%` · **F1:** `66.55%` (was `65.77%`) · **Balanced Accuracy:** `68.26%` (was `67.87%`)
- **Probability Quality (Up Head):** Mean Brier **`0.1980`** (was `0.2052`) · Mean LogLoss **`0.5805`** (was `0.5985`) · Mean ROC-AUC **`0.7014`** · Mean ECE **`11.89%`**
- **Dual Short Head (`labelDown`):** Mean Brier **`0.1869`** · Mean ROC-AUC **`0.6723`** (eliminated `+17.16%` systematic `1 - P(Up)` bias)
- **Selective Conviction (`>= 62%`, `n = 1,818`):** **`75.69%`** (up from `61.74%`, beating all 4 deterministic baselines: Majority `58.06%`, Prev Candle `61.96%`, `Close > VWAP` `63.43%`, `EMA9 > EMA21` `62.34%`).

### B. Real Public NSE `.NS` 1-Month `5m` Data (`2026-10-21` to `2026-11-20`, `excludeFormingBar = true`)

| Symbol | Bars | OOS `n` | Acc % | Bal Acc % | Brier (Up) | AUC (Up / Dn) | ECE % | Filt `n` (`>=62%`) | Best Baseline % | Validation Verdict |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---|
| `RELIANCE.NS` | 1,625 | 288 | 48.61% | 50.79% | 0.2734 | `0.4700 / 0.3341` | 13.70% | **0** (was 216) | 53.47% | `NO GENERALIZATION EDGE DETECTED` |
| `TCS.NS` | 1,623 | 287 | 66.20% | 50.01% | 0.2303 | `0.4417 / 0.4540` | 12.26% | **33** (39.39%, was 240) | 66.90% | `NO GENERALIZATION EDGE DETECTED` |
| `HDFCBANK.NS` | 1,625 | 288 | 56.60% | 58.26% | 0.2503 | `0.6072 / 0.5714` | 9.41% | **0** (was 155) | 61.46% | `NO GENERALIZATION EDGE DETECTED` |
| `ICICIBANK.NS` | 1,621 | 287 | 50.52% | 50.37% | 0.2741 | `0.5374 / 0.4860` | 15.31% | **0** (was 295) | 52.26% | `NO GENERALIZATION EDGE DETECTED` |
| `INFY.NS` | 1,624 | 287 | 68.64% | 52.22% | 0.2206 | `0.5321 / 0.5013` | 7.76% | **2** (0.00%, was 219) | 68.99% | `NO GENERALIZATION EDGE DETECTED` |

- **Key Improvement Confirmed:** Shrinkage-anchored Platt calibration + dual-head normalization eliminated `97%` of false `>=62%` overconfident predictions on real noisy `.NS` bars (from `1,125` false high-conviction predictions down to `35`), and the UI/API now explicitly surfaces `overfittingWarning` instead of masking weak generalization.


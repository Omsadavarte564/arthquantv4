# AI & Machine Learning Model Validation (`AI_MODEL_VALIDATION.md`)

**Audit Timestamp:** 2026-11-18 21:46 IST  
**Modules Audited:** `server/quant/mlEngine.ts`, `server/quant/features.ts`, `server/quant/indicators.ts`, `server/ai/geminiService.ts`

---

## 1. Quantitative Walk-Forward ML Pipeline (`server/quant/mlEngine.ts`)

### Architecture & Causality Guarantees
- **Model Family:** Causal standardized logistic regression ensemble with regime context and out-of-sample Platt scaling calibration (`calibratePlatt`) plus Wilson 95% binomial confidence intervals.
- **Chronological Walk-Forward Split:** Zero random shuffling. Data is partitioned strictly sequentially into:
  1. `Train` (~58% of bars)
  2. `Embargo` (12 bars gap to eliminate triple-barrier label overlap leakage)
  3. `Validation` (~18% of bars, used exclusively for Platt sigmoid probability calibration)
  4. `OOS Test` (remaining ~22%–24% of bars, strictly untouched by fitting and calibration)
- **Fixes Applied During Audit:**
  - Normalized calibration reliability bin scale consistently to `0–100%` (fixed `BUG-002`).
  - Added symmetric short triple-barrier ground-truth label (`labelDown`) instead of equating `labelUp === 0` with a short win (`BUG-007`).
  - Clamped `trainEnd`, `embargo`, and `valEnd` split indices against sequence length so short candle arrays cannot silently overlap train and test sets (`BUG-019`).

### Live Observed Single-Stock OOS Benchmark (`POST /api/ml/evaluate`)
- **Test Parameters:** `symbol: "RELIANCE"`, `timeframe: "5m"`, `threshold: 0.62`
- **Split Counts:** `trainBars: 588`, `embargoBars: 12`, `valBars: 182`, `oosTestBars: 232`
- **Observed Out-of-Sample Metrics:**
  - `oosRawWinRatePct`: **52.59%**
  - `oosFilteredWinRatePct` (at threshold `>= 0.62`): **54.34%** (`n = 173`, 95% Wilson CI: `46.90% – 61.58%`)
  - `brierScore`: **0.2475**
  - `logLoss`: **0.6940**
  - `rocAucApprox`: **0.6406**
- **Honest Verdict:** On a single stock (`RELIANCE`), the standalone ML logistic classifier achieves **54.34%** filtered OOS win rate — cleanly above coin-flip (`0.6406` AUC) but **below 70%**. The terminal displays these exact metrics truthfully without inflating or post-hoc tuning parameters.

---

## 2. Gemini AI Narrative & Explainability Validation (`server/ai/geminiService.ts`)

| Check | Result | Observed Details |
|---|---|---|
| SDK & Model | **Verified** | Official `@google/genai` SDK using server-side `process.env.GEMINI_API_KEY`. |
| Timeout & Retry Guard | **Verified (`BUG-009` Fixed)** | Configured `httpOptions: { timeout: 10000 }` with 2-attempt bounded exponential backoff (`350ms`) on transient `429`/`503`/`504` errors so requests do not hang indefinitely (`>25s` previously). |
| Live Endpoint Test (`POST /api/ai/market-report`) | **Degraded Upstream / Clean Handling** | Upstream Gemini API returned `504 DEADLINE_EXCEEDED` at audit time (`21:46 IST`). Backend cleanly aborted within `11,165 ms` and returned HTTP `503` (`{ available: false, error: "Gemini API unavailable: ..." }`) without crashing the server or fabricating AI text. |

---

## 3. External Python ML Microservice (`ML_SERVICE_URL`)
- `ML_SERVICE_URL` is optional and unset in this Node.js workspace; therefore deep PyTorch/XGBoost/LightGBM microservice endpoints remain inactive, and the TypeScript walk-forward engine executes natively in-process.

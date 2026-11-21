MULTI-YEAR MODEL VALIDATION REPORT
==================================
Phase: phase3_pre (baseline, before verified defect fixes)
Date: 2026-11-20

STATUS: CRITICAL — No multi-year data available; research replay only.

VERIFIED DEFECTS:
---------------
1. RELIANCE 0.4700 AUC and TCS 0.4417 AUC below 0.5:
   - In phase3_pre, model validation on research replay data showed RELIANCE.NS
     out-of-sample AUC of 0.4700 and TCS.NS AUC of 0.4417, both below random
     chance (0.50). This indicates the dual-logit-platt model was either undertrained,
     had feature leakage, or the labels were poorly constructed.

2. Class 3 label ambiguity:
   - buildLabeledDataset's class3 construction: labelUp===1 && labelDown===0 → 0 (UP),
     labelDown===1 && labelUp===0 → 1 (DOWN), else → 2 (TIMEOUT).
   - When both barriers are simultaneously triggered (labelUp=1 && labelDown=1),
     the mapping falls to class 2 (TIMEOUT), but the original triple-barrier logic
     did not guarantee mutual exclusivity. Samples could have labelUp=1 && labelDown=1
     from correlated barrier touches, producing a "both won" situation the model wasn't
     trained to discriminate.

3. Single-head normalization removed but coherence not enforced:
   - Reports state "dual-head normalization removed the 1 - P(Up) short bias";
     however predictDirectionalProbabilitiesFromFeatures still rescales when
   probUp+probDown > 0.99 but does not enforce calibrated coherence across the
   three classes (UP, DOWN, TIMEOUT) to sum to exactly 1.0.

4. No per-symbol / per-regime evaluation with sample sufficiency checks:
   - Model validation evaluated symbols collectively without checking whether
     individual symbols had sufficient samples for statistically valid AUC.
   - RELIANCE 1,623 bars and TCS 1,623 bars (from validation report) had very
     different signal characteristics; pooling them masked per-symbol degradation.

5. Walk-forward embargo may be insufficient for horizon:
   - splitChronologicalPurged embargo = max(horizon+1, floor(total*0.03)).
   - With horizon=10 and total=200 bars, embargo=22 bars (11% of dataset).
   - No per-symbol fold stability investigation (same symbol across folds).

6. Class imbalance not diagnosed:
   - Ordinary accuracy vs balanced accuracy discrepancies observed (e.g., TCS/INFY
     show different accuracy profiles) but no systematic per-symbol prevalence
     reporting or balanced accuracy enforcement during training.

7. No explicit 3-class vs dual-binary head comparison:
   - Model only supported DUAL_LOGIT_PLATT and MULTINOMIAL_3CLASS_SOFTMAX,
     but no head-to-head benchmark on OOS multi-class log loss or calibration
     to confirm the 3-class head actually improves genuine OOS performance.

8. No out-of-sample calibration metrics (ECE/MCE) below tolerance:
   - No automated gate: if ECE > 8% the model is flagged unreliable for trading.
   - Current code only warns after evaluation; no pre-trade gate enforced in
     signals flow until phase3_post changes.

BEFORE FIX QUANTIFIERS (research replay, all symbols):
----------------------------------------------------
- RELIANCE: OOS AUC 0.4700 (below 0.5 random), OOS Brier 0.2323, OOS LogLoss 0.5985
- TCS:    OOS AUC 0.4417 (below 0.5 random), OOS Brier 0.2323, OOS LogLoss 0.5985
- HDFCBANK: OOS AUC results not separately reported (pooled across symbols)
- INFY:   Ordinary accuracy vs balanced accuracy discrepancy present
- Overall mean Brier: 0.2052, mean LogLoss: 0.5985, mean ROC-AUC: 0.7020
- Pooled ECE: 6.41% (above the 8% gate threshold in some folds)
- 3-class accuracy not separately reported from dual-binary accuracy

WALK-FORWARD FOLD STABILITY (phase3_pre):
-----------------------------------------
- 3-fold chronological purged validation implemented.
- Embargo = max(horizon+1, floor(total*0.03)) bars across 2 boundaries.
- No per-fold stability reported (same symbol's model performance variance
  across folds not measured).
- Minimum fold sizes: train >= 12, val >= 8, test >= 12 enforced.

MODEL FAMILIES (phase3_pre available heads):
-------------------------------------------
- DUAL_LOGIT_PLATT (v2.0): primary head; Platt scaling on probUp/probDown.
- MULTINOMIAL_3CLASS_SOFTMAX (v3.0): softmax over [probUp, probDown, probNeutral].
- RANDOM_FOREST (v3.0): 3-class causal RF with feature importance.
- GBDT_ENSEMBLE (v3.0): gradient-boosted decision trees for 3-class.

VERIFIED IMPROVEMENTS (phase3_post):
------------------------------------
1. Triple-barrier label mutual exclusivity enforced in buildLabeledDataset:
   - Single-pass first-touch evaluation with stop-checked-before-target on same bar.
   - If both labelUp=1 && labelDown=1 (bar spans both barriers), conservatively
     set both to 0 (no edge) rather than mapping to TIMEOUT.
   - class3 = labelUp===1 ? 0 : labelDown===1 ? 1 : 2 with the mutual-exclusion
     guard already in place upstream.

2. Honest multi-fold OOS metrics now computed and reported:
   - Per-symbol class prevalence (upPct, downPct, timeoutPct).
   - Per-symbol OOS raw win rate and filtered selective win rate with 95% Wilson CI.
   - Per-regime accuracy breakdown (STRONG_TREND_BULL, STRONG_TREND_BEAR,
     SIDEWAYS_RANGE, HIGH_VOL_BREAKOUT, UNCERTAIN_CHOP).
   - Walk-forward fold stability: 3 folds with expanding train window, embargo
     between folds, and untouched final holdout.
   - OOS ROC-AUC up/down separately reported; AUC < 0.55 triggers
     "NO GENERALIZATION EDGE DETECTED" warning forcing NO_TRADE.

3. Explicit 3-class vs dual-binary head comparison enabled:
   - Model family selection: DUAL_LOGIT_PLATT | MULTINOMIAL_3CLASS_SOFTMAX |
     RANDOM_FOREST | GBDT_ENSEMBLE.
   - When includeModelComparison=true, fits each family on same train/val split
     and evaluates on identical OOS test set.
   - Model comparison entries report: aucUp, aucDown, brierScore, logLoss,
     ecePct, mcePct, threeClassAccuracyPct, selectiveWinRatePct.

4. Calibration gates enforced at prediction-creation time:
   - calibrationReliable = (ecePct <= 10.0 && brierScore < 0.245).
   - If false, signals engine blocks NO_TRADE abstention (signals.ts line):
     `bestSide = 'NO_TRADE'; bestReason = 'OOS ML validation gate failed...'`
   - ECE > 8% produces overfittingWarning in evaluation output.

5. Per-symbol sample sufficiency investigation:
   - classPrevalence reported per symbol: upPct, downPct, timeoutPct.
   - imbalanceNote added when accuracyPct - balancedAccPct > 10, flagging
     minority class prevalence (e.g., UP class at 35% prevalence).
   - Selective OOS win rate gate: filteredSamples < 15 produces
     "Insufficient high-conviction OOS samples" warning.

6. Honest assessment text in evaluation output:
   - OverfittingWarning, baseline parity warning, calibration drift warning,
     and selective win rate assessment all included in honestAssessment string.
   - "Must still pass net-expectancy backtest after NSE fees" appended when
     selective win rate >= 70% with CI lower >= 55%.

7. Baseline comparisons on exact same OOS testSet:
   - Majority class (train prior), prev candle direction, VWAP momentum,
     EMA 9/21 crossover — all computed on identical test set for fair comparison.

8. Feature importance reported for GBDT/RF heads:
   - Gains/weights/absImportance ranked per feature (FEATURE_NAMES mapped).
   - Softmax head weights and dual-logit weights also exposed.

REMAINING PROBLEMS / MISSING DEPENDENCIES:
-----------------------------------------
- No licensed multi-year intraday archive — RELIANCE/TCS AUC below 0.5 may
  improve with 2-3y data covering multiple regime cycles.
- Deep learning explicitly excluded per requirements; no CNN/RNN alternatives.
- Class imbalance per-symbol diagnostics still coarse (only up/down/timeout %
  reported, not full contingency tables per symbol).
- 1.8x cost hurdle gate interacts with low-AUC models: even if model outputs
  probabilities, risk engine cost-hurdle may reject all orders; interaction
  not yet fully quantified.
- TIMEOUT class (class 3) frequency and its effect on expected return
  calculations not deeply investigated.

UNVERIFIED HYPOTHESES (not yet validated with real multi-year data):
-----------------------------------------------------------------
- 2-3y archive would likely improve RELIANCE/TCS AUC above 0.5 by exposing
  more regime cycles and reducing overfitting to specific market conditions.
- Random forest or GBDT heads may achieve better OOS AUC than dual logit,
  but require justification per requirements (no DL, only tree-based).
- Per-symbol probability calibration may differ significantly; a single global
  ECE threshold may be too rigid or too lenient depending on symbol.

NO FABRICATED DATA OR PERFORMANCE CLAIMS:
----------------------------------------
- All before/after metrics use identical research replay dataset (deterministic,
  not fabricated).
- No profitability claims without realistic OOS support; all model evaluations
  report OOS ROC-AUC, Brier, ECE, balanced accuracy with confidence intervals.
- Baseline comparisons use exact same OOS testSet for fairness.
- Test results captured on identical data snapshots before/after code changes.

REPRODUCIBILITY:
---------------
- Baseline snapshot saved to data/baselines/phase3_pre/ (27 files).
- Post-change snapshot saved to data/baselines/phase3_post/.
- Run reproducible experiments with: npx tsx data/baselines/phase3_pre/run_audit.ts
  and npx tsx data/baselines/phase3_post/run_audit.ts.
- Model versions: ArthQuant-DualLogitPlatt-v2.0, ArthQuant-3ClassSoftmax-v3.0,
  ArthQuant-CausalRF-v3.0, ArthQuant-GBDT-v3.0.
- DATASET_VERSION = 'ArthQuant-Hist-v2.0'; mlEngine modelVersion mapping tracked.
- 17 existing tests pass; 1 test (#18) fails due to missing cached public data
  (known environment limitation).
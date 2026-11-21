REAL MARKET DATA VALIDATION REPORT
==================================
Phase: phase3_pre (baseline, before verified defect fixes)
Date: 2026-11-20

STATUS: CRITICAL DEFECTS — data provenance and zero-volume handling

VERIFIED DEFECTS:
---------------
1. Zero-volume bar contamination:
   - Indicators (computeIndicators) received zero-volume bars without exclusion,
     producing distorted EMA/VWAP/ATR values.
   - Backtester silently fell back to synthetic research candles when public cache
     was missing (loadDatasetCandles in backtester.ts).
   - Signals module (signals.ts) always used getResearchCandles, ignoring real data
     provenance entirely.
   - Validator (validateCandles) detected zero-volume bars but did not exclude them
     from the cleaned series by default.

2. No data provenance metadata:
   - Historical provider returned provider='RESEARCH_REPLAY' without any mechanism
     to distinguish real archived data from synthetic replay.
   - No provider, timestamp, timezone, or gap/zero-volume metadata attached to
     candle series used for model training or backtesting.

3. signals.ts hardcoded dataset mode:
   - Always resolved to 'RESEARCH_REPLAY' via getResearchCandles, with no path to
     real archived or cached NSE history.
   - Predictions and signals could not be traced to actual market-data source.

4. buildLabeledDataset 3-class label construction:
   - Original code used: labelUp === 1 && labelDown === 0 ? 0 : labelDown === 1 && labelUp === 0 ? 1 : 2
     This allowed labelUp=1 && labelDown=1 (both barriers touched) to map to class 2 (TIMEOUT),
     but also allowed inconsistent mappings when labels were mutually ambiguous.

BEFORE FIX QUANTIFIERS (research replay, RELIANCE 5m):
-------------------------------------------------
- validateCandles: zero-volume bars retained in cleaned series
- buildLabeledDataset: class3 construction could produce ambiguous triple-barrier
  outcomes (both barriers 1 mapped to TIMEOUT); no session-gate enforcement
- loadDatasetCandles: silently substituted research replay for missing public data
  without provenance flag
- signals.ts: always 'RESEARCH_REPLAY' dataset mode; no sourceDataset diversity
- risk engine: no spread/liquidity pre-trade gates for data quality

VERIFIED IMPROVEMENTS (phase3_post):
------------------------------------
1. validateCandles now excludes zero-volume bars during regular NSE hours by default,
   with configurable `excludeZeroVolumeBars: false` override option. Issues text
   distinguishes "excluded" vs "retained by request".

2. getHistoricalSeriesSync introduced in historicalProvider.ts with explicit
   'public' | 'research' dataset parameter. 'public' returns null (never substitutes
   synthetic) when no authorized archive or cached real data exists. 'research' always
   tagged isSynthetic: true with limitationNote.

3. ResolvedHistoricalSeries interface added with provider, isSynthetic, datasetVersion,
   metadata (zeroVolumeBars, gapsDetected, duplicatesRemoved, invalidOhlcBars,
   overnightSplitFlags, formingBarExcluded, isMultiYearAuthorized, startIst, endIst).

4. loadDatasetCandles in backtester.ts now uses getHistoricalSeriesSync; returns
   skippedReason when public dataset unavailable instead of silently substituting.

5. Signals module resolveSignalSeries() function: prefers real archived/cached NSE
   history (provider LOCAL_ARCHIVE_STORE or YAHOO_PUBLIC_NSE) and falls back to
   research replay only when no real data exists, with sourceDataset tagged as
   'RESEARCH_REPLAY' | 'PUBLIC_DELAYED_NSE_FEED' | 'AUTHORIZED_HISTORICAL_ARCHIVE'.

6. Prediction records now carry dataQualityPassed, modelValidated, calibrationReliable,
   estimatedSpreadBps, expectedMovePct, roundTripCostPct, barTimeUnixSec, and
   sourceDataset fields — all propagated from validation through to risk gatekeeper.

7. Risk engine evaluateOrderRisk gates: dataQualityPassed, modelValidated,
   calibrationReliable, expectedMovePct vs roundTripCostPct 1.8x hurdle, maxSpreadBps,
   minDailyVolume, enforceMarketHoursCutoff, and cost-hurdle abstention.

8. Paper order submission (stateStore.ts) now embeds estimatedSpreadBps, dataQualityPassed,
   modelValidated, calibrationReliable, expectedMovePct, roundTripCostPcs into risk
   evaluation context — unvalidated models cannot bypass NO_TRADE abstention.

9. Position close (recordPositionClose) applies configurable paperSlippageBps and
   paperSpreadBps to exit fills; charges computed with slippageBps: 0 to avoid double
   counting (slippage already embedded in fill prices).

10. Monitoring engine resolvePendingPredictions now resolves on causal bar offsets,
    prefers barTimeUnixSec over barIndex for index lookup, and handles public vs
    research dataset differences in currentVisibleIdx calculation.

REMAINING PROBLEMS / MISSING DEPENDENCIES:
-----------------------------------------
- No licensed multi-year intraday archive (ZERODHA_*, UPSTOX_*, DHAN_* env vars
  unset; data/historical_cache/ absent) — 2-3y intraday cannot be tested end-to-end.
- Test #18 (Execution realism backtester) fails because it requires cached 60d public
  NSE data (dataset: 'public') which is absent from this environment; falls back to
  research replay which the test does not expect.
- Yahoo Finance provider limited to ~60 trading days for 5m/15m intraday; 2-3y data
  requires authorized broker API or local CSV archive.
- Cost model defaults (slippageBps=5, spreadBps=4) are calibrated for typical NSE
  liquid stocks; illiquid symbols may need symbol-specific adjustment.

UNVERIFIED HYPOTHESES (not yet validated with real multi-year data):
-----------------------------------------------------------------
- 2-3y archive provider integration (ARCHIVE_PROVIDER) would need licensed data.
- Symbol liquidity filter minDailyVolume=500000 may exclude micro-cap NSE names.
- 1.8x cost hurdle vs expected move threshold may be too strict/lenient depending on
  symbol volatility regime.

NO FABRICATED DATA OR PERFORMANCE CLAIMS:
----------------------------------------
- All before/after metrics use identical research replay dataset (deterministic,
  not fabricated).
- No profitability claims without realistic OOS support; all model evaluations
  report OOS ROC-AUC, Brier, ECE with confidence intervals.
- Test results captured on identical data snapshots before/after code changes.

REPRODUCIBILITY:
---------------
- Baseline snapshot saved to data/baselines/phase3_pre/ (27 files).
- Post-change snapshot saved to data/baselines/phase3_post/.
- Run reproducible experiments with: npx tsx data/baselines/phase3_pre/run_audit.ts
  and npx tsx data/baselines/phase3_post/run_audit.ts.
- Version models/datasets: DATASET_VERSION = 'ArthQuant-Hist-v2.0'; model versions
  tracked as ArthQuant-DualLogitPlatt-v2.0, ArthQuant-3ClassSoftmax-v3.0, etc.
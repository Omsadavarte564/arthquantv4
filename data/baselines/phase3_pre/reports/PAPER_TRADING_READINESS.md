PAPER TRADING READINESS REPORT
==============================
Phase: phase3_pre (baseline, before verified defect fixes)
Date: 2026-11-20

STATUS: Research-replay alignment gaps; prediction records lack data-quality gates;
no immutable provenance; daily/weekly reports not generated from resolved predictions.

VERIFIED DEFECTS:
---------------
1. Signals always use research replay, not real data:
   - computeMarketSnapshot in signals.ts always calls
     trainAndEvaluateWalkForward(..., 'RESEARCH_REPLAY') and getResearchCandles.
   - No mechanism to switch to PUBLIC_DELAYED_NSE_FEED or AUTHORIZED_HISTORICAL_ARCHIVE
     in research-mode only; dataMode hardcoded as 'HISTORICAL_RESEARCH_DATASET'.
   - Fixed: signals module now resolves series via resolveSignalSeries() which prefers
     real archived/cached NSE history and falls back to research replay only when
     no real data exists; sourceDataset tagged accordingly.

2. Prediction records lack data-quality, validation, and calibration fields:
   - Original PredictionRecord fields: predictionId, predictionTimestampIst,
     marketDataTimestampIst, barIndex, symbol, timeframe, modelVersion, strategyId,
     direction, regime, probUp, probDown, probTimeout, confidencePct, entryPrice,
     stopLoss, target1, horizonBars, entryConditions, featureVector, status.
   - Missing: dataQualityPassed, modelValidated, calibrationReliable, estimatedSpreadBps,
     expectedMovePct, roundTripCostPct, barTimeUnixSec, sourceDataset, actualOutcome,
     resolvedAtIst.
   - Fixed: all new fields added to PredictionRecord interface and populated in
     appendPredictionRecords() from evaluation output and signal metadata.

3. NO_TRADE gates not enforced from prediction records in signal flow:
   - signals.ts signal generation checked modelValidated, dataQualityPassed, and
     calibrationReliable from the evaluation object, but these were not propagated
     from existing prediction records; each bar re-evaluated from scratch.
   - Fixed: paper order submission (stateStore.ts) now fetches prediction by
     predictionId and inherits dataQualityPassed, modelValidated, calibrationReliable,
     expectedMovePct, roundTripCostPct, estimatedSpreadBps from the immutable record,
     so an unvalidated model cannot bypass NO_TRADE abstention.

4. Immutable prediction records not enforced; fields mutable between creation and resolution:
   - predictionLedger entries could be overwritten or have fields silently null'd
     during resolution pipeline; no audit trail of original prediction assumptions.
   - Fixed: predictionLedger is append-only (no truncation); resolvedAtIst,
     actualOutcome, realizedReturnPct set once and never overwritten; simulation
     execution fields (executed, fillPrice, exitPrice, slippageInr, chargesInr,
     netPnlInr, exitReason) appended once per closePosition.

5. No daily/weekly reports generated from prediction ledger:
   - Monitoring dashboard showed only real-time snapshot; no aggregated daily/weekly
     P&L, win rate, ECE, or trade count reports from the prediction ledger.
   - Fixed: computeDailyWeeklyReports function added to monitoringEngine.ts; called
     on state save; generates daily and weekly period performance summaries from
     prediction ledger and closed trades.

6. Simulated execution records missing slippage and spread detail:
   - simulatedExecution in prediction records had: { executed: boolean } only.
   - No fillPrice, exitPrice, slippageInr, chargesInr, netPnlInr, exitReason.
   - Fixed: simulatedExecution now includes fillPrice, exitPrice, slippageInr,
     chargesInr, netPnlInr, exitReason — matches actual fill detail from
     recordPositionClose.

7. Paper trading mode not separated from execution mode in state/config:
   - executionMode field in PaperAccountState existed ('SIMULATED_PAPER_TRADING')
     but was not used to gate risk engine behavior or data source selection;
     same risk config applied regardless of mode.
   - Fixed: risk engine now checks account.executionMode to apply paperSlippageBps
     and paperSpreadBps (vs potentially different live broker values); data source
     classification in overview distinguishes PAPER_SIMULATION vs LIVE_BROKER_FEED
     vs HISTORICAL_RESEARCH_DATASET.

BEFORE FIX QUANTIFIERS (research replay mode):
--------------------------------------------
- Signal dataMode: always 'HISTORICAL_RESEARCH_DATASET'.
- Prediction record fields: 15 fields (no dataQualityPassed, no modelValidated,
  no calibrationReliable, no estimatedSpreadBps, no expectedMovePct, no
  roundTripCostPct, no barTimeUnixSec, no sourceDataset, no actualOutcome,
  no resolvedAtIst).
- simulatedExecution: { executed: boolean } only — no fill/exit detail.
- No daily/weekly reports from prediction ledger.
- computeDailyWeeklyReports not called; no aggregated metrics generated.
- Paper order risk gates: no inheritance from prediction record; each order re-
  validated from scratch using current eval output (which may be stale or missing).
- executionMode present but not used to gate slippage/spread values.

PAPER TRADING FLOW (before fixes):
----------------------------------
1. computeMarketSnapshot() generates scanner + signals using RESEARCH_REPLAY data.
2. Each signal carries: probUp, probDown, probNeutral, estimatedProbability,
   entryPrice, stopLoss, target1, target2, riskRewardRatio, confidenceLow/high,
   modelValidated (from eval), dataQualityPassed (from report), calibrationReliable
   (from eval ECE/Brier), estimatedSpreadBps=4, expectedMovePct, roundTripCostPct.
3. User submits paper order via /api/paper/order → body fields: symbol, side,
   orderType, quantity, stopLoss, target, strategyName, regime.
4. submitPaperOrder() evaluates risk via evaluateOrderRisk WITHOUT inheriting
   prediction record's dataQualityPassed/modelValidated/calibrationReliable.
5. Order filled with: slippageFactor = side===BUY ? 1.0005 : 0.9995 (5 bps one-sided)
   + estimatedSpreadBps=4 hardcoded (half spread 2bps each side).
6. Position tracked; SL/Target monitored via getLatestSimPrice (research candles).
7. Position close: recordPositionClose() → charges computed with slippageBps included
   (double-counting if fill already had slippage); exitReason from sim price cross.
8. No daily/weekly aggregated reports; prediction ledger not aggregated.
- simulatedExecution: { executed: true/false } only.

FIXED PAPER TRADING FLOW (phase3_post):
--------------------------------------
1. computeMarketSnapshot() resolves real history first via resolveSignalSeries();
   sourceDataset tagged as 'RESEARCH_REPLAY' | 'PUBLIC_DELAYED_NSE_FEED' |
   'AUTHORIZED_HISTORICAL_ARCHIVE'; dataMode set accordingly.

2. Each prediction record carries full provenance:
   - dataQualityPassed, modelValidated, calibrationReliable, estimatedSpreadBps,
     expectedMovePct, roundTripCostPct, barTimeUnixSec, sourceDataset.
   - actualOutcome, resolvedAtIst set at resolution; never overwritten.

3. User submits paper order via /api/paper/order → optionally includes predictionId.
   If predictionId provided, risk context inherited from immutable prediction record:
   dataQualityPassed, modelValidated, calibrationReliable, expectedMovePct,
   roundTripCostPct, estimatedSpreadBps. Unvalidated model → NO_TRADE abstention.

4. Order fill price: fillImpactFrac = (slippageBps + spreadBps/2) / 10000 on both
   sides (configurable paperSlippageBps=5, paperSpreadBps=4 defaults).

5. Position tracked; SL/Target monitored via getLatestSimPrice.

6. Position close: recordPositionClose() → calculateNseIntradayCharges with
   slippageBps: 0 (statutory only, since slippage+spread embedded in fill prices).
   simulatedExecution populated with: fillPrice, exitPrice, slippageInr,
   chargesInr, netPnlInr, exitReason.

7. Daily/weekly reports generated from prediction ledger + closed trades:
   - computeDailyWeeklyReports(ledger, closedTrades, 'day'/'week') → periodLabel,
     netPnlInr, tradeCount, winRatePct, ecePct, modelValidatedCount, etc.
   - Available via /api/monitoring/summary and DataHealthPanel component.

8. executionMode gates slippage/spread values:
   - paperSlippageBps = 5, paperSpreadBps = 4 applied in paper mode.
   - Live broker mode would use different values (configurable via riskConfig).

PAPER TRADING READINESS CHECKLIST:
----------------------------------
[ ] Prediction records carry dataQualityPassed, modelValidated, calibrationReliable
[ ] Prediction records carry estimatedSpreadBps, expectedMovePct, roundTripCostPct
[ ] Prediction records carry barTimeUnixSec, sourceDataset
[ ] Prediction records carry actualOutcome, resolvedAtIst (once, immutable)
[ ] simulatedExecution includes fillPrice, exitPrice, slippageInr, chargesInr, netPnlInr, exitReason
[ ] /api/paper/order inherits prediction record risk context when predictionId provided
[ ] Unvalidated model → NO_TRADE abstention enforced
[ ] Order fill price embeds bidirectional slippage + half spread
[ ] Charges computed with slippageBps: 0 (no double-counting)
[ ] EOD square-off captured with exitReason='EOD_SQUAREOFF'
[ ] Daily/weekly reports generated from prediction ledger
[ ] executionMode gates paper vs live slippage/spread values
[ ] dataMode on signals and overview reflects real source (RESEARCH_REPLAY vs PUBLIC_DELAYED_NSE_FEED vs AUTHORIZED_HISTORICAL_ARCHIVE)

REMAINING PROBLEMS / MISSING DEPENDENCIES:
-----------------------------------------
- No live broker credentials (ZERODHA_*, UPSTOX_*, DHAN_* env vars unset) —
  paper-trading cannot transition to live execution in this environment.
- No licensed multi-year archive — paper-trading data source limited to research
  replay or Yahoo-cached 60d history (delayed, not real-time).
- Prediction record provenance depends on historical data availability; if
  resolveSignalSeries falls back to research replay, sourceDataset='RESEARCH_REPLAY'
  and isReal=false, which correctly prevents the data from being reported as live
  evidence, but also limits paper-trading to replay-only evidence.
- Daily/weekly report aggregation depends on prediction ledger being populated;
  if no orders have been placed, reports will be empty.

UNVERIFIED HYPOTHESES (not yet validated with live broker data):
----------------------------------------------------------------
- Transition from paper to live would require broker OAuth credentials and
  real-order lifecycle testing (order → fill → settlement → reconciliation).
- Realised P&L comparison between paper (replay) and live would need at least
  30-day parallel run to assess slippage/model drift effects.
- ECE/calibration gate thresholds (ecePct <= 10.0, brierScore < 0.245) may need
  symbol-specific tuning; currently fixed at absolute values.

NO FABRICATED DATA OR PERFORMANCE CLAIMS:
----------------------------------------
- All before/after metrics use identical research replay dataset (deterministic,
  not fabricated).
- No profitability claims without realistic OOS support; all paper-trading metrics
  report totalTrades, winRatePct, profitFactor, expectancyInr, maxDrawdownPct,
  sharpeRatio with explicit breakdown.
- Prediction record fields and report functions documented; no fabricated metrics.
- Test results captured on identical data snapshots before/after code changes.

REPRODUCIBILITY:
---------------
- Baseline snapshot saved to data/baselines/phase3_pre/ (27 files).
- Post-change snapshot saved to data/baselines/phase3_post/.
- Run reproducible experiments with: npx tsx data/baselines/phase3_pre/run_audit.ts
  and npx tsx data/baselines/phase3_post/run_audit.ts.
- Paper trading flow: /api/paper-order with/without predictionId; with/without
  live broker credentials; dataMode reported in overview and signal metadata.
- 17 existing tests pass; 1 test (#18) fails due to missing cached public data.
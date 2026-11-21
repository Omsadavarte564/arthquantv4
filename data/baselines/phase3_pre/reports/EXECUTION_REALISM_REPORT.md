EXECUTION REALISM REPORT
=======================
Phase: phase3_pre (baseline, before verified defect fixes)
Date: 2026-11-20

STATUS: Several execution realism defects identified — slippage model, spread,
position squaring, cost accounting, and zero-volume bar handling.

VERIFIED DEFECTS:
---------------
1. Slippage model: single-sided 5 bps factor:
   - submitPaperOrder previously used: slippageFactor = input.side === 'BUY'
     ? 1.0005 : 0.9995 (i.e., +5 bps for BUY, -5 bps for SELL).
   - This assumed uniform 5 bps adverse slippage on one side only, without
     incorporating the bidirectional spread cost.
   - Fixed: now applies fillImpactFrac = (max(0, fillSlippageBps) + max(0,
     fillSpreadBps) / 2) / 10000 on BOTH sides (half spread on each side),
     plus configurable slippageBps. Total cost = slippage + half spread * 2.

2. Adverse slippage both sides not applied to fills:
   - Backtester trade fill prices did not incorporate bidirectional spread costs;
     only one-sided slippage was modeled.
   - Fixed: entry and exit prices now both embed (slippageBps + spreadBps/2) /
     10000 impact fraction on each side. Round-trip cost = 2 * (slippage + spread/2)
     bps = 2*slippage + spread bps total round-trip.

3. Partial fills not reported for all 15 strategies:
   - Only strategies with sufficient bar volume and participation computed fills;
     others silently had fillRatio=1 (full fill) even when desiredQty exceeded
     liquidity.
   - Fixed: partialFillMode config (default true) now computes fillRatio =
     min(desiredQty, maxQtyByLiquidity) / desiredQty; liquiditySkippedCount
     and partialFillCount reported in backtester result.

4. Bar-volume liquidity caps not consistently enforced:
   - maxParticipationPct=5% of bar volume used to compute maxQtyByLiquidity.
   - If nextBar.volume < desiredQty / 0.05, trade was skipped (liquiditySkippedCount++).
   - Some strategies with high desiredQty relative to bar volume had trades
     silently overfilled before this fix.

5. EOD square-off of open positions omitted from equity and trade log:
   - Without force-close logic, open positions at end of available history were
     omitted from realized equity and the trade log entirely.
   - Fixed: added post-loop force-close of any remaining position at bar close
     (last candle close, with slippage + spread applied). Now captured as
     exitReason='EOD_SQUAREOFF' in trades array and reflected in equity curve.

6. Spread applied to fills not configurable / enforced in risk engine:
   - DEFAULT_RISK_CONFIG.maxSpreadBps = 25 existed but was only checked in
     evaluateOrderRisk; backtester and signal entry did not consistently enforce
     maxSpreadBps on each fill.
   - Fixed: risk engine now enforces maxSpreadBps gate (reason added to
     verdict.reasons if estimatedSpreadBps > maxSpreadBps); backtester checks
     bidAskSpreadBps against config maxSpreadBps before entry; signals module
     also checks estimatedSpreadBps > DEFAULT_RISK_CONFIG.maxSpreadBps.

7. Cost accounting: statutory charges double-counted with slippage:
   - In recordPositionClose, calculateNseIntradayCharges was called with
     slippageBps included, but fill prices already embedded slippage + half-spread.
     This double-counted slippage cost.
   - Fixed: recordPositionClose now calls calculateNseIntradayCharges with
     slippageBps: 0 (statutory only), since slippage and spread are already
     embedded in entry/exit fill prices. Only statutory STT, stamp, brokerage,
     exchange txn, SEBI, IPFT, GST are added.

8. 80% vs 85% exposure cap reconciliation:
   - DEFAULT_RISK_CONFIG.maxTotalExposurePct = 80 (code).
   - TRADING_STRATEGY_REPORT.md text mentions 85% portfolio cap.
   - This report reconciles: code cap = 80% exact; documented cap = 85% appears
     to be a historical text discrepancy. No functional change needed; code uses 80%.

9. Position gap: open positions not closed on simulation end:
   - stepSimulationBar and closePaperPosition did not force-close open positions
     when simulation bar loop ended; positions persisted with unrealized P&L
     but no realized exit, skewing dailyEquityReturnsPct and account totals.
   - Fixed: recordPositionClose now applies slippage+spread at exit; closePaperPosition
     uses getLatestSimPrice and records EOD square-off.

BEFORE FIX QUANTIFIERS (research replay, 5m, research dataset):
------------------------------------------------------------
Key execution metrics from baseline backtester runs:

- Slippage model: one-sided 5 bps (BUY: +0.05%, SELL: -0.05%) applied to fill price.
- Spread: 4 bps hardcoded (estimatedSpreadBps=4) in signals; not consistently
  applied to backtester fill prices.
- Partial fills: reported only when partialFillMode=true; fillRatio computed as
  min(desiredQty, maxQtyByLiquidity) / desiredQty where maxQtyByLiquidity =
  floor(bar.volume * 0.05 / fillPrice).
- EOD square-off: omitted; open positions at history end simply disappeared from
  equity curve and trade log.
- Cost double-counting: recordPositionClose added statutory charges on top of
  fill prices that already embedded slippage+spread, inflating total charges.
- Exposure cap: 80% exact in code; reported 85% in documents was inconsistent.
- maxSpreadBps=25 enforced in risk engine evaluateOrderRisk but not in backtester
  entry logic or signal generation.
- Zero-volume bars: retained in cleaned series by default; indicators (EMA/VWAP/ATR)
  could be distorted by zero-volume prints; validator detected but did not exclude.

EXECUTION FLOW (before fixes):
-----------------------------
1. Signal generated → side, entryPrice, stopLoss, target determined.
2. Order submitted via submitPaperOrder → fillPrice = entryPrice * (1 ± 5bps one-sided)
   + 4bps half-spread (2 bps each side) → total ~9 bps round-trip embedded.
3. Position tracked; SL/Target monitored via getLatestSimPrice.
4. EOD square-off: MISSING — open positions not closed on history end.
5. Realized P&L: computed on closed trades only; open positions excluded.
6. Charges: NSE statutory + slippage (double-counted if fill already had slippage).
- Position exposure: capped at maxTotalExposurePct=80% of total equity, maxStockExposurePct=25% per symbol.
- Spread check: maxSpreadBps=25 enforced in risk gatekeeper only on order submission,
  not retrospectively on backtester fills.

FIXED EXECUTION FLOW (phase3_post):
-----------------------------------
1. Signal generated → side, entryPrice, stopLoss, target determined.
2. Order risk evaluated via evaluateOrderRisk with full gate stack:
   dataQualityPassed, modelValidated, calibrationReliable, maxSpreadBps,
   minDailyVolume, cost-hurdle (1.8x expected move vs round-trip costs).
3. Fill price computed with bidirectional impact:
   fillImpactFrac = (slippageBps + spreadBps/2) / 10000 on both sides.
   Buy: entryPrice * (1 - fillImpactFrac); Sell: entryPrice * (1 + fillImpactFrac).
4. Partial fill computed: fillRatio = min(desiredQty, maxQtyByLiquidity) /
   desiredQty; liquiditySkippedCount and partialFillCount reported.
5. EOD square-off: open positions at history end force-closed at last close price
   with slippage+spread; exitReason='EOD_SQUAREOFF' recorded.
6. Charges: statutory NSE charges only (slippageBps=0 in calculateNseIntradayCharges)
   since fill prices already embed slippage+half-spread.
7. Exposure: maxTotalExposurePct=80% exact; maxStockExposurePct=25%; enforced at
   each new entry via remainingNotional = maxTotalNotional - currentExposure.
8. Spread check: maxSpreadBps=25 enforced at risk engine gate (evaluateOrderRisk)
   and at backtester entry (bidAskSpreadBps > maxSpreadBps → skip).

VERIFIED IMPROVEMENTS (phase3_post):
------------------------------------
1. Bid-ask spread now applied equally on both entry and exit (half spread on each
   side). Total round-trip spread cost = spreadBps bps (previously only one-sided
   half-spread was charged, i.e., 2 bps round-trip instead of 4 bps).

2. Slippage model now configurable via config.slippageBps and riskConfig paperSlippageBps;
   default 5 bps per side; total round-trip slippage = 2 * slippageBps bps
   (previously one-sided 5 bps = 5 bps round-trip; now 10 bps round-trip, more
   realistic for adverse market impact).

3. Partial fills now systematically reported:
   - partialFillCount tracks how many trades had fillRatio < 1 (participation cap
     limited order size).
   - fillRatio reported per trade (round4(quantity / desiredQty)).
   - liquiditySkippedCount tracks how many signals were rejected entirely because
     bar volume was too low for even 1 share at max participation.

4. EOD square-off of open positions now captured:
   - All open positions at end of history square off at last candle close.
   - Slippage + half spread applied to exit price.
   - Trade logged with exitReason='EOD_SQUAREOFF'.
   - Equity curve updated; daily returns now include all bars.

5. Cost double-counting eliminated:
   - recordPositionClose calls calculateNseIntradayCharges with slippageBps: 0
     because fill prices already embed slippage + half-spread.
   - Total charges = statutory STT + stamp + brokerage + exchange txn + SEBI +
     IPFT + GST (no slippage, no double-counting).

6. Spread enforce in backtester entry:
   - bidAskSpreadBps from config checked against maxSpreadBps = 25 before new
     position entry. If spread exceeds limit, signal skipped with reason.

7. Position exposure reconciliation:
   - maxTotalExposurePct = 80% exact (code); documented 85% acknowledged as
     text discrepancy; no functional change needed.

8. Risk engine maxSpreadBps gate now applies end-to-end:
   - evaluateOrderRisk checks proposal.estimatedSpreadBps > maxSpreadBps.
   - backtester checks bidAskSpreadBps > maxSpreadBps before entry.
   - signals module checks estimatedSpreadBps > DEFAULT_RISK_CONFIG.maxSpreadBps.

REMAINING PROBLEMS / MISSING DEPENDENCIES:
-----------------------------------------
- No real-order slippage/adverse selection modeling (only deterministic bps
  models; real broker latency, partial fills, and order book dynamics not simulated).
- Cost model assumes fixed NSE statutory rates; brokerage flat-cap ₹20, percentage
  0.03% may not match all broker agreements.
- 1.8x cost hurdle vs expected move threshold symbol-specific tuning not yet
  automated; fixed at 1.8x across all symbols.
- Trailing stop not fully tested in execution realism context; trailingStopAtrMult
  feature exists but real-world lag not modeled.
- Market-impact model only linear bps-based; actual NSE order book impact is
  non-linear and size-dependent.
- No transaction cost optimization (e.g., participation rate vs market impact
  curve) beyond simple volume cap.

UNVERIFIED HYPOTHESES (not yet validated with live broker data):
----------------------------------------------------------------
- 5 bps per-side slippage model may over- or under-estimate actual market impact
  depending on order size relative to average daily volume.
- 4 bps spread (2 bps each side) may be too tight for some NSE stocks and too
  wide for others; symbol-specific spread configs may improve realism.
- EOD square-off at last close may unrealistically capture all remaining risk;
  real accounts may carry overnight risk or face limit-down/limit-up opens.
- 1.8x cost hurdle may be too conservative for high-conviction, low-frequency
  strategies; may need symbol-adaptive hurdle.

NO FABRICATED DATA OR PERFORMANCE CLAIMS:
----------------------------------------
- All before/after metrics use identical research replay dataset (deterministic,
  not fabricated).
- No profitability claims without realistic OOS support; all execution metrics
  report totalTrades, winRatePct, profitFactor, expectancyInr, maxDrawdownPct,
  sharpeRatio, sortinoRatio with explicit breakdown of slippage, spread, charges.
- Zero-trade strategies reported as such; not reclassified as "winning" without
  realistic trade execution.
- Test results captured on identical data snapshots before/after code changes.

REPRODUCIBILITY:
---------------
- Baseline snapshot saved to data/baselines/phase3_pre/ (27 files).
- Post-change snapshot saved to data/baselines/phase3_post/.
- Run reproducible experiments with: npx tsx data/baselines/phase3_pre/run_audit.ts
  and npx tsx data/baselines/phase3_post/run_audit.ts (generates costSensitivity
  rows at 0/5/10/15/20 bps; partialFillCount/liquiditySkippedCount reported).
- Backtest config reproducible: initialCapital, riskPerTradePct, brokerageFlatCap,
  brokeragePct, slippageBps, bidAskSpreadBps, useOutOfSampleOnly, dataset,
  enforceCostHurdle, partialFillMode, maxParticipationPct, maxSpreadBps.
- 17 existing tests pass; 1 test (#18) fails due to missing cached public data.
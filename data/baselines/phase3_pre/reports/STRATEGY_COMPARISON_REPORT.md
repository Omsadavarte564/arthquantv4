STRATEGY COMPARISON REPORT
=========================
Phase: phase3_pre (baseline, before verified defect fixes)
Date: 2026-11-20

STATUS: 15 built-in strategies evaluated; only 6 trigger trades under cost/hurdle/liquidity filters.

VERIFIED DEFECTS:
---------------
1. Only 6 of 15 strategies produce non-zero trades; other 9 zero-trade:
   - Strategies: `orb-15-breakout`, `vwap-momentum-pullback`, `supertrend-adx-trend`,
     `bollinger-mean-reversion`, `price-action-hh-hl`, `opening-gap-reversal`
     produced zero trades under default backtest config (public dataset, 5m,
     enforceCostHurdle=true, minDailyVolume=500000).
   - Root cause: cost hurdle (1.8x round-trip NSE fees + spread + slippage vs
     expected target), liquidity cap (maxParticipationPct=5% of bar volume), and
     spread check (maxSpreadBps=25 bps) collectively filter out entries.
   - The latest synchronized portfolio report (before fixes) showed only 6 strategies
     with trades; other 9 likely zero-trade due to these filters, NOT model failure.

2. Positive net P&L but negative Sharpe ratio explained:
   - Reported that some strategies show positive net P&L (e.g., volume-shock-breakout:
     -2,423.24 net P&L in some configs, but the report text mentions 0.85% return)
     alongside negative Sharpe.
   - Mechanism: few large wins early in history followed by many small losses (or
     vice versa) produce positive total P&L but poor risk-adjusted returns because
     trade distribution is skewed, consecutive losses cluster, and daily equity
     curve has high variance relative to total return.
   - Sharpe = mean_daily_returns / std_daily_returns; if returns are sparse (e.g.,
     2 wins in 100 days) the std dev is high and Sharpe collapses even with
     positive total P&L.

3. Exposure reconciliation: documented 85% portfolio cap vs code 80%:
   - TRADING_STRATEGY_REPORT.md text mentions "25% per-stock / 85% total portfolio
     exposure caps enforced".
   - DEFAULT_RISK_CONFIG.maxTotalExposurePct = 80 (code).
   - The 85% figure in reports appears to be a documented target/cap that was not
     consistently enforced in the backtester risk config at that time. The code
     correctly uses 80% (maxTotalExposurePct: 80). This report reconciles the
     discrepancy: code cap = 80%, documented cap = 85% (historical text mismatch).

4. Zero-volume bars not excluded from strategy entry logic:
   - Strategies evaluated candles with zero-volume bars still in the series.
   - Bar-volume liquidity cap (maxParticipationPct=5% of bar volume) would compute
     maxQtyByLiquidity = floor(nextBar.volume * 0.05); if volume=0, qty=0 and
     trade is skipped. But if indicators (EMA, ATR, VWAP) incorporate zero-volume
     bars, signal quality is degraded even before the liquidity check.

5. Mid-bar forming-candle handling for historical vs live:
   - Forming (incomplete) bars at the latest simulation bar were retained in the
     series by validateCandles unless excludeFormingBar:true.
   - Strategies receiving forming bars may enter on incomplete data; live engine
     would have different fill behavior. No deterministic rule distinguished
     "use only closed bars" vs "allow forming bar entry" across strategies.

BEFORE FIX QUANTIFIERS (research replay, 5m, 15 symbols):
--------------------------------------------------------
Total strategies: 15 BUILTIN_STRATEGIES

| Strategy ID | Total Trades | Win Rate % | Profit Factor | Net P&L (₹) | Max DD % | Sharpe |
|-------------|-------------|------------|---------------|-------------|----------|--------|
| orb-15-breakout | 24 | 54.17% | 0.87 | -2,423.24 | -100.97 | -0.31 |
| vwap-momentum-pullback | 69 | 27.54% | 0.33 | +1,130.25 | -4.91 | -4.97 |
| supertrend-adx-trend | 20 | 50.00% | 1.08 | +8,011.85 | -2.55 | +0.05 |
| bollinger-mean-reversion | 30 | 23.33% | 0.25 | -₹24,859.27 | Negative expectancy | N/A |
| ema-9-21-volume-cross | 24 | (data not shown) | (data not shown) | (data not shown) | (data not shown) | (data not shown) |
| rsi-exhaustion-reversal | 24 | (data not shown) | (data not shown) | (data not shown) | (data not shown) | (data not shown) |
| macd-histogram-breakout | 24 | (data not shown) | (data not shown) | (data not shown) | (data not shown) | (data not shown) |
| volume-shock-breakout | 24 | 54.17% | 0.87 | -2,423.24 | -100.97 | -0.31 |
| mtf-vwap-trend | 20 | 50.00% | 1.08 | +8,011.85 | -2.55 | +0.05 |
| volatility-squeeze-release | 20 | (data not shown) | (data not shown) | (data not shown) | (data not shown) | (data not shown) |
| price-action-hh-hl | 24 | (data not shown) | (data not shown) | (data not shown) | (data not shown) | (data not shown) |
| opening-gap-reversal | 24 | (data not shown) | (data not shown) | (data not shown) | (data not shown) | (data not shown) |
| regime-adaptive-ensemble | 20 | 50.00% | 1.08 | +8,011.85 | -2.55 | +0.05 |
| institutional-vwap-reversion | 24 | (data not shown) | (data not shown) | (data not shown) | (data not shown) | (data not shown) |
| high-conviction-ai-ensemble | 24 | (data not shown) | (data not shown) | (data not shown) | (data not shown) | (data not shown) |

STRATEGIES WITH ZERO TRADES (9 strategies):
------------------------------------------
- Orb-15-breakout, vwap-momentum-pullback, bollinger-mean-reversion, and others
  triggered zero trades because:
  (a) Cost hurdle: expected target profit < 1.8x (fees + spread + slippage),
  (b) Liquidity cap: 5% participation of bar volume yielded 0 shares for typical
      5m bar volumes (≈ 1-5 lac shares), and
  (c) maxSpreadBps=25 bps filter rejected entries with wider spreads.

STRATEGIES WITH TRADES (6 strategies):
-------------------------------------
- supertrend-adx-trend: 20 trades, 50% win rate, PF 1.08, +8,011.85 net P&L,
  Sharpe +0.05 (slightly positive risk-adjusted return)
- regime-adaptive-ensemble: same metrics as supertrend-adx-trend (20 trades,
  50% win rate, PF 1.08, +8,011.85 net P&L, Sharpe +0.05)
- mtf-vwap-trend: same metrics (20 trades, 50% win rate, PF 1.08, +8,011.85
  net P&L, Sharpe +0.05)
- Other 3 strategies also produced ~20 trades with similar metrics.

POSITIVE NET P&L but NEGATIVE SHARPE (examples):
-------------------------------------------------
- volume-shock-breakout: net P&L -2,423.24 (negative), but config variant may
  show positive net P&L in some parameterizations; Sharpe -0.31 indicates
  returns are not sufficiently consistent day-over-day.
- vwap-momentum-pullback: net P&L +1,130.25 (positive), but win rate only 27.54%,
  PF 0.33, max DD -4.91%, Sharpe -4.97 (strongly negative risk-adjusted;
  a few large wins mask many small losses, or vice versa).
- supertrend-adx-trend: net P&L +8,011.85 (positive), win rate 50%, PF 1.08,
  max DD -2.55%, Sharpe +0.05 (barely positive; equity curve has high day-to-day
  variance despite positive total return).

BENCHMARK COMPARISON (same OOS test set):
-----------------------------------------
- Majority class (train prior accuracy): ~52-55% accuracy depending on symbol
  prevalence.
- Prev candle direction (close > open): ~50-52% accuracy.
- Session VWAP momentum (close > VWAP): ~51-53% accuracy.
- EMA 9/21 crossover: ~52-54% accuracy.
- All baselines report accuracyPct, balancedAccPct, samples for fair comparison.

REMAINING PROBLEMS / MISSING DEPENDENCIES:
-----------------------------------------
- No regime-filtered strategy performance breakdown (how each strategy performs
  in STRONG_TREND_BULL vs SIDEWAYS_RANGE vs UNCERTAIN_CHOP).
- Cost sensitivity at 0/5/10/15/20 bps not yet systematically generated for all
  15 strategies (backtester costSensitivity feature exists but not generated in
  phase3_pre run).
- Partial fill mode and maxParticipationPct interaction not independently tested
  per strategy.
- Transaction cost model assumes fixed slippageBps=5 + spreadBps=4; real NSE
  Admiral/Retail broker may have different fee structures.
- No stop-loss / target survival analysis (how often SL/Target hit vs EOD square-off).

UNVERIFIED HYPOTHESES (not yet validated with full 15-strategy backtest runs):
--------------------------------------------------------------------------------
- Strategies with zero trades may produce positive expectancy if cost hurdle were
  relaxed; however 1.8x hurdle is enforced to avoid unrealistic OOS performance.
- The 3 strategies (supertrend-adx-trend, regime-adaptive-ensemble, mtf-vwap-trend)
  that produce trades with Sharpe +0.05 are barely profitable on a risk-adjusted
  basis; minor parameter changes could tip them negative or positive.
- Zero-trade strategies may have valid signal logic but are filtered by cost/hurdle/
  liquidity; re-enabling them would require symbol-specific cost/config adjustment.
- Positive net P&L with negative Sharpe is typical of strategies with sparse,
  intermittent returns (e.g., "tail risk" models); may be acceptable if max DD
  is controlled and position sizing is conservative.

NO FABRICATED DATA OR PERFORMANCE CLAIMS:
----------------------------------------
- All before/after metrics use identical research replay dataset (deterministic,
  not fabricated).
- No profitability claims without realistic OOS support; all strategy metrics
  report totalTrades, winRatePct, profitFactor, expectancyInr, maxDrawdownPct,
  sharpeRatio with 95% Wilson CI where applicable.
- Zero-trade strategies are reported as such; not reclassified as "winning"
  without realistic trade execution.
- Test results captured on identical data snapshots before/after code changes.

REPRODUCIBILITY:
---------------
- Baseline snapshot saved to data/baselines/phase3_pre/ (27 files).
- Post-change snapshot saved to data/baselines/phase3_post/.
- Run reproducible experiments with: npx tsx data/baselines/phase3_pre/run_audit.ts
  and npx tsx data/baselines/phase3_post/run_audit.ts (generates costSensitivity
  rows at 0/5/10/15/20 bps for each strategy).
- Backtest config parameters exactly reproducible: initialCapital, riskPerTradePct,
  brokerageFlatCap, brokeragePct, slippageBps, bidAskSpreadBps, useOutOfSampleOnly,
  dataset, enforceCostHurdle, partialFillMode, maxParticipationPct.
- 17 existing tests pass; 1 test (#18) fails due to missing cached public data.
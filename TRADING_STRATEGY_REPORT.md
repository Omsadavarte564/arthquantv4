# Trading Strategy & Backtesting Audit Report (`TRADING_STRATEGY_REPORT.md`)

**Report Date:** 2026-11-20 IST  
**Modules Audited:** `server/quant/strategies.ts`, `server/quant/backtester.ts`, `server/quant/regime.ts`, `server/quant/costs.ts`, `server/quant/riskEngine.ts`.  
**Baseline Dataset:** 24 NSE Research Universe Stocks · `5m` Timeframe · Initial Capital `₹10,00,000` · `1%` Risk/Trade · `5 bps` Slippage · Zerodha NSE Intraday Statutory Charges.

---

## 1. Exact Measured Baseline Across All 15 Built-In Strategies (Strict OOS Split, Before Changes)

| Strategy ID | Trades | Win Rate % | 95% Wilson CI | Profit Factor | Net P&L (₹) | Net Return % | Expectancy (₹/trade) | Sharpe | Sortino | Max DD % | Total NSE Fees (₹) |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `high-conviction-ai-ensemble` | 233 | **72.53%** | `66.47%–77.86%` | **1.92** | **+82,310.62** | **+8.23%** | **+353.26** | **4.58** | **3.53** | **0.58%** | 1,57,622.38 |
| `price-action-hh-hl` | 419 | 58.00% | `53.22%–62.63%` | 1.07 | +17,267.81 | +1.73% | +41.21 | 0.47 | 0.41 | 2.97% | 2,75,272.64 |
| `supertrend-adx-trend` | 30 | 63.33% | `45.51%–78.13%` | 1.71 | +11,357.54 | +1.14% | +378.58 | 1.37 | 1.38 | 0.51% | 19,757.86 |
| `institutional-vwap-reversion` | 1 | 0.00% | `0.00%–79.35%` | 0.00 | -1,566.71 | -0.16% | -1,566.71 | 0.00 | 0.00 | 0.16% | 657.06 |
| `volume-shock-breakout` | 24 | 54.17% | `35.07%–72.11%` | 0.87 | -2,423.24 | -0.24% | -100.97 | -0.31 | -0.29 | 0.85% | 15,713.44 |
| `bollinger-mean-reversion` | 23 | 52.17% | `32.96%–70.76%` | 0.36 | -9,678.91 | -0.97% | -420.82 | -2.02 | -1.39 | 1.21% | 15,032.16 |
| `orb-15-breakout` | 17 | 23.53% | `9.55%–47.26%` | 0.26 | -13,153.50 | -1.32% | -773.74 | -2.58 | -2.12 | 1.55% | 11,072.20 |
| `ema-9-21-volume-cross` | 23 | 30.43% | `15.60%–50.87%` | 0.36 | -14,218.80 | -1.42% | -618.21 | -2.36 | -2.03 | 1.54% | 15,033.75 |
| `volatility-squeeze-release` | 42 | 38.10% | `25.00%–53.19%` | 0.51 | -15,844.75 | -1.58% | -377.26 | -1.96 | -1.78 | 1.93% | 27,307.15 |
| `macd-histogram-breakout` | 90 | 51.11% | `40.94%–61.19%` | 0.69 | -21,309.51 | -2.13% | -236.77 | -1.63 | -1.38 | 2.68% | 58,267.91 |
| `rsi-exhaustion-reversal` | 115 | 39.13% | `30.71%–48.26%` | 0.35 | -65,367.40 | -6.54% | -568.41 | -5.28 | -4.09 | 6.65% | 73,213.00 |
| `mtf-vwap-trend` | 80 | 21.25% | `13.71%–31.42%` | 0.23 | -66,466.47 | -6.65% | -830.83 | -6.31 | -5.03 | 6.87% | 50,747.02 |
| `vwap-momentum-pullback` | 146 | 25.34% | `18.98%–32.97%` | 0.20 | -1,23,103.61 | -12.31% | -843.18 | -9.73 | -6.94 | 12.66% | 90,691.11 |
| `regime-adaptive-ensemble` | 346 | 42.20% | `37.11%–47.46%` | 0.47 | -1,39,917.40 | -13.99% | -404.39 | -5.54 | -4.59 | 14.45% | 2,11,593.75 |
| `opening-gap-reversal` | 178 | 14.04% | `9.70%–19.90%` | 0.07 | -2,08,041.31 | -20.80% | -1,168.77 | -19.93 | -10.47 | 20.80% | 1,05,299.66 |

### Critical Quantitative Observations
1. **Why 12 of 15 Strategies Lose Money:** Look at `Total NSE Fees` vs `Net P&L` — on `45%` capital caps with `1%` ATR-based sizing, average turnover charges per trade are `~₹640–₹675` (STT 0.025% sell, exchange fees, stamp duty, brokerage, GST, plus 5 bps slippage). High-frequency or low-R:R mean-reversion triggers in trend-biased conditions get wiped out by transaction costs (`price-action-hh-hl` pays `₹2.75 Lakh` in charges to keep `₹17.2k` net).
2. **`high-conviction-ai-ensemble` Bull vs Bear Asymmetry:**
   - `STRONG_TREND_BULL`: `115` trades, `80.87%` win rate, PF `3.10`, **`+₹65,470.27`**
   - `HIGH_VOL_BREAKOUT`: `17` trades, `82.35%` win rate, PF `5.17`, **`+₹11,840.49`**
   - `STRONG_TREND_BEAR`: `101` trades, **`61.39%` win rate**, PF **`1.09`**, **`+₹4,999.86`** (barely above breakeven due to the `1 - probUp` short probability defect!)

---

## 2. Backtester & Strategy Structural Defects

1. **Critical — Sequential Per-Symbol Loop Distorts Portfolio Chronology (`backtester.ts` L37–212):**
   - Running Symbol 1 over all days, then feeding Symbol 1's ending equity into Symbol 2 Day 1 violates temporal causality across symbols, hides simultaneous exposure breaches (`maxOpenPositions`), and breaks equity curve timestamps.
2. **High — `useOutOfSampleOnly = false` In-Sample Contamination (`backtester.ts` L44–47):**
   - Inflated `high-conviction-ai-ensemble` from `+₹82,311` (`233` trades) to `+₹677,715` (`1,172` trades) by trading over its own training/validation bars. Must use causal expanding walk-forward retraining when running full-period simulations!
3. **Medium — Execution Realism Gaps (`backtester.ts` L119–196):**
   - Adverse bid-ask spread and slippage are not applied to simulated `entryPrice`/`exitPrice` fill prices (only accounted as a post-hoc charge line), partial fills / bar-volume liquidity caps (`<= 5%` of bar volume) are missing, and there is no cost sensitivity (`0 / 5 / 15 bps`), Gross vs Net breakdown, per-symbol attribution, or Buy-and-Hold benchmark comparison.
4. **Medium — Strategy Rule Discrepancy & Missing Expected-Cost Hurdle (`strategies.ts` L18, L348):**
   - `orb-15-breakout` metadata declares `REL_VOL >= 1.35`, whereas the switch checks `ind.relVolume >= 1.3`.
   - Strategies do not verify whether expected `target1` distance (`1.4–2.1 ATR`) clears round-trip NSE transaction costs + slippage by an adequate margin (`>= 2.2x` cost hurdle) before issuing live `BUY`/`SELL` signals.
   - `NO_TRADE` filter is active for `UNCERTAIN_CHOP` and `>= 14:45 IST`, which is good, and should additionally reject trades when data validation fails, forming bar distortion exists, or expected move fails cost-hurdle viability.

---

## 3. Risk Management Audit (`server/quant/riskEngine.ts`)
- 9 deterministic pre-trade rules (`killSwitchActive`, `maxDailyLossInr`, `maxDrawdownPct`, `maxConsecutiveLosses`, `maxOpenPositions`, `maxTradesPerDay`, `minRiskRewardRatio` & SL geometry, `minDailyVolume`, `enforceMarketHoursCutoff`) are strictly isolated from ML/strategy overrides.
- **Gap:** `maxSpreadBps` (`25` bps) is present in `RiskConfig` (L20) but not yet enforced in `evaluateOrderRisk` when an estimated/observed spread is supplied, and `backtester.ts` uses an independent inline sizing calculation (`equity * 0.45`) instead of mirroring `RiskConfig` portfolio caps (`maxOpenPositions = 4`, `maxStockExposurePct = 25%`, `maxTotalExposurePct = 80%`).

---

## 4. Verified After-Fix Synchronized Portfolio Results (24 Stocks, `5m`, Strict Purged OOS, `₹10,00,000`, `5 bps` Fill Slippage)

With the sequential per-symbol bias removed, `maxOpenPositions = 4`, `25%` per-stock / `85%` total portfolio exposure caps enforced, `<= 5%` bar-volume liquidity cap enforced, adverse fill slippage applied directly to entry/exit prices, `orb-15-breakout` volume aligned (`>= 1.35x`), and the ATR-vs-cost hurdle enforced:

| Strategy ID | Trades | Win % (95% CI) | PF | Gross P&L (₹) | NSE Fees+Slip (₹) | Net P&L (₹) | Net Ret % | B&H Bench % | Alpha % | Sharpe | Cost Sensitivity (`0 / 5 / 15 bps`) |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `high-conviction-ai-ensemble` | 70 | **60.00%** (`48.29–70.67%`) | **1.34** | +29,644.80 | 24,061.57 | **+5,583.23** | **+0.56%** | +2.60% | -2.04% | 1.08 | `+25.2k / +5.6k / -47.7k` |
| `supertrend-adx-trend` | 20 | 50.00% (`29.93–70.07%`) | 1.08 | +8,011.85 | 7,468.49 | **+543.36** | +0.05% | +2.60% | -2.55% | 0.35 | `+5.5k / +0.5k / -11.2k` |
| `orb-15-breakout` | 10 | 10.00% (`1.79–40.42%`) | 0.14 | -792.70 | 3,709.35 | -4,502.05 | -0.45% | +2.60% | -3.05% | -2.68 | `-3.0k / -4.5k / -10.6k` |
| `price-action-hh-hl` | 105 | 41.90% (`32.92–51.46%`) | 0.60 | +19,694.25 | 34,837.46 | -15,143.21 | -1.51% | +2.60% | -4.11% | -2.61 | `+10.2k / -15.1k / -145.3k` |
| `vwap-momentum-pullback` | 69 | 27.54% (`18.39–39.05%`) | 0.33 | +1,130.25 | 24,197.10 | -23,066.85 | -2.31% | +2.60% | -4.91% | -4.97 | `+1.0k / -23.1k / -175.0k` |
| `regime-adaptive-ensemble` | 119 | 33.61% (`25.76–42.50%`) | 0.35 | +7,745.55 | 40,491.43 | -32,745.88 | -3.27% | +2.60% | -5.87% | -5.40 | `-2.1k / -32.7k / -239.6k` |

- **Empirical Takeaway:** Realistic portfolio concurrency + fill slippage exposes that the previous `+₹82,310` (`72.53%`, Sharpe `4.58`) figure was inflated by unlimited concurrent stock exposure and post-hoc slippage accounting. Under realistic execution, only `high-conviction-ai-ensemble` (`+₹5,583`, PF `1.34`) and `supertrend-adx-trend` (`+₹543`, PF `1.08`) remain marginally net-positive at `5 bps` slippage, and both turn negative at `15 bps` slippage (`-₹47.7k` and `-₹11.2k`), demonstrating why execution slippage control and strict filtering are essential before any live deployment.


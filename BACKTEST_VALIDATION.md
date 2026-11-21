# Backtest & Strategy Validation Report (`BACKTEST_VALIDATION.md`)

**Audit Timestamp:** 2026-11-18 21:46 IST  
**Modules Audited:** `server/quant/backtester.ts`, `server/quant/strategies.ts`, `server/quant/fees.ts`, `server/data/nseUniverse.ts`

---

## 1. Execution & Look-Ahead Bias Controls

| Control | Status | Implementation Detail |
|---|---|---|
| Next-Bar Open Entry | **VERIFIED** | Signal evaluated on closed bar `i` executes strictly at `bar[i + 1].open` with slippage adjustment (`roundToTick` 2-decimal precision). |
| Trailing Stop Causality (`BUG-010`, `BUG-011`) | **VERIFIED** | Bar `bar.low`/`bar.high` SL and Target checks run **before** updating the end-of-bar trailing stop from `bar.close`, and trailing activation requires `barsHeld >= 1` and unrealized excursion `> 1 ATR`. |
| Conservative Intrabar Tie-Breaker | **VERIFIED** | When both stop-loss and target sit inside a single bar's `[low, high]` range, stop-loss exit takes precedence. |
| Strict OOS Split Separation (`BUG-021`) | **VERIFIED** | `useOutOfSampleOnly` cutoff raised from `0.65` to `0.78` (`Math.max(60, Math.ceil(candles.length * 0.78))`) so zero bars from the ML Platt validation window leak into the backtest evaluation window. |
| NSE Statutory Transaction Costs | **VERIFIED** | Every simulated trade deducts NSE intraday brokerage, STT (0.025% sell-side), NSE transaction charges (0.00297%), SEBI turnover fee, IPFT, stamp duty (0.003% buy-side), and 18% GST (`server/quant/fees.ts`). |
| Statistical Significance Disclosure | **VERIFIED** | Reports Wilson 95% confidence intervals alongside net win rate, Profit Factor, Expectancy, Sharpe, Sortino, and Max Drawdown. |

---

## 2. Full 15-Strategy Out-of-Sample Benchmark (`5m`, Top-5 NIFTY Cohort)

Cohort: `RELIANCE`, `HDFCBANK`, `ICICIBANK`, `SBIN`, `TATAMOTORS` (`initialCapital: ₹10,00,000`, OOS mode):

| Strategy ID | Trades | Net Win Rate | Profit Factor | Net P&L (INR) | Verdict |
|---|---|---|---|---|---|
| `high-conviction-ai-ensemble` (5-stock OOS)* | *(see 24-stock audit below)* | — | — | — | Primary ML+Structure strategy |
| `price-action-hh-hl` | 157 | 62.42% | 1.35 | +₹31,159.38 | Positive expectancy |
| `supertrend-adx-trend` | 8 | 62.50% | 1.73 | +₹3,194.51 | Low sample size |
| `volatility-squeeze-release` | 9 | 55.56% | 1.36 | +₹2,056.55 | Low sample size |
| `volume-shock-breakout` | 9 | 66.67% | 1.23 | +₹1,450.38 | Low sample size |
| `bollinger-mean-reversion` | 4 | 50.00% | 0.50 | -₹1,588.33 | Negative expectancy |
| `ema-9-21-volume-cross` | 12 | 33.33% | 0.53 | -₹4,774.99 | Negative expectancy |
| `orb-15-breakout` | 7 | 28.57% | 0.31 | -₹5,238.95 | Negative expectancy |
| `rsi-exhaustion-reversal` | 27 | 48.15% | 0.65 | -₹7,151.73 | Negative expectancy |
| `macd-histogram-breakout` | 28 | 42.86% | 0.49 | -₹13,507.10 | Negative expectancy |
| `mtf-vwap-trend` | 30 | 23.33% | 0.25 | -₹24,859.27 | Negative expectancy |
| `vwap-momentum-pullback` | 56 | 30.36% | 0.29 | -₹41,618.78 | Negative expectancy |
| `regime-adaptive-ensemble` | 105 | 40.95% | 0.49 | -₹45,729.84 | Negative expectancy |
| `opening-gap-reversal` | 66 | 13.64% | 0.08 | -₹84,410.12 | Negative expectancy |
| `institutional-vwap-reversion` | 0 | 0.00% | 0.00 | ₹0.00 | Zero triggers in sample |

---

## 3. Full 24-Stock Strict 78% OOS Audit (`high-conviction-ai-ensemble`, `5m`)

Executed **after** raising the `useOutOfSampleOnly` cutoff to `0.78` (`BUG-021` fix):

- **Total Trades:** `233` (`169` Wins / `64` Losses)
- **Net Win Rate:** **72.53%** (95% Wilson Confidence Interval: **66.47% – 77.86%**)
- **Profit Factor:** **1.92**
- **Net Profit (after NSE fees):** **+₹82,310.62**
- **Total NSE Statutory Charges Paid:** **₹157,622.38**
- **Expectancy:** **+₹353.26 / trade** (Avg Win: `₹1,017.38`, Avg Loss: `₹1,400.42`)
- **Sharpe / Sortino:** **4.58** / **3.53**
- **Max Drawdown:** **0.58%**

### Mandatory Real-Market Honesty Classification
**Verdict: `INSUFFICIENT REAL-MARKET EVIDENCE`**  
Although `high-conviction-ai-ensemble` achieved **72.53%** strictly out-of-sample on the 24-stock `5m` run after eliminating all look-ahead and validation-overlap leaks, `server/data/nseUniverse.ts` is a deterministic calibrated Markov dataset (14 trading days) rather than a multi-month exchange-licensed NSE tick feed. Real-market viability at `>= 70%` net win rate cannot be claimed until re-tested on multi-month live/exchange-recorded NSE intraday candles.

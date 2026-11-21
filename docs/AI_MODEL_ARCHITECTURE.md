# AI Model Architecture (`AI_MODEL_ARCHITECTURE.md`)

## 1. Independent Intelligence Modules

1. **Module A — Market Direction & Breadth:** Evaluates NIFTY 50 & sector index trend slopes, advance/decline breadth, and volatility expansion.
2. **Module B — Causal Technical Analysis Engine:** Computes EMA(9/21), SMA(50), Wilder RSI(14), MACD(12,26,9), Session VWAP (reset 09:15 IST), ATR(14), ADX(14), Supertrend(10,3), Bollinger(20,2), and Opening Range(15m).
3. **Module C — Market Regime Classifier:** Maps bar `t` state into `STRONG_TREND_BULL`, `STRONG_TREND_BEAR`, `SIDEWAYS_RANGE`, `HIGH_VOL_BREAKOUT`, or `UNCERTAIN_CHOP`.
4. **Module D — Calibrated Stock Prediction:** Logistic + Boosted Stump ensemble trained strictly on chronological `train` split with an embargo gap (`5` bars) before `validation` and `out-of-sample test`. Outputs calibrated `p(targetBeforeSL)` via Platt scaling.
5. **Module E — Signal Generator:** Emits `BUY`, `SELL`, `HOLD`, or `NO_TRADE`. Rejects signals when R/R < threshold, regime is `UNCERTAIN_CHOP`, liquidity is below minimum, or feed is stale.
6. **Module F — Gemini Explainability (`gemini-4-hydrogen`):** Translates quantitative signal attributes and market state into human-readable rationales. **Never alters Entry, SL, Target, or Risk Engine verdicts.**

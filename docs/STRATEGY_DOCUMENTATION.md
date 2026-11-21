# Trading Strategy Library & Builder (`STRATEGY_DOCUMENTATION.md`)

## 1. Prebuilt Strategy Registry (15 Versioned Intraday Strategies)
1. **ORB-15 Breakout (`v1.2.0`):** Breaks above/below 09:15–09:30 IST range with `RelVol >= 1.4` and VWAP alignment.
2. **VWAP Momentum Pullback (`v1.1.0`):** Pullback to Session VWAP in `STRONG_TREND` with EMA(9)>EMA(21).
3. **Supertrend + ADX Trend (`v1.0.4`):** Supertrend(10,3) flip confirmed by `ADX(14) >= 22`.
4. **Bollinger Mean Reversion (`v1.2.1`):** Fades `<= -2σ` / `>= +2σ` band extremes strictly in `SIDEWAYS_RANGE` regime (`ADX < 20`).
5. **EMA 9/21 Volume Crossover (`v1.0.2`):** Fast/slow EMA cross with volume confirmation.
6. **RSI Exhaustion Reversal (`v1.1.0`):** `RSI < 28` bounce or `RSI > 72` rejection back across trigger levels.
7. **MACD Histogram Zero Cross (`v1.0.1`):** MACD line cross + expanding histogram above VWAP.
8. **Volume Shock Breakout (`v1.1.2`):** `RelVol >= 2.0` breaking rolling 20-bar high/low.
9. **Multi-Timeframe VWAP Trend (`v1.0.3`):** 15m EMA alignment + 5m VWAP continuation trigger.
10. **Volatility Squeeze Release (`v1.0.0`):** Narrow BB bandwidth expansion with directional break.
11. **Price Action HH-HL Structure (`v1.0.1`):** Structural swing break with ATR-buffered stop.
12. **Opening Gap Reversal (`v1.0.0`):** Fades overextended opening gap back toward VWAP when momentum stalls.
13. **Regime-Adaptive Ensemble (`v1.3.0`):** Dynamically dispatches Momentum in trend regimes, Mean Reversion in sideways regimes, and `NO_TRADE` in chop.
14. **Institutional Volume-Weighted Reversion (`v1.0.2`):** VWAP ±2×ATR reversion during midday range compression.
15. **High-Conviction AI Calibrated Filter (`v1.4.0`):** Trades only when calibrated ML `p(win) >= 0.65`, `R/R >= 1.6`, and aligned regime.

## 2. Custom No-Code Visual Strategy Builder
Users can compose white-box rule sets by selecting indicator conditions (`VWAP`, `RSI`, `EMA`, `ADX`, `Supertrend`, `Bollinger`, `RelVol`), regime filters, ATR stop/target multipliers, trailing stop-loss, and max holding bars—immediately testable in the Backtesting Laboratory.

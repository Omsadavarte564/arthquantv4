# Product Requirements Document (`PRODUCT_REQUIREMENTS.md`)

## 1. Target Scope
- **Phase 1 Focus:** NSE & BSE Cash Equity Intraday (`09:15–15:30 IST`, RMS auto-square-off `15:15 IST`). Futures & Options remain decoupled future modules.
- **Core Personas:** Quantitative retail trader, systematic strategy builder, research analyst requiring transparent white-box logic and calibrated probabilities.

## 2. Functional Modules
1. **Overview Terminal:** Live/research indices (NIFTY 50, BANK NIFTY, SENSEX), market regime banner, data mode indicator, AI market brief, top signals, open paper positions, strategy health, daily P&L.
2. **Market Analysis:** Sector rotation performance, advance/decline breadth, top gainers/losers, unusual relative volume shockers, FII/DII contextual intelligence.
3. **AI Stock Scanner:** Multi-factor filter & sort across NSE universe (price, RVol, RSI, VWAP deviation, AI probability, R/R, regime) + persistent watchlists.
4. **AI Signal Centre:** Actionable `BUY`, `SELL`, `HOLD`, `NO TRADE` feed with entry zone, SL, Target 1/2, R/R, calibrated probability, 95% CI, justification, Gemini explanation, and one-click risk-checked paper execution.
5. **Advanced Charts:** TradingView Lightweight Charts with multi-timeframe candlesticks, volume, EMA 9/21, Session VWAP, Bollinger Bands, Supertrend, Entry/SL/Target lines, and historical signal markers.
6. **Strategy Lab:** 15 configurable prebuilt strategies + No-Code Visual Strategy Builder (StrykeX-inspired) with parameter validation and versioning.
7. **Backtesting Laboratory:** No-lookahead event-driven simulator with exact NSE statutory fees, slippage, equity curve, drawdown, regime attribution, and CSV/JSON export.
8. **Paper Trading:** Persisted simulated order book, market/limit orders, SL/Target tracking, unrealized/realized P&L, and clear `SIMULATED` labeling.
9. **Portfolio & Trade Journal:** Capital utilization, exposure, complete audit of signals, rejected risk checks, and executed trades.
10. **Risk Dashboard:** Independent deterministic gatekeeper, configurable limits, position sizing, emergency kill switch, and immutable decision log.
11. **Reports & 70% ML Lab:** Walk-forward out-of-sample evaluation, calibration reliability curves, Brier score, log loss, and Wilson confidence intervals.
12. **Broker Connections & Settings:** Adapter readiness matrix for Kite, Upstox, Dhan, Angel One + SEBI compliance gate + Dark/Light theme.

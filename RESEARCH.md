# Market, Platform & Infrastructure Research (`RESEARCH.md`)

**Research Date:** November 18, 2026  
**Target Domain:** Indian Equity Cash Intraday Trading (NSE / BSE)

## 1. Reference Platform Findings

### StockWise (`https://stockwise.in/` & Google Play `in.stockwise.app`)
Verified capabilities from public product documentation:
- **AI Earnings & Concall Summaries:** Condenses conference call transcripts, management commentary, and quarterly filings into bullish drivers, risks, and forward guidance.
- **360° Stock Research & Screeners:** Combines fundamental balance sheet/valuation ratios with technical indicators (RSI, MACD, Moving Averages) and customizable screeners.
- **Institutional ("Smart Money") Flow Tracking:** Tracks FII/DII net flows, bulk/block deals, insider transactions, and prominent investor holdings.
- **Market Movers & Sector Intelligence:** Monitors NIFTY 50, SENSEX, NIFTY Bank, NIFTY IT, NIFTY Midcap, top gainers/losers, volume shockers, and sector rotation.
- **Gaps for Intraday Execution:** Primarily oriented toward equity research, discovery, and positional intelligence rather than sub-5m intraday signal execution, automated risk gating, or realistic intraday slippage/cost simulation.

### StrykeX (`https://www.strykex.in/home/`)
Verified capabilities from public product documentation (Stockwiz Technologies):
- **No-Code 5-Step Strategy Builder:** Template-driven and menu-driven rule builder covering instrument, timeframe, candle type, and 100+ indicators / 500+ parameters without writing code.
- **Backtest Terminal:** Multi-year historical testing factoring in slippage and transaction charges, outputting Net P&L, win rate, max drawdown, risk/reward, and profit factor.
- **Virtual / Forward Testing & Broker Autopilot:** Single-lot paper forward testing before automated live deployment via supported brokers (e.g., Dhan).
- **Risk Controls:** Pre-set stop-losses, targets, trailing stop-loss, partial profit booking, re-entry rules, and daily loss caps.
- **Gaps & Verification Notes:** Multi-leg options wizard is prominent, while transparent out-of-sample ML probability calibration, Brier-score validation, and open causal feature audits are not publicly exposed.

## 2. Indian Equity Intraday Microstructure & Cost Reality

NSE Cash Equity Intraday (`09:15–15:30 IST`, RMS auto-square-off typically `15:15–15:20 IST`) imposes deterministic statutory costs that frequently destroy naive high-frequency strategies:
- **Brokerage:** Flat ₹20 or 0.03% per executed order (whichever is lower) on discount brokers (Zerodha/Upstox/Dhan/Angel One).
- **STT (Securities Transaction Tax):** `0.025%` on sell leg only.
- **Stamp Duty:** `0.003%` on buy leg only.
- **NSE Exchange Transaction Charge:** `~0.00297%` on both buy and sell turnover.
- **SEBI Turnover Fee:** `₹10 per crore` (`0.0001%`) on both sides.
- **NSE IPFT Charge:** `₹10 per crore` (`0.0001%`) on both sides.
- **GST:** `18%` applied on `(Brokerage + Exchange Transaction Charges + SEBI Turnover Fee)`.

**Implication:** A ₹1,00,000 round-trip intraday trade incurs ~₹40–₹75 in statutory & brokerage fees (~4–7.5 bps) *before* bid-ask spread and slippage (~3–10 bps). Any intraday strategy targeting <15 bps average gross edge fails net expectancy even at a 70% gross win rate.

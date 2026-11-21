# Independent Risk Management Engine (`RISK_MANAGEMENT.md`)

**Core Principle:** The AI/ML and Strategy engines only **propose** trades. The deterministic Risk Management Engine holds **final veto authority**.

## 1. Pre-Trade Deterministic Gatekeeper Checks
Every candidate order undergoes 9 sequential checks:
1. **Emergency Kill Switch:** Rejects immediately if `killSwitchActive === true`.
2. **Daily Loss Limit:** Rejects if `dailyRealizedPnl <= -maxDailyLossInr`.
3. **Max Consecutive Losses:** Locks trading after `N` consecutive losing trades (default `3`).
4. **Max Open Positions:** Caps concurrent open positions (default `4`).
5. **Max Trades Per Day:** Caps daily turnover/overtrading (default `12`).
6. **Minimum Risk/Reward Ratio:** Rejects setups below `minRiskReward` (default `1.5`).
7. **Capital & Per-Stock Exposure Cap:** Prevents single-stock concentration above `maxStockExposurePct` (default `25%`) and total exposure above `maxTotalExposurePct` (default `80%`).
8. **Liquidity & Spread Check:** Rejects illiquid names or excessive simulated bid-ask spread.
9. **Intraday Market Cutoff:** Blocks new entries after `15:00 IST` (square-off enforced at `15:15 IST`).

## 2. Risk-Based Position Sizing
$$\text{Qty} = \left\lfloor \min\left(\frac{\text{Capital} \times \text{RiskPerTradePct}}{|\text{Entry} - \text{StopLoss}|},\; \frac{\text{Capital} \times \text{MaxStockExposurePct}}{\text{Entry}}\right) \right\rfloor$$

Every `APPROVED` or `REJECTED` decision is appended to an immutable Risk Audit Log with timestamp, symbol, requested quantity, approved quantity, and exact rule evaluation.

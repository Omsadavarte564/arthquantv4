# Model Evaluation & 70% Win-Rate Validation Framework (`MODEL_EVALUATION.md`)

## 1. Strict Evaluation Protocol
- **Definition of Winning Trade:** Completed trade where `Net P&L = Gross P&L - Brokerage - STT - Exchange Txn - SEBI - IPFT - Stamp Duty - GST - Slippage > ₹0`.
- **Chronological Splitting:** `60% Train` → `Embargo (5 bars)` → `20% Calibration Validation` → `Embargo (5 bars)` → `20% Untouched Out-of-Sample Test`.
- **Probability Calibration Metrics:**
  - **Brier Score:** Mean squared error between predicted probability and realized binary outcome (`0` = SL/loss, `1` = profitable target). Lower is better (`< 0.25` beats coin flip).
  - **Log Loss:** Penalizes overconfident wrong predictions heavily.
  - **Reliability Diagram:** Compares predicted probability deciles/bins (`0.50–0.60`, `0.60–0.70`, `0.70–0.80`, `0.80+`) against empirical out-of-sample win rates.
- **Statistical Reliability:** Every reported win rate includes trade count `N` and **95% Wilson Score Confidence Interval** so small sample sizes cannot masquerade as 70% reliability.

## 2. Honesty Criterion
A strategy showing 70% win rate with negative net expectancy (e.g., tiny targets + huge stop-losses) is **rejected**. High-conviction filtering (trading only in aligned regimes above a calibrated probability floor) reduces trade frequency while testing whether selective OOS win rates can approach or exceed 70%.

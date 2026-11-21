# Backtesting Methodology (`BACKTESTING_METHODOLOGY.md`)

## 1. Anti-Bias Guarantees
1. **No Look-Ahead Bias:** Signals computed from closed bar `t` (`09:20 IST` close) are eligible for execution **only on bar `t+1` open** (`09:25 IST`), never at bar `t` close or bar `t` favorable extreme.
2. **Conservative Intrabar Resolution:** If both Stop-Loss and Target fall within a single bar's `[low, high]` range, the engine assumes **Stop-Loss was hit first**.
3. **Intraday Session Square-Off:** All open intraday positions are forcibly squared off at `15:15 IST` each session to avoid overnight gap distortion and broker RMS auto-square-off penalties.
4. **Exact NSE Equity Intraday Statutory Cost Model:**
   - Brokerage: `min(₹20, 0.03% × turnover)` per executed order leg.
   - STT: `0.025%` on sell turnover.
   - Stamp Duty: `0.003%` on buy turnover.
   - NSE Transaction Charge: `0.00297%` on buy & sell turnover.
   - SEBI Turnover Fee: `0.0001%` (`₹10/Cr`) on buy & sell turnover.
   - NSE IPFT Charge: `0.0001%` (`₹10/Cr`) on buy & sell turnover.
   - GST: `18%` on `(Brokerage + NSE Transaction Charge + SEBI Fee)`.
   - Configurable Slippage: default `5 bps` (`0.05%`) adverse fill per leg.

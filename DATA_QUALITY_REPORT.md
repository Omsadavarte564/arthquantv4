# Market Data Quality Report (`DATA_QUALITY_REPORT.md`)

**Report Date:** 2026-11-20 IST  
**Modules Audited:** `server/data/nseUniverse.ts`, `server/data/publicMarketFeed.ts`, `server/data/nseDirectory.ts`, `server/data/validator.ts`.

---

## 1. Market Data Sources & Classification

1. **`HISTORICAL_RESEARCH_DATASET` (`server/data/nseUniverse.ts`):**
   - Coverage: 24 NSE equities + 3 indices (`NIFTY50`, `BANKNIFTY`, `SENSEX`).
   - Window: 14 deterministic simulated trading sessions (`2026-10-30` to `2026-11-18`, `09:15–15:25 IST`), `1,050` 5-minute bars per stock (`3,750` 1m, `350` 15m).
   - Holiday & Session Integrity: Skips weekends and `NSE_HOLIDAYS_2026` (`2026-11-09` skipped cleanly).
   - **Limitation:** Deterministic synthetic price process with built-in intraday trend bias and autocorrelated drift — useful for reproducible unit/regression testing, **NOT** substitute evidence for live NSE market microstructure.

2. **`PUBLIC_DELAYED_NSE_FEED` (`server/data/publicMarketFeed.ts`):**
   - Coverage: Live/delayed OHLCV & spark quotes for all `3,108+` NSE equities (`SYMBOL.NS`) via Yahoo Finance v8 public API (`1m` 5d, `5m`/`15m` 1mo).
   - **Observed Real Sample (`2026-10-21` to `2026-11-20` on `5m`):**
     - `RELIANCE`: `1,625` bars, `0` malformed OHLC bars, `0` duplicates, `0` `>10%` outliers, **`22` intraday session gaps** reported by `validator.ts`.
     - `TCS`: `1,623` bars, `22` gaps detected.
     - `HDFCBANK`: `1,625` bars, `22` gaps detected.

3. **`LIVE_BROKER_FEED` (`server/brokers/brokerAdapter.ts`):**
   - Status: `LIVE_VERIFICATION_PENDING` / `DISCONNECTED_CREDENTIALS_NOT_SET` across Zerodha, Upstox, Dhan, Angel One. Real-time tick WebSockets are inactive without broker credentials and SEBI static IP whitelisting.

---

## 2. Data Quality Defects & Risks Identified

| # | Severity | File / Line | Issue Observed | Potential Impact | Fix |
|---|---|---|---|---|---|
| 1 | **High** | `server/data/validator.ts` (L20–101), `publicMarketFeed.ts` (L74–112) | **Forming / Incomplete Candle Not Detected:** When querying Yahoo `.NS` during active NSE market hours (`09:15–15:30 IST`), the latest bar is a partially formed live candle whose volume and high/low are incomplete. `validator.ts` treats it identically to closed bars. | Signals and rolling indicators (`VWAP`, `RelVol`, `ORB`, `EMA`) evaluated on a forming bar suffer intrabar lookahead/flicker and distort relative volume ratios (`c.volume / avgVol` looks artificially tiny in the first 30 seconds of a 5m bar!). | Detect forming latest candle when within active NSE session and timestamp `> nowSec - stepSec`, flag `formingBarDetected`, and exclude forming bar from closed-bar signal/ML inference while still displaying live LTP. |
| 2 | **Medium** | `server/data/validator.ts` (L46–70) | **Zero-Volume & Illiquid Bar Blindness:** `validator.ts` checks `c.volume < 0` only. Yahoo `.NS` regularly emits `volume === 0` bars during closing/pre-closing or illiquid small-cap windows (`publicMarketFeed.ts` L80 defaults `null` volume to `0`). | Silently corrupts VWAP accumulation (`typicalPrice * 0`), `relVolume` (`0`), and gives false illusion of liquid execution in small-cap NSE stocks. | Count and alert `zeroVolumeBars` during regular trading hours (`09:15–15:25 IST`), and exclude zero-volume/auction anomalies from liquidity/signal triggers with explicit alert notes. |
| 3 | **Medium** | `server/data/validator.ts` (L62–69) | **Session Gap & Corporate Action / Split Anomaly Ambiguity:** On real `.NS` data, `gapsDetected = 22` occurred across ~22 sessions (missing opening/closing 5m intervals or special Diwali Muhurat/holiday quirks), and `barJumpPct > 0.1` checks intra-bar and overnight jumps identically without flagging potential unadjusted splits/bonuses (`>15%` overnight jump). | Mixed overnight split vs intrabar spike warnings; missing bars are neither clearly itemized nor alerted cleanly in `DataHealthPanel`. | Separate `intradayGapsDetected` from `overnightSplitOrGapFlags` (`>15%` overnight close-to-open discontinuity), and flag abnormal high-low wick spikes (`(high - low) / close > 8%`) for data quality inspection. |
| 4 | **Medium** | `server/quant/signals.ts` (L178–211) | **Prediction Provenance Gap:** `TradingSignal` records `timestampIst` (bar label) and `dataMode`, but lacks explicit `marketDataTimestampIst` + `predictionHorizonBars` + `dataQualityStatus` fields propagated to the prediction audit ledger. | Cannot audit the exact latest market information timestamp available at prediction inference time. | Attach `marketDataTimestampIst`, `predictionHorizonBars`, and `dataQualityPassed` onto every signal and immutable `PredictionRecord`. |
| 5 | **Low** | `server/data/nseUniverse.ts` (L3–18) | **Static 2026 Holiday Calendar & Hardcoded Adjustment Assumption:** `NSE_HOLIDAYS_2026` covers 2026 only; Yahoo `.NS` historical series (`chart` API) uses split-adjusted closes without explicit dividend/corporate action metadata surfaced to UI. | Cross-year transitions or unannounced NSE special sessions (e.g. Saturday budget/Muhurat trading) could be misclassified without updating holidays. | Document holiday calendar scope transparently and surface corporate-action jump alerts when `>15%` overnight discontinuity appears. |

---

## 3. Consistency Between Historical & Live Definitions
- Timestamps are normalized uniformly to UTC Unix seconds + `Asia/Kolkata` (`YYYY-MM-DD HH:MM IST`) and `sessionDate` (`YYYY-MM-DD`).
- NSE tick rounding (`₹0.05` multiples) and session boundaries (`09:15–15:30 IST`, `15:15` MIS square-off) match across historical and live/paper modules.
- **No silent fabrication guarantee:** `validator.ts` never interpolates or fabricates missing candles; gaps are counted and surfaced in `DataValidationReport` and `DataHealthStatus`.

---

## 4. Verified Data Pipeline Enhancements Implemented
- **`server/data/validator.ts`:** Upgraded with `zeroVolumeBars` (during regular `09:15–15:25 IST` hours), `overnightSplitFlags` (`>15%` overnight close-to-open discontinuity), `outlierBarsFlagged` (`>8%` intrabar range or `>10%` bar jump), and `excludeFormingBar` (pops incomplete live candle when `0 <= age < stepSec` so closed-bar inference never reads forming volume/close).
- **Verified Live `.NS` Check (`RELIANCE.NS`, `TCS.NS`, `HDFCBANK.NS`, `ICICIBANK.NS`, `INFY.NS` `5m`):** Reported `23–27` zero-volume regular bars across `~1,625` bars per symbol cleanly without silent interpolation, and excluded forming candles cleanly when evaluating `/api/ml/evaluate` with `dataset = 'public'`.
- **Provenance Propagation:** Every `TradingSignal` and `PredictionRecord` now explicitly stamps `marketDataTimestampIst`, `predictionHorizonBars`, and `dataQualityPassed`.


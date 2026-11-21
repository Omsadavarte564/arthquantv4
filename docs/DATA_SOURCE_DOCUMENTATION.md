# Market Data Architecture & Validation (`DATA_SOURCE_DOCUMENTATION.md`)

## 1. Authorized Data Policy
- **Prohibited:** Scraping NSE/BSE websites or misrepresenting free/delayed feeds as exchange-grade real-time NSE data.
- **Current Built-In Dataset (`HISTORICAL_RESEARCH_DATASET`):** Deterministic multi-session 1m/5m/15m OHLCV bars for 24 liquid NIFTY constituents + NIFTY 50, BANK NIFTY, and SENSEX, modeled with realistic opening-range expansion, midday volume U-curve, tick increments (`₹0.05`), and IST session boundaries (`09:15–15:30 IST`).
- **Authorized Production Connectors:** Zerodha Kite Connect WebSocket/Historical API, DhanHQ Data API, Upstox Market Feed v2, or licensed NSE data vendors (TrueData, Global Datafeeds).

## 2. Mandatory Data Validation Pipeline
Every ingested candle batch passes deterministic validation checks:
1. **Timestamp Monotonicity & Deduplication**
2. **OHLC Integrity (`high >= max(open, close)`, `low <= min(open, close)`, `volume >= 0`)**
3. **IST Exchange Calendar & Holiday Check** (excludes weekends and NSE 2026 holidays)
4. **Missing-Bar Gap & Stale-Feed Detection** (flags gaps > 1 bar or stale feed > 60s during live hours)
5. **Outlier / Circuit Filter** (flags abnormal single-bar spikes > ±10% for manual verification)

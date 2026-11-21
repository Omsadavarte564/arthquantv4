import { RagCollection } from '../../src/types/trading.ts';

export interface SeedDocumentSpec {
  title: string;
  sourceUrl: string;
  publisher: string;
  category: string;
  collection: RagCollection;
  publicationDate: string;
  effectiveDate: string;
  exchangeOrCompany: string;
  relatedSymbol?: string;
  content: string;
}

export const SEED_KNOWLEDGE_DOCUMENTS: SeedDocumentSpec[] = [
  {
    title: 'NSE Cash Equity Trading Sessions, Pre-Open & 2026 Holiday Calendar',
    sourceUrl: 'https://www.nseindia.com/resources/exchange-communication-holidays',
    publisher: 'National Stock Exchange of India (NSE)',
    category: 'Exchange Market Rules',
    collection: 'INDIAN_MARKET',
    publicationDate: '2026-01-01',
    effectiveDate: '2026-01-01',
    exchangeOrCompany: 'NSE',
    content: `NSE Cash Market Session Schedule (IST):
Pre-Open Session: 09:00 IST to 09:15 IST (order entry 09:00–09:08, price matching 09:08–09:15).
Normal Continuous Market: 09:15 IST to 15:30 IST Monday to Friday excluding Exchange Holidays.
Intraday MIS Square-off Risk Discipline: Quantitative intraday strategies avoid opening new positions in the final 15 minutes (after 15:10 IST) and flatten open intraday exposures before broker auto-square-off windows (typically 15:15–15:20 IST).
Tick Size: Standard ₹0.05 tick for most NSE cash equities; ₹0.01 for sub-₹250 securities per exchange circulars.
2026 NSE Market Holidays: 2026-01-26 (Republic Day), 2026-03-03 (Holi), 2026-03-26 (Shri Ram Navami), 2026-03-31 (Mahavir Jayanti), 2026-04-03 (Good Friday), 2026-04-14 (Ambedkar Jayanti), 2026-05-01 (Maharashtra Day), 2026-08-15 (Independence Day), 2026-09-14 (Ganesh Chaturthi), 2026-10-02 (Mahatma Gandhi Jayanti), 2026-10-20 (Dussehra), 2026-11-09 (Diwali Balipratipada), 2026-11-24 (Gurunanak Jayanti), 2026-12-25 (Christmas).`,
  },
  {
    title: 'SEBI Circular on Participation of Retail Investors in Algorithmic Trading',
    sourceUrl: 'https://www.sebi.gov.in/legal/circulars/feb-2025/safer-participation-of-retail-investors-in-algorithmic-trading_91614.html',
    publisher: 'Securities and Exchange Board of India (SEBI)',
    category: 'SEBI Circular',
    collection: 'REGULATORY_COMPLIANCE',
    publicationDate: '2025-02-04',
    effectiveDate: '2025-08-01',
    exchangeOrCompany: 'SEBI / NSE / BSE',
    content: `Circular Reference: SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/0000013 (dated February 4, 2025).
Core Requirements for Retail API & Algorithmic Trading in India:
1. Static IP Whitelisting: Retail clients connecting via broker APIs must register static IP addresses with their stock broker. Dynamic/unregistered IPs are blocked for order execution.
2. Unique Algo Tagging & Order Thresholds: Orders exceeding SEBI's specified orders-per-second threshold must be tagged with a unique Exchange Algo ID. Black-box third-party algorithms require Research Analyst / Investment Adviser registration and exchange empanelment.
3. Two-Factor / OAuth Daily Session Rotation: Broker API tokens expire daily prior to the next trading day and require TOTP/2FA authentication.
4. Safety Controls & Kill Switch: Platforms must provide pre-trade risk validation, daily maximum loss lockouts, and an immediate emergency kill switch that cancels pending orders and blocks new order routing.`,
  },
  {
    title: 'Indian Broker API Readiness & Rate-Limit Reference (Zerodha, Upstox, DhanHQ, Angel One)',
    sourceUrl: 'https://kite.trade/docs/connect/v3/',
    publisher: 'ArthQuant Broker Integration Reference',
    category: 'Broker API Documentation',
    collection: 'REGULATORY_COMPLIANCE',
    publicationDate: '2026-02-01',
    effectiveDate: '2026-02-01',
    exchangeOrCompany: 'NSE Brokers',
    content: `Indian Broker API Technical Summary:
- Zerodha Kite Connect: 10 orders/sec, 400 req/min, max 5,000 orders/day, 3 historical candle req/sec, max 3 WebSocket connections (up to 3,000 tokens each). Static IP mandatory.
- Upstox Developer API v2: 10 orders/sec standard, up to 50 req/sec OHLC quotes, OAuth 2.0 + 2FA daily token, mandatory static IP whitelisting.
- DhanHQ API v2: 10 orders/sec, 20 req/sec non-trading, 1–5 req/sec market data, daily token rotation + static IP mapping.
- Angel One SmartAPI: 10 orders/sec, 400–600 req/min, Client Code + MPIN + TOTP authentication (expires at midnight IST), up to 5 static IPs per key.
In ArthQuant, live execution remains hard-locked (liveExecutionEnabled: false) until OAuth, static IP, and exchange algo compliance checks are completed.`,
  },
  {
    title: 'ArthQuant Intraday Quantitative Indicators & Regime Classification Manual',
    sourceUrl: 'local://arthquant/docs/trading-indicators-manual',
    publisher: 'ArthQuant Quantitative Research',
    category: 'Technical Indicators Manual',
    collection: 'TRADING_KNOWLEDGE',
    publicationDate: '2026-06-15',
    effectiveDate: '2026-06-15',
    exchangeOrCompany: 'ArthQuant Engine',
    content: `Causal Technical Indicators & Regime Engine Documentation:
1. Session VWAP: Resets strictly at 09:15 IST each trading day using cumulative typical price ((H+L+C)/3) * volume divided by cumulative volume. Prevents multi-day leakage.
2. Wilder RSI(14) & ADX(14): Computed strictly causally using Wilder's smoothed moving averages. ADX > 25 indicates directional trend strength; ADX < 18 indicates sideways/choppy range.
3. Opening Range Breakout (ORB 15m): Captures high and low of the first 15 minutes of each NSE session (09:15–09:30 IST).
4. Supertrend (ATR 10, Multiplier 3): Causal trailing volatility trend band.
5. Regime Taxonomy: STRONG_TREND_BULL, STRONG_TREND_BEAR, SIDEWAYS_RANGE, HIGH_VOL_BREAKOUT, UNCERTAIN_CHOP. Signals are suppressed (NO_TRADE) during UNCERTAIN_CHOP or when live freshness validation fails.`,
  },
  {
    title: 'No-Lookahead Walk-Forward ML & Backtesting Methodology Specification',
    sourceUrl: 'local://arthquant/docs/backtesting-ml-spec',
    publisher: 'ArthQuant Quantitative Research',
    category: 'Backtesting & ML Methodology',
    collection: 'TRADING_KNOWLEDGE',
    publicationDate: '2026-09-01',
    effectiveDate: '2026-09-01',
    exchangeOrCompany: 'ArthQuant Engine',
    content: `Anti-Leakage & Cost Accounting Standards in ArthQuant:
1. Chronological Walk-Forward Split: Train (~58%), Embargo gap (12 bars to prevent triple-barrier label overlap), Platt Calibration Validation (~18%), and untouched Out-of-Sample Test (~22–24%). Backtesting with useOutOfSampleOnly starts strictly at 78% of series length so validation bars never overlap test metrics.
2. Next-Bar Open Execution: Signals generated on closed bar i execute at bar[i+1].open with realistic slippage.
3. Conservative Intrabar Exit & Trailing Stop Ordering: Bar stop-loss and target checks run BEFORE trailing stop updates from bar.close, with trailing activation restricted to barsHeld >= 1 and profit > 1 ATR.
4. NSE Intraday Statutory Charges: Models Zerodha-style brokerage (₹20 or 0.03%), STT (0.025% sell side), NSE Exchange Transaction Fee (0.00297%), SEBI turnover charge, IPFT, Stamp Duty (0.003% buy side), and 18% GST.`,
  },
  {
    title: 'NSE Intraday Statutory Transaction Charges & Slippage Reference (FY 2025-26)',
    sourceUrl: 'https://www.nseindia.com/trade/platform-services-transaction-charges',
    publisher: 'NSE / ArthQuant Cost Model',
    category: 'Transaction Cost Analysis',
    collection: 'FINANCIAL_NEWS_RESEARCH',
    publicationDate: '2026-04-01',
    effectiveDate: '2026-04-01',
    exchangeOrCompany: 'NSE Equity Intraday',
    content: `NSE Cash Equity Intraday Statutory Cost Breakdown:
- Brokerage: Lower of ₹20 per executed order or 0.03% of leg turnover (₹40 round-trip cap for typical intraday legs).
- Securities Transaction Tax (STT): 0.025% on sell-side turnover for equity intraday trades.
- Exchange Transaction Charges (NSE): 0.00297% on total turnover (effective NSE cash equity slab).
- SEBI Turnover Fee: ₹10 per crore (0.0001%) on total turnover.
- Investor Protection Fund Trust (IPFT): ₹10 per crore (0.0001%) on total turnover.
- Stamp Duty: 0.003% on buy-side turnover.
- GST: 18% levied on (Brokerage + Exchange Transaction Charges + SEBI Charges + IPFT).
Understanding net-of-cost expectancy is mandatory because high-turnover strategies with gross win rates near 50% frequently turn net-negative after Indian statutory charges.`,
  },
  {
    title: 'Reliance Industries Ltd (RELIANCE) — Corporate & Sector Risk Reference Profile',
    sourceUrl: 'https://www.nseindia.com/get-quotes/equity?symbol=RELIANCE',
    publisher: 'ArthQuant Equity Reference (NSE Filing Summary)',
    category: 'Company Profile & Risk Factors',
    collection: 'COMPANY_INFO',
    publicationDate: '2026-10-15',
    effectiveDate: '2026-10-15',
    exchangeOrCompany: 'Reliance Industries Ltd',
    relatedSymbol: 'RELIANCE',
    content: `Reliance Industries Ltd (NSE: RELIANCE) — Key Reference Context:
Sector: Energy & Petrochemicals, Retail, and Digital Services (Jio).
Index Membership: NIFTY 50 heavyweight constituent.
Key Business Drivers: Oil-to-Chemicals (O2C) refining margins, Jio ARPU & subscriber additions, Reliance Retail store expansion and margin trajectory, and New Energy capex.
Key Intraday & Fundamental Risk Factors: Crude oil & Singapore GRM volatility, telecom tariff/regulatory sensitivity, high capital expenditure cycles impacting near-term free cash flow, and INR/USD currency fluctuations.
Note: Verify latest quarterly earnings (Q2/Q3 FY27) via uploaded exchange announcements before making company-specific financial assertions.`,
  },
  {
    title: 'Infosys Ltd (INFY) — Corporate & IT Sector Risk Reference Profile',
    sourceUrl: 'https://www.nseindia.com/get-quotes/equity?symbol=INFY',
    publisher: 'ArthQuant Equity Reference (NSE Filing Summary)',
    category: 'Company Profile & Risk Factors',
    collection: 'COMPANY_INFO',
    publicationDate: '2026-10-15',
    effectiveDate: '2026-10-15',
    exchangeOrCompany: 'Infosys Ltd',
    relatedSymbol: 'INFY',
    content: `Infosys Ltd (NSE: INFY) — Key Reference Context:
Sector: IT Services & Consulting (NIFTY IT / NIFTY 50 constituent).
Key Business Drivers: Large deal Total Contract Value (TCV) wins, discretionary BFSI/Retail IT spending in North America and Europe, AI/cloud transformation pipelines, operating EBIT margin guidance, and utilization rates.
Key Intraday & Fundamental Risk Factors: US macroeconomic/Fed rate commentary impacting client budgets, USD/INR currency sensitivity, H-1B/visa regulatory shifts, and post-earnings guidance revisions triggering gap openings on NSE.`,
  },
];

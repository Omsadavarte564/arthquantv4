# ArthQuant RAG Seeded Data Sources (`RAG_DATA_SOURCES.md`)

**Last Updated:** 2026-11-20 19:08 IST

---

## Initial Seeded Knowledge Corpus (`server/rag/seedKnowledgeBase.ts`)

All 8 seed documents are automatically indexed on initial startup into `data/rag-knowledge-base.json` (15 initial chunks):

| # | Title | Collection | Publisher | Pub / Effective Date | Source URI |
|---|---|---|---|---|---|
| 1 | NSE Cash Equity Trading Sessions, Pre-Open & 2026 Holiday Calendar | `INDIAN_MARKET` | National Stock Exchange of India (NSE) | 2026-01-01 | `https://www.nseindia.com/resources/exchange-communication-holidays` |
| 2 | SEBI Circular on Participation of Retail Investors in Algorithmic Trading (`SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/0000013`) | `REGULATORY_COMPLIANCE` | Securities and Exchange Board of India (SEBI) | 2025-02-04 / 2025-08-01 | `https://www.sebi.gov.in/legal/circulars/feb-2025/safer-participation-of-retail-investors-in-algorithmic-trading_91614.html` |
| 3 | Indian Broker API Readiness & Rate-Limit Reference (Zerodha, Upstox, DhanHQ, Angel One) | `REGULATORY_COMPLIANCE` | ArthQuant Broker Integration Reference | 2026-02-01 | `https://kite.trade/docs/connect/v3/` |
| 4 | ArthQuant Intraday Quantitative Indicators & Regime Classification Manual | `TRADING_KNOWLEDGE` | ArthQuant Quantitative Research | 2026-06-15 | `local://arthquant/docs/trading-indicators-manual` |
| 5 | No-Lookahead Walk-Forward ML & Backtesting Methodology Specification | `TRADING_KNOWLEDGE` | ArthQuant Quantitative Research | 2026-09-01 | `local://arthquant/docs/backtesting-ml-spec` |
| 6 | NSE Intraday Statutory Transaction Charges & Slippage Reference (FY 2025-26) | `FINANCIAL_NEWS_RESEARCH` | NSE / ArthQuant Cost Model | 2026-04-01 | `https://www.nseindia.com/trade/platform-services-transaction-charges` |
| 7 | Reliance Industries Ltd (`RELIANCE`) — Corporate & Sector Risk Reference Profile | `COMPANY_INFO` | ArthQuant Equity Reference | 2026-10-15 | `https://www.nseindia.com/get-quotes/equity?symbol=RELIANCE` |
| 8 | Infosys Ltd (`INFY`) — Corporate & IT Sector Risk Reference Profile | `COMPANY_INFO` | ArthQuant Equity Reference | 2026-10-15 | `https://www.nseindia.com/get-quotes/equity?symbol=INFY` |

## Supported Admin Upload Formats

- Plain text / Markdown (`.txt`, `.md`, `.markdown`)
- Structured tabular / data feeds (`.csv`, `.json`, `.html`, `.htm`)
- Office & Regulatory Filings (`.pdf`, `.docx`) up to `10 MB` per document.

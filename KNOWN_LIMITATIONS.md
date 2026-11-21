# Known Limitations & Honesty Disclosure (`KNOWN_LIMITATIONS.md`)

**Last Updated:** 2026-11-20 19:08 IST

---

1. **No Live Broker WebSocket Feed (`LIVE_VERIFICATION_PENDING`):**
   Without active broker/exchange credentials (`ZERODHA_API_KEY` / `ZERODHA_API_SECRET`, `UPSTOX_API_KEY` / `UPSTOX_API_SECRET`, `DHAN_CLIENT_ID` / `DHAN_ACCESS_TOKEN`, or `ANGELONE_API_KEY` / `ANGELONE_CLIENT_CODE`), quantitative scanner/backtesting/ML modules run on the deterministic `NSE Historical Research Dataset (Offline Replay)` (`classification: HISTORICAL`). Charts and the NSE Master Directory can additionally query Yahoo Finance's public `.NS` feed (`PUBLIC_DELAYED_NSE_FEED`), which is near-realtime/delayed rather than an authenticated exchange WebSocket stream.

2. **Real-Money Broker Execution Intentionally Locked:**
   All broker adapters maintain `liveExecutionEnabled: false` (`liveTradingLocked: true`) per SEBI `SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/0000013` and mandatory safety boundaries. Neither the UI nor any of the 20 MCP tools can place live exchange orders, bypass `riskEngine.ts`, or disable `killSwitchActive`.

3. **Real-Market 70% Win-Rate Claim (`INSUFFICIENT REAL-MARKET EVIDENCE`):**
   While `high-conviction-ai-ensemble` achieved **72.53%** net win rate (95% CI `66.47%–77.86%`, PF `1.92`, +₹82,310.62 over 233 trades) in the strict 78%-cutoff 24-stock `5m` OOS backtest, `server/data/nseUniverse.ts` contains a 14-day deterministic calibrated dataset rather than multi-month exchange-recorded NSE ticks. Multi-month tick validation on a licensed NSE feed is required before claiming real-market profitability.

4. **Gemini Upstream API & File Search Cloud Sync (`BLOCKED` in Sandbox Runtime):**
   - `server/ai/geminiService.ts`, `server/ai/assistantOrchestrator.ts`, and `server/rag/ragEngine.ts` implement full `@google/genai` integration (`gemini-4-hydrogen`, `gemini-3.1-flash-lite`, `gemini-embedding-2`, and `ai.fileSearchStores`).
   - During live HTTP verification in this container (`2026-11-20 19:07 IST`), the environment's `GEMINI_API_KEY` returned `401 UNAUTHENTICATED ("API key not valid")` from Google's upstream endpoint. Consequently, remote Gemini File Search Store indexing and Gemini LLM prose synthesis could not be verified live against Google's servers; both subsystems degraded gracefully to the local Hybrid BM25/Vector RAG engine and `DETERMINISTIC_GROUNDED_FALLBACK` (returning exact MCP tool metrics and RAG citations). Supplying a valid developer/billing `GEMINI_API_KEY` enables cloud LLM synthesis and File Search sync automatically.

5. **RAG Seed Corpus Scope & PDF/DOCX Extraction:**
   - The 8 initial RAG documents provide foundational NSE, SEBI, statutory cost, indicator/backtest manual, and `RELIANCE`/`INFY` reference context; company-specific filings for all 3,108 NSE symbols must be uploaded by an `ADMIN` in **AI Knowledge Base** before querying company-specific fundamentals.
   - Local Node.js PDF/DOCX extraction handles text-based PDFs (uncompressed and `FlateDecode` `Tj`/`TJ` streams) and standard `.docx` ZIP XML (`word/document.xml`). Scanned image-only PDFs without embedded text require OCR or a valid `GEMINI_API_KEY` for cloud File Search ingestion.

6. **Institutional Macro & Optional Python ML Microservice:**
   - Live FII/DII institutional net flow figures return `null` (`UNAVAILABLE_REQUIRES_NSE_FEED`); volatility is reported via computed annualized realized volatility (`realizedVolAnnualizedPct`).
   - `ML_SERVICE_URL` is unset, so optional external Python ML microservice calls are inactive while the TypeScript walk-forward logistic + Platt engine runs natively.

7. **Environment & Browser Verification Scope:**
   - Local JSON file persistence (`data/arthquant-state.json`, `data/rag-knowledge-base.json`, `data/mcp-audit-log.json`) with header-based `ADMIN`/`TRADER` role guard for Knowledge Base writes rather than multi-tenant Firebase/Cloud SQL auth.
   - Automated headless Playwright/Chromium rendering was unavailable in this sandbox; verification relied on `tsc --noEmit`, `vite build`, 12 automated Node `tsx --test` integration tests, and live HTTP requests against Express on port `3000`.

# Gemini + RAG + MCP Orchestration (`GEMINI_RAG_MCP_INTEGRATION.md`)

**Last Updated:** 2026-11-20 19:08 IST

---

## 1. Orchestration Flow (`server/ai/assistantOrchestrator.ts`)

`POST /api/ai/copilot` routes incoming natural-language queries through `runAssistantCopilot`:

1. **Intent & Symbol Classification (`classifyCopilotIntent`):**
   - Classifies query into `DOCUMENT_QA`, `LIVE_MARKET`, `COMBINED_RESEARCH`, `STRATEGY_PERF`, `PORTFOLIO`, or `GENERAL`.
   - Extracts NSE symbol from `STOCK_UNIVERSE` or the full 3,108-stock `nseDirectory.ts` master.
2. **Strict Source Routing:**
   - **Live/Delayed Prices, Indicators, Signals (`LIVE_MARKET`):** Calls MCP tools (`get_nse_market_status`, `get_nse_stock_quote`, `get_technical_indicators`, `get_ai_trading_signals`, `get_market_overview`). **RAG documents are NOT queried** so stale documents never answer live price questions.
   - **Regulatory, Market Structure & Filings (`DOCUMENT_QA`):** Queries `retrieveRagContext(...)` across separated collections. If `sufficientEvidence === false`, returns a guarded insufficient-evidence response instead of inventing facts.
   - **Combined Research (`COMBINED_RESEARCH`):** Executes live/quant MCP tools + portfolio/risk MCP tools **and** retrieves grounded RAG citations for company risk/regulatory context.
   - **Strategy & ML (`STRATEGY_PERF`):** Invokes `list_strategies`, `get_backtest_history`, and `evaluate_walk_forward_ml` via MCP.
   - **Portfolio & Risk (`PORTFOLIO`):** Invokes `get_paper_portfolio` and `get_risk_dashboard` via MCP.
3. **Gemini Synthesis + Safe Fallback:**
   - Calls `gemini-4-hydrogen` (`ThinkingLevel.LOW`) with fallback to `gemini-3.1-flash-lite` (`ThinkingLevel.MINIMAL`) strictly grounded in the retrieved MCP JSON and RAG excerpts.
   - If `GEMINI_API_KEY` is missing, invalid, or rate-limited (`429`), returns `DETERMINISTIC_GROUNDED_FALLBACK` with the exact verified MCP tool outputs, RAG citations, and `available: false` status.
4. **Data-Source Transparency Tags:**
   - Every response emits `transparencyTags[]` (`LIVE_OR_DELAYED_MARKET_DATA`, `QUANT_ML_ENGINE`, `RETRIEVED_RAG_DOCUMENTS`, `PAPER_PORTFOLIO_DATA`, `GENERAL_EXPLANATION`) rendered visibly in `src/views/AiCopilotView.tsx`.

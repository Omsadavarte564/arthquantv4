# RAG & MCP Integration Bug Log (`INTEGRATION_BUG_LOG.md`)

**Last Updated:** 2026-11-20 19:08 IST

---

| ID | Component | Symptom & Root Cause | Resolution | Verification |
|---|---|---|---|---|
| INT-01 | `tests/ragMcp.test.ts` | `tsc --noEmit` reported `TS18046: 'res.content' is of type 'unknown'` on `Client.callTool` return values. | Added typed `extractToolJson` helper narrowing `Array.isArray(res.content)` before JSON parsing. | `npm run lint` passed with 0 errors. |
| INT-02 | `server/rag/ragEngine.ts` | Live E2E test showed querying `"NSE upfront VaR margin peak penalty rule 2026"` missed a newly uploaded `REGULATORY_COMPLIANCE` doc because `classifyRagQuery` matched `"NSE"` to `INDIAN_MARKET` and `retrieveRagContext` hard-excluded other collections. | Expanded regulatory keywords (`MARGIN\|VAR\|PENALTY\|CLEARING\|RULE\|MANDATE`) in `classifyRagQuery` and changed `retrieveRagContext` to boost auto-classified collections (`+0.06`) while hard-filtering only when `options.collections` is explicitly provided. | Live E2E re-test returned `sufficientEvidence: true`, `confidenceScore: 1`, ranking the circular #1. |
| INT-03 | `server.ts` | Express default `2mb` JSON body limit rejects base64-encoded documents near the 10 MB RAG upload ceiling (~13.3 MB base64). | Raised Express JSON body limit in `server.ts` to `'15mb'`. | Compiled and verified live uploads cleanly. |
| INT-04 | Upstream Gemini Cloud API | Sandbox `GEMINI_API_KEY` failed upstream with `401 UNAUTHENTICATED` for both `ai.fileSearchStores` and `ai.models.generateContent`. | Verified graceful fallback: `ragEngine.ts` records `geminiFileSearchSynced: false` with diagnostic note while serving local hybrid BM25 retrieval; `assistantOrchestrator.ts` returns `DETERMINISTIC_GROUNDED_FALLBACK` with full MCP & RAG evidence. | Verified live via `POST /api/rag/documents` and `POST /api/ai/copilot`. |

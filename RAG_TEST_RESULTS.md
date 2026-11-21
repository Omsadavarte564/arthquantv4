# RAG Verification & Test Results (`RAG_TEST_RESULTS.md`)

**Last Updated:** 2026-11-20 19:08 IST

---

## 1. Automated Unit & Integration Tests (`tests/ragMcp.test.ts` via `npm test`)

| Test Case | Result | Evidence Observed |
|---|---|---|
| Seed 5 separated collections (`INDIAN_MARKET`, `COMPANY_INFO`, `FINANCIAL_NEWS_RESEARCH`, `TRADING_KNOWLEDGE`, `REGULATORY_COMPLIANCE`) | **PASS** | 8 initial documents, 15 chunks loaded into `data/rag-knowledge-base.json` |
| Unsupported format & >10 MB size rejection | **PASS** | `malware.exe` rejected (`Unsupported document format`), >10 MB buffer rejected |
| Multi-format parsing (PDF, DOCX ZIP XML, HTML, MD/TXT) | **PASS** | Extracted clean text & `pageNumber`; stripped `<script>` tags |
| Prompt-injection sanitization | **PASS** | `<system>` -> `[filtered-tag]`, `ignore previous instructions` -> `[filtered-directive]` |
| SHA-256 deduplication | **PASS** | Duplicate content rejected with error / HTTP `409` |
| Versioning & superseding regulatory circular | **PASS** | `v1` marked `SUPERSEDED`; retrieval returns `v2` (`version: 2`) and excludes `v1` |
| Out-of-domain insufficient-evidence guard | **PASS** | Unrelated query returned `sufficientEvidence: false`, `citations: []` |
| Document deletion | **PASS** | `deleteRagDocument` removed doc & associated chunks cleanly |

## 2. Live HTTP API E2E Verification (`http://127.0.0.1:3000`)

| Endpoint | Request / Scenario | Observed Result |
|---|---|---|
| `GET /api/rag/documents` | List indexed knowledge base | `200 OK` (`8` docs, `15` chunks) |
| `POST /api/rag/documents` | `x-arthquant-role: TRADER` | `403 Forbidden` (RBAC guard enforced) |
| `POST /api/rag/documents` | `x-arthquant-role: ADMIN` (new NSE margin rule) | `201 Created` (`version: 1`, local hybrid indexed; Gemini File Search skipped cleanly with `401` key notice) |
| `POST /api/rag/retrieve` | Query `"NSE upfront VaR margin peak penalty rule 2026"` | `200 OK`, `sufficientEvidence: true`, `confidenceScore: 1`, `E2E NSE Margin Penalty Circular` ranked #1 |
| `DELETE /api/rag/documents/:docId` | `x-arthquant-role: ADMIN` cleanup | `200 OK` |

## 3. Cloud File Search Store Status (`BLOCKED` in Container Sandbox)

- **Gemini `ai.fileSearchStores` & `gemini-embedding-2` Cloud Sync:** **NOT VERIFIED LIVE (`BLOCKED` by sandbox key)**. When tested against upstream Google API in this runtime, `GEMINI_API_KEY` returned `401 UNAUTHENTICATED ("API key not valid")`. Local hybrid BM25 + TF-IDF retrieval handled all indexing and citation queries seamlessly without crashing.

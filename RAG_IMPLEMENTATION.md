# ArthQuant RAG Implementation (`RAG_IMPLEMENTATION.md`)

**Last Updated:** 2026-11-20 19:08 IST

---

## 1. Core Modules

- **`server/rag/documentParser.ts`**
  - `parseDocumentBuffer(fileName, buffer, declaredMimeType)`: enforces 10 MB size cap (`MAX_DOCUMENT_BYTES`), validates extensions (`.pdf`, `.docx`, `.txt`, `.md`, `.markdown`, `.csv`, `.json`, `.html`, `.htm`), extracts page-aware text (`pages[]`), and calls `sanitizeUntrustedText`.
  - `validateSourceUrl(sourceUrl)`: accepts `https://`, `http://`, and `local://`.
- **`server/rag/seedKnowledgeBase.ts`**
  - Supplies `SEED_KNOWLEDGE_DOCUMENTS` (8 curated documents spanning all 5 collections).
- **`server/rag/ragEngine.ts`**
  - `ingestRagDocument(input)`: validates metadata & URL, hashes full text with SHA-256 (`409` on duplicates), supports `supersedeDocId` (sets prior doc `status: 'SUPERSEDED'` and increments `version`), creates overlapping chunks with `pageNumber`, builds BM25 term frequencies (+ optional `gemini-embedding-2` embeddings), attempts optional `ai.fileSearchStores` upload, and persists to `data/rag-knowledge-base.json`.
  - `listRagDocuments(filter)` / `getRagDocumentById(docId)` / `updateRagDocument(docId, patch)` / `deleteRagDocument(docId)`.
  - `classifyRagQuery(query)`: detects NSE symbols across `STOCK_UNIVERSE`, classifies target collections, and sets `prioritizeLatestRegulatory`.
  - `retrieveRagContext(query, options)`: scores chunks with BM25 (`k1=1.4, b=0.75`), query coverage, optional embedding cosine similarity, symbol boost (`+0.18`), classified collection boost (`+0.06`), and regulatory effective-date weighting; deduplicates `(docId, pageNumber)` and high-overlap snippets; enforces `minScore = 0.24`.

## 2. Express API Routes (`server.ts`)

| Method | Path | Role Guard | Behavior |
|---|---|---|---|
| `GET` | `/api/rag/documents` | Public/Trader | Lists indexed docs, collection counts, and total chunks (`q`, `collection`, `status`, `symbol`) |
| `GET` | `/api/rag/documents/:docId` | Public/Trader | Returns single document metadata and chunk list |
| `POST` | `/api/rag/documents` | `ADMIN` only (`403` if `TRADER`) | Ingests base64 file or text payload; `409` on duplicate hash |
| `PATCH` | `/api/rag/documents/:docId` | `ADMIN` only (`403` if `TRADER`) | Updates metadata, toggles `ACTIVE`/`ARCHIVED`, or uploads updated text (`version + 1`) |
| `DELETE` | `/api/rag/documents/:docId` | `ADMIN` only (`403` if `TRADER`) | Removes document & chunks locally and attempts remote File Search cleanup |
| `POST` | `/api/rag/retrieve` | Public/Trader | Executes retrieval and returns `RagRetrievalResult` with scored `citations[]` |

## 3. Frontend Administration (`src/views/RagMcpView.tsx`)

- **AI Knowledge Base** view provides:
  - Role selector (`ADMIN` / `TRADER`) demonstrating server-enforced RBAC.
  - Collection summary cards across all 5 collections with one-click filtering.
  - File upload (`FileReader` base64 for PDF/DOCX/TXT/MD/CSV/JSON/HTML) and direct Markdown/text paste form.
  - Live retrieval & citation tester.
  - Registry table showing status, version, indexing mode (`Hybrid Local` vs `+ FileSearch`), chunk/page counts, and Archive/Delete actions.

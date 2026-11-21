# ArthQuant RAG Architecture (`RAG_ARCHITECTURE.md`)

**Last Updated:** 2026-11-20 19:08 IST

---

## 1. Purpose & Design Goals

ArthQuant's Retrieval-Augmented Generation (RAG) layer provides verified, citation-backed institutional context for Indian equity research, exchange schedules, SEBI circulars, statutory intraday costs, and quantitative engine manuals—strictly separated from real-time/delayed price feeds and personal trading logs.

## 2. Dual-Engine Hybrid Architecture

```
Admin Upload (PDF/DOCX/TXT/MD/CSV/JSON/HTML, <= 10 MB)
   │
   ▼
[server/rag/documentParser.ts]
   ├─ Extension & size validation (.pdf, .docx, .txt, .md, .csv, .json, .html)
   ├─ Page-aware extraction (FlateDecode PDF streams, ZIP DOCX XML, HTML strip)
   └─ Prompt-injection sanitization (<system>, <assistant>, ignore previous instructions)
   │
   ▼
[server/rag/ragEngine.ts]
   ├─ SHA-256 content deduplication (HTTP 409 on duplicates)
   ├─ Document versioning & status lifecycle (ACTIVE -> SUPERSEDED -> ARCHIVED)
   ├─ Sentence/paragraph chunking (~680 chars, 120-char overlap, pageNumber preserved)
   ├─ Local Hybrid Index: BM25/TF-IDF + optional Gemini `gemini-embedding-2` vectors
   ├─ Isolated Persistent Store: `data/rag-knowledge-base.json`
   └─ Optional Cloud Sync: `ai.fileSearchStores` per collection (non-blocking fallback)
```

## 3. Five Separated Knowledge Collections

| Collection Key | Scope | Example Content |
|---|---|---|
| `INDIAN_MARKET` | NSE/BSE market structure | Session timings (`09:00–09:15`, `09:15–15:30`), 2026 holiday calendar, tick sizes |
| `COMPANY_INFO` | Company & sector research | Corporate drivers, sector sensitivities, equity risk profiles (`RELIANCE`, `INFY`) |
| `FINANCIAL_NEWS_RESEARCH` | Market costs & research briefs | FY 2025–26 NSE statutory charges (STT, Stamp Duty, Exchange Fee, SEBI, IPFT, GST) |
| `TRADING_KNOWLEDGE` | Quantitative manuals | Causal VWAP/RSI/ADX/ORB/Supertrend rules, anti-lookahead ML & backtest spec |
| `REGULATORY_COMPLIANCE` | SEBI & broker regulations | SEBI Feb 4, 2025 algo circular (`SEBI/HO/MIRSD/.../0000013`), static IP & broker API limits |

## 4. Separation & Isolation Guarantees

1. **Knowledge Base vs. Trading State Isolation:** Knowledge documents reside exclusively in `data/rag-knowledge-base.json`, completely separate from personal paper trading ledgers (`data/arthquant-state.json`) and audit trails (`data/mcp-audit-log.json`).
2. **Documents vs. Live Quotes Isolation:** Pure live/delayed market quote questions (`LIVE_MARKET` intent) route strictly to MCP market tools (`get_nse_stock_quote`, `get_technical_indicators`) and NEVER pull stale quotes from RAG documents.
3. **RBAC Isolation:** Document mutations (`POST`, `PATCH`, `DELETE /api/rag/documents`) require `x-arthquant-role: ADMIN`; ordinary `TRADER` requests receive `403 Forbidden`.
4. **Superseding & Confidence Gate:** `SUPERSEDED` and `ARCHIVED` documents are excluded from default retrieval so current regulatory rules win cleanly. Queries below `minScore` (`0.24`) return `sufficientEvidence: false` instead of fabricated citations.

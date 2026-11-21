# RAG & MCP Integration Deployment Guide (`INTEGRATION_DEPLOYMENT_GUIDE.md`)

**Last Updated:** 2026-11-20 19:08 IST

---

## 1. Environment Variables

Configure secrets strictly server-side (never prefix with `VITE_`):

- `GEMINI_API_KEY`: Billing/developer-enabled Gemini API key used server-side for `gemini-4-hydrogen` / `gemini-3.1-flash-lite` synthesis, optional `gemini-embedding-2` embeddings, and optional `ai.fileSearchStores` cloud sync.
- `MCP_AUTH_TOKEN` *(optional)*: Static server-side Bearer token (`>= 12` chars) protecting `/mcp`. If omitted, `server/mcp/mcpServer.ts` generates a cryptographically random 48-char hex ephemeral token at boot shared solely between the local Express `/mcp` middleware and server-side `mcpClientManager`.
- `PORT` *(default `3000`)*: Port used by Express and internal `http://127.0.0.1:${PORT}/mcp` client connection.

## 2. Persistence Files (`data/`)

- `data/rag-knowledge-base.json` — Isolated RAG document registry, chunk index, and collection store mapping (auto-seeded on first load).
- `data/mcp-audit-log.json` — Rolling 200-entry MCP invocation and access-denial audit trail.
- `data/arthquant-state.json` — Existing paper trading ledger, custom strategies, and risk config (kept isolated from RAG docs).

## 3. Verification Commands

```bash
npm run lint     # TypeScript strict typecheck (tsc --noEmit)
npm run build    # Vite production bundle
npm test         # Runs tests/quant.test.ts + tests/ragMcp.test.ts (12 tests)
npm start        # Production Express server (NODE_ENV=production tsx server.ts)
```

## 4. Operational Notes

- **Admin Uploads:** In the **AI Knowledge Base** UI, switch role to `ADMIN` to upload/archive/delete documents; leave as `TRADER` for read-only retrieval.
- **Safety Lock:** Live real-money broker order routing remains hard-locked (`liveTradingLocked: true`), and MCP exposes zero order-submission or risk-bypass tools.

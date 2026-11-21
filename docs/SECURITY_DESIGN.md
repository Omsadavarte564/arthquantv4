# Security Architecture (`SECURITY_DESIGN.md`)

1. **Zero Secret Exposure:** `GEMINI_API_KEY`, broker API keys, and ML service bearer tokens are read strictly on the Node.js server (`process.env`). Nothing sensitive enters Vite `VITE_*` variables, client bundles, or URL query strings.
2. **Prompt Injection Defense:** Any external news or market commentary passed to Gemini (`gemini-4-hydrogen`) is strictly delimited as untrusted data; Gemini never receives execution authority or tool-calling access to place orders.
3. **Order Idempotency & Deduplication:** Paper and broker adapter orders enforce unique `clientOrderId` tokens and deterministic Risk Gatekeeper checks before persistence.
4. **Input Validation & Rate Limiting:** Server-side Express routes validate numeric ranges (capital > 0, valid timeframes, known NSE symbols, finite SL/Target prices) and reject malformed payloads with explicit `400`/`403` errors.
5. **Immutable Audit Trail:** Every risk approval/rejection, kill-switch toggle, and paper execution is persisted atomically to disk.

# ArthQuant MCP Security & Governance (`MCP_SECURITY.md`)

**Last Updated:** 2026-11-20 19:08 IST

---

## 1. Authentication & Secret Isolation

- **Bearer Token Protection on `/mcp`:** Every HTTP request to `/mcp` is checked by `validateMcpBearerHeader` using constant-time `crypto.timingSafeEqual`. Missing or invalid Bearer tokens are rejected immediately with `401 Unauthorized` and logged as `DENIED` in `data/mcp-audit-log.json`.
- **Server-Side Token Management:** `getServerMcpBearerToken()` reads `process.env.MCP_AUTH_TOKEN` (if `>= 12` chars) or generates an ephemeral 48-char hex secret at server boot (`EPHEMERAL_SERVER_TOKEN`). Neither `MCP_AUTH_TOKEN` nor `GEMINI_API_KEY` is ever sent to the browser client (`src/`). UI endpoints (`/api/mcp/status`, `/api/mcp/test`, `/api/mcp/invoke`, `/api/ai/copilot`) proxy securely through the server-side `mcpClientManager`.

## 2. Permission Matrix & Rate Limiting

- **Tool Permission Matrix:** Each tool belongs to `PUBLIC_MARKET`, `RESEARCH_QUANT`, or `PORTFOLIO_READ`. `mcpClientManager.callMcpToolForUser(userId, allowedPermissions, toolName, args)` enforces permission intersection prior to invoking the MCP server and logs `DENIED` entries when insufficient permissions are supplied.
- **Sliding-Window Rate Limiter:** `checkMcpRateLimit(userId)` restricts callers to `60` MCP requests per `60`-second window (returning HTTP `429` if exceeded).

## 3. Input Validation, Timeouts & Output Sanitization

- **Zod Schema Enforcement:** All tool arguments are validated against strict `zod` schemas by `@modelcontextprotocol/sdk`'s `McpServer` prior to executing business logic; malformed inputs return structured JSON-RPC `isError: true` responses.
- **10-Second Execution Timeout:** Every tool execution is wrapped in `withTimeout(..., 10_000)` to prevent hung network/computation calls.
- **Output Scrubbing & Truncation:** `sanitizeOutput` redacts any Google API key patterns (`AIza...`) or Bearer tokens and caps serialized tool text at `32 KB`.

## 4. Audit Logging (`data/mcp-audit-log.json`)

Every MCP invocation, authentication rejection (`DENIED`), validation error, timeout (`TIMEOUT`), or runtime error (`ERROR`) appends a timestamped IST entry containing `id`, `timestampIst`, `toolName`, `userId`, `permissionLevel`, `status`, `durationMs`, and `summary`.

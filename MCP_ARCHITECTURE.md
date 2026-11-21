# ArthQuant MCP Architecture (`MCP_ARCHITECTURE.md`)

**Last Updated:** 2026-11-20 19:08 IST

---

## 1. Protocol & Transport Stack

ArthQuant implements the official `@modelcontextprotocol/sdk` (`v1.32.2`) using **Streamable HTTP** transport:

- **Server (`server/mcp/mcpServer.ts`)**:
  - `McpServer` (`arthquant-nse-quant-mcp` v`1.0.0`, protocol `2025-03-26`)
  - `StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` mounted on Express `/mcp`.
  - Stateless per-request `McpServer` + transport instantiation eliminates stale session `404` failures across dev-server restarts while supporting full MCP `initialize`, `tools/list`, and `tools/call` JSON-RPC 2.0 protocol flows.
- **Client (`server/mcp/mcpClient.ts`)**:
  - `ArthQuantMcpClientManager` manages a persistent server-side `@modelcontextprotocol/sdk/client/index.js` `Client` connected via `StreamableHTTPClientTransport` to `http://127.0.0.1:${PORT}/mcp` with Bearer token headers.
  - Automatically reconnects once on dropped transport/socket errors.

## 2. Backend Service Reuse Architecture

MCP tools **never duplicate quantitative or broker logic**. Every tool calls the verified backend engines directly:

```
Gemini + RAG + MCP Copilot / MCP Inspector
   │
   ▼  (HTTP POST /mcp + Authorization: Bearer <server-token>)
[StreamableHTTPServerTransport -> McpServer]
   ├─ Market Data      ──▶ nseUniverse.ts / publicMarketFeed.ts / nseDirectory.ts / validator.ts
   ├─ Quant & ML       ──▶ indicators.ts / regime.ts / signals.ts / mlEngine.ts
   ├─ Strategy & BT    ──▶ stateStore.ts / strategies.ts / backtester.ts
   ├─ Portfolio & Risk ──▶ stateStore.ts / riskEngine.ts (read-only simulation only)
   └─ Knowledge Search ──▶ rag/ragEngine.ts
```

## 3. Asynchronous Execution Pattern (`run_backtest`)

- Running `run_backtest` on `<= 5` stocks executes synchronously and returns full net-of-cost metrics immediately.
- Running `run_backtest` on `> 5` stocks spawns a bounded async job (`mode: "ASYNC_JOB"`, `jobId`, `status: "RUNNING"`), allowing non-blocking status polling via `get_backtest_status`.

# MCP Verification & Test Results (`MCP_TEST_RESULTS.md`)

**Last Updated:** 2026-11-20 19:08 IST

---

## 1. Automated MCP Protocol Tests (`tests/ragMcp.test.ts` via `npm test`)

All tests used the real `@modelcontextprotocol/sdk` `McpServer`, `StreamableHTTPServerTransport`, `Client`, and `StreamableHTTPClientTransport` over localhost HTTP—no mocked function-call stubs.

| Test Case | Result | Evidence Observed |
|---|---|---|
| Unauthenticated `POST /mcp` rejection | **PASS** | HTTP `401 Unauthorized` returned; `DENIED` entry logged |
| Streamable HTTP `initialize` + `listTools()` | **PASS** | Exactly `20` tools returned with Zod schemas |
| Real tool call (`get_nse_market_status`) | **PASS** | `liveTradingLocked: true`, `executionMode: "SIMULATED_PAPER_TRADING"` |
| Invalid Zod argument rejection (`check_order_risk` with `entryPrice: -100`) | **PASS** | `isError: true` returned before risk engine invocation |
| Valid risk simulation (`check_order_risk` for `RELIANCE`) | **PASS** | `orderExecuted: false`, `decision.verdict: "APPROVED"`, exact share sizing computed |
| Async multi-stock backtest (>5 symbols) + status polling | **PASS** | `run_backtest` returned `mode: "ASYNC_JOB"` + `jobId`; `get_backtest_status` transitioned to `COMPLETED` |
| Permission matrix isolation | **PASS** | `PUBLIC_MARKET`-only caller blocked from `get_paper_portfolio` (`Permission denied`) & audited |
| Disconnect & automatic reconnect recovery | **PASS** | After `disconnect()`, subsequent `callMcpToolForUser` reconnected & succeeded |
| Live-market vs RAG separation routing | **PASS** | `"What is INFY's current price and RSI today?"` -> `usedMcp: true`, `usedRag: false` |
| Combined Gemini + RAG + MCP routing | **PASS** | Combined `RELIANCE` query -> `usedMcp: true`, `usedRag: true`, citations + transparency tags returned |

## 2. Live HTTP Endpoint Verification (`http://127.0.0.1:3000`)

| Endpoint | Observed Result |
|---|---|
| `POST /mcp` (without Bearer header) | `401 Unauthorized` |
| `POST /api/mcp/test` | `200 OK`, `ok: true`, `toolCount: 20`, `latencyMs: 96` |
| `POST /api/mcp/invoke` (`get_nse_stock_quote` for `RELIANCE`) | `200 OK`, `dataMode: PUBLIC_DELAYED_NSE_FEED`, `ltp: 1377.5` |
| `POST /api/ai/copilot` (Combined `RELIANCE` query) | `200 OK`, `intent: COMBINED_RESEARCH`, `citations: 2`, `mcpTools: 6`, `modelUsed: DETERMINISTIC_GROUNDED_FALLBACK` (upstream Gemini key `401`) |
| `POST /api/ai/copilot` (Unrelated regulatory query) | `200 OK`, `sufficientEvidence: false`, `modelUsed: GUARDED_INSUFFICIENT_EVIDENCE` |

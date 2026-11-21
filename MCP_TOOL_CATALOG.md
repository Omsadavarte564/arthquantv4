# ArthQuant MCP Tool Catalog (`MCP_TOOL_CATALOG.md`)

**Last Updated:** 2026-11-20 19:08 IST

---

All **20 tools** are registered on `McpServer` with strict `zod` input validation schemas, 10-second execution timeouts, sanitized outputs, and persistent audit logging.

| # | Tool Name | Category | Permission Level | Parameters (`zod` Validated) |
|---|---|---|---|---|
| 1 | `get_nse_market_status` | `MARKET` | `PUBLIC_MARKET` | `{}` |
| 2 | `get_nse_stock_quote` | `MARKET` | `PUBLIC_MARKET` | `{ symbol: string(1..24) }` |
| 3 | `get_historical_candles` | `MARKET` | `PUBLIC_MARKET` | `{ symbol, timeframe?: 1m\|5m\|15m, limit?: 5..260, feed?: auto\|public\|research }` |
| 4 | `search_nse_stocks` | `MARKET` | `PUBLIC_MARKET` | `{ query?: string, scope?: clean\|all\|research, limit?: 1..50 }` |
| 5 | `get_market_overview` | `MARKET` | `PUBLIC_MARKET` | `{ timeframe?: 1m\|5m\|15m }` |
| 6 | `scan_nse_stocks` | `AI_ANALYSIS` | `RESEARCH_QUANT` | `{ timeframe?, sector?, regime?, signal?, minRvol?, limit?: 1..24 }` |
| 7 | `get_technical_indicators` | `AI_ANALYSIS` | `RESEARCH_QUANT` | `{ symbol, timeframe?: 1m\|5m\|15m }` |
| 8 | `get_ai_trading_signals` | `AI_ANALYSIS` | `RESEARCH_QUANT` | `{ timeframe?, symbol?, actionableOnly? }` |
| 9 | `evaluate_walk_forward_ml` | `AI_ANALYSIS` | `RESEARCH_QUANT` | `{ symbol, timeframe?, threshold?: 0.5..0.8 }` |
| 10 | `explain_trading_signal` | `AI_ANALYSIS` | `RESEARCH_QUANT` | `{ symbol, timeframe? }` |
| 11 | `list_strategies` | `STRATEGY_BACKTEST` | `RESEARCH_QUANT` | `{ category?, enabledOnly? }` |
| 12 | `get_strategy_rules` | `STRATEGY_BACKTEST` | `RESEARCH_QUANT` | `{ strategyId }` |
| 13 | `run_backtest` | `STRATEGY_BACKTEST` | `RESEARCH_QUANT` | `{ strategyId?, symbols?: string[<=24], timeframe?, useOutOfSampleOnly? }` |
| 14 | `get_backtest_status` | `STRATEGY_BACKTEST` | `RESEARCH_QUANT` | `{ jobId }` |
| 15 | `get_backtest_history` | `STRATEGY_BACKTEST` | `RESEARCH_QUANT` | `{ limit?: 1..25 }` |
| 16 | `get_paper_portfolio` | `PORTFOLIO_RISK` | `PORTFOLIO_READ` | `{}` |
| 17 | `get_trade_journal` | `PORTFOLIO_RISK` | `PORTFOLIO_READ` | `{ limit?: 1..50 }` |
| 18 | `get_risk_dashboard` | `PORTFOLIO_RISK` | `PORTFOLIO_READ` | `{}` |
| 19 | `check_order_risk` | `PORTFOLIO_RISK` | `PORTFOLIO_READ` | `{ symbol, side: BUY\|SELL, entryPrice > 0, stopLoss > 0, target > 0, requestedQty? }` |
| 20 | `search_rag_knowledge_base` | `AI_ANALYSIS` | `PUBLIC_MARKET` | `{ query: string(2..500), collection?, symbol?, topK?: 1..8 }` |

## Explicitly Prohibited Capabilities (Never Registered)

- No live broker order placement tool
- No risk-gatekeeper bypass or limit-lowering tool
- No kill-switch disable tool
- No environment/API secret inspection tool

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  BacktestConfig,
  BacktestResult,
  McpAuditLogEntry,
  McpPermissionLevel,
  McpToolMetadata,
  RagCollection,
  Timeframe,
} from '../../src/types/trading.ts';
import { findNseDirectoryEntry, queryNseDirectory } from '../data/nseDirectory.ts';
import {
  getNseMarketClockStatus,
  getResearchCandles,
  isValidSymbol,
  STOCK_MAP,
} from '../data/nseUniverse.ts';
import { fetchPublicNseCandles } from '../data/publicMarketFeed.ts';
import { validateCandles } from '../data/validator.ts';
import { runBacktest } from '../quant/backtester.ts';
import { computeIndicators } from '../quant/indicators.ts';
import { trainAndEvaluateWalkForward } from '../quant/mlEngine.ts';
import { classifyRegime } from '../quant/regime.ts';
import { evaluateOrderRisk, formatNowIst } from '../quant/riskEngine.ts';
import { computeMarketSnapshot } from '../quant/signals.ts';
import { retrieveRagContext } from '../rag/ragEngine.ts';
import {
  getAllStrategies,
  loadState,
  recalculateAccountTotals,
  saveState,
} from '../storage/stateStore.ts';

export const MCP_SERVER_NAME = 'arthquant-nse-quant-mcp';
export const MCP_SERVER_VERSION = '1.0.0';
export const MCP_PROTOCOL_VERSION = '2025-03-26';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'mcp-audit-log.json');

// Server-side Bearer token (never exposed to browser bundle)
const EPHEMERAL_SERVER_TOKEN = crypto.randomBytes(24).toString('hex');

export function getServerMcpBearerToken(): string {
  const configured = process.env.MCP_AUTH_TOKEN?.trim();
  return configured && configured.length >= 12 ? configured : EPHEMERAL_SERVER_TOKEN;
}

export function isMcpAuthConfigured(): boolean {
  return getServerMcpBearerToken().length >= 12;
}

export function validateMcpBearerHeader(authHeader: string | undefined): boolean {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const provided = authHeader.slice(7).trim();
  const expected = getServerMcpBearerToken();
  if (!provided || provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Rate limiter: sliding 60s window per userId
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_CALLS = 60;
const rateBuckets = new Map<string, number[]>();

export function checkMcpRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const recent = (rateBuckets.get(userId) || []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_CALLS) {
    rateBuckets.set(userId, recent);
    return { allowed: false, remaining: 0 };
  }
  recent.push(now);
  rateBuckets.set(userId, recent);
  return { allowed: true, remaining: RATE_LIMIT_MAX_CALLS - recent.length };
}

// Asynchronous backtest job registry
interface AsyncBacktestJob {
  jobId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  createdAtIst: string;
  strategyId: string;
  symbolsCount: number;
  result?: BacktestResult;
  error?: string;
}
const asyncBacktestJobs = new Map<string, AsyncBacktestJob>();

// Persistent audit log
let auditCache: McpAuditLogEntry[] | null = null;

function loadAuditLogs(): McpAuditLogEntry[] {
  if (auditCache) return auditCache;
  try {
    if (fs.existsSync(AUDIT_LOG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(AUDIT_LOG_FILE, 'utf-8'));
      if (Array.isArray(parsed)) {
        auditCache = parsed;
        return parsed;
      }
    }
  } catch {
    // ignore corrupt audit file
  }
  auditCache = [];
  return auditCache;
}

export function appendMcpAuditLog(entry: McpAuditLogEntry): void {
  const logs = loadAuditLogs();
  logs.unshift(entry);
  if (logs.length > 200) logs.length = 200;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8');
  } catch {
    // ignore write issues in read-only test scenarios
  }
}

export function getRecentMcpAuditLogs(limit = 30): McpAuditLogEntry[] {
  return loadAuditLogs().slice(0, limit);
}

export function getToolPermissionMatrix(): Record<string, McpPermissionLevel> {
  const map: Record<string, McpPermissionLevel> = {};
  for (const t of MCP_TOOLS_CATALOG) {
    map[t.name] = t.permissionLevel;
  }
  return map;
}

export const MCP_TOOLS_CATALOG: McpToolMetadata[] = [
  {
    name: 'get_nse_market_status',
    title: 'NSE Market Clock & Feed Mode',
    description: 'Returns IST market open/closed/pre-open status, holiday reason, and active data mode.',
    permissionLevel: 'PUBLIC_MARKET',
    category: 'MARKET',
    inputSchemaSummary: '{}',
  },
  {
    name: 'get_nse_stock_quote',
    title: 'NSE Stock Quote (Public/Research)',
    description: 'Fetches NSE quote with explicit feed classification (public delayed .NS or historical research dataset).',
    permissionLevel: 'PUBLIC_MARKET',
    category: 'MARKET',
    inputSchemaSummary: '{ symbol: string }',
  },
  {
    name: 'get_historical_candles',
    title: 'Validated OHLCV Candles',
    description: 'Returns validated intraday OHLCV candles for an NSE symbol and timeframe.',
    permissionLevel: 'PUBLIC_MARKET',
    category: 'MARKET',
    inputSchemaSummary: '{ symbol: string, timeframe?: 1m|5m|15m, limit?: number, feed?: auto|public|research }',
  },
  {
    name: 'search_nse_stocks',
    title: 'Search 3,100+ NSE Directory',
    description: 'Queries the synced NSE cash equity master directory by symbol, name, or sector.',
    permissionLevel: 'PUBLIC_MARKET',
    category: 'MARKET',
    inputSchemaSummary: '{ query?: string, scope?: clean|all|research, limit?: number }',
  },
  {
    name: 'get_market_overview',
    title: 'Market Overview & Sector Breadth',
    description: 'Returns NIFTY/BANKNIFTY/SENSEX levels, advance/decline breadth, realized vol, and sector leaders.',
    permissionLevel: 'PUBLIC_MARKET',
    category: 'MARKET',
    inputSchemaSummary: '{ timeframe?: 1m|5m|15m }',
  },
  {
    name: 'scan_nse_stocks',
    title: 'Quantitative Multi-Factor Stock Scanner',
    description: 'Filters NSE universe by sector, regime, signal direction, and minimum relative volume.',
    permissionLevel: 'RESEARCH_QUANT',
    category: 'AI_ANALYSIS',
    inputSchemaSummary: '{ timeframe?: 1m|5m|15m, sector?: string, regime?: string, signal?: string, minRvol?: number, limit?: number }',
  },
  {
    name: 'get_technical_indicators',
    title: 'Causal Technical Indicators & Regime',
    description: 'Computes causal EMA, RSI(14), ADX(14), VWAP, ATR(14), Supertrend, BB, ORB, and market regime.',
    permissionLevel: 'RESEARCH_QUANT',
    category: 'AI_ANALYSIS',
    inputSchemaSummary: '{ symbol: string, timeframe?: 1m|5m|15m }',
  },
  {
    name: 'get_ai_trading_signals',
    title: 'Calibrated Intraday AI Signals',
    description: 'Returns causal signals with entry/SL/target levels, calibrated probability, and Wilson 95% CI.',
    permissionLevel: 'RESEARCH_QUANT',
    category: 'AI_ANALYSIS',
    inputSchemaSummary: '{ timeframe?: 1m|5m|15m, symbol?: string, actionableOnly?: boolean }',
  },
  {
    name: 'evaluate_walk_forward_ml',
    title: 'Walk-Forward ML Out-of-Sample Evaluation',
    description: 'Runs chronological train/embargo/val/OOS walk-forward logistic + Platt model evaluation.',
    permissionLevel: 'RESEARCH_QUANT',
    category: 'AI_ANALYSIS',
    inputSchemaSummary: '{ symbol: string, timeframe?: 1m|5m|15m, threshold?: number }',
  },
  {
    name: 'explain_trading_signal',
    title: 'Quantitative Signal Thesis Breakdown',
    description: 'Explains active signal triggers, invalidation SL level, regime fit, and risk/reward for a symbol.',
    permissionLevel: 'RESEARCH_QUANT',
    category: 'AI_ANALYSIS',
    inputSchemaSummary: '{ symbol: string, timeframe?: 1m|5m|15m }',
  },
  {
    name: 'list_strategies',
    title: 'List Quantitative Strategies',
    description: 'Lists built-in and custom intraday strategies with enabled status and category.',
    permissionLevel: 'RESEARCH_QUANT',
    category: 'STRATEGY_BACKTEST',
    inputSchemaSummary: '{ category?: string, enabledOnly?: boolean }',
  },
  {
    name: 'get_strategy_rules',
    title: 'Inspect Strategy Rules & Stops',
    description: 'Returns entry rule conditions, allowed regimes, and ATR stop/target parameters for a strategy.',
    permissionLevel: 'RESEARCH_QUANT',
    category: 'STRATEGY_BACKTEST',
    inputSchemaSummary: '{ strategyId: string }',
  },
  {
    name: 'run_backtest',
    title: 'Run No-Lookahead Strategy Backtest',
    description: 'Executes next-bar open backtest with NSE statutory charges (async job if >5 symbols).',
    permissionLevel: 'RESEARCH_QUANT',
    category: 'STRATEGY_BACKTEST',
    inputSchemaSummary: '{ strategyId?: string, symbols?: string[], timeframe?: 1m|5m|15m, useOutOfSampleOnly?: boolean }',
  },
  {
    name: 'get_backtest_status',
    title: 'Get Async Backtest Job Status',
    description: 'Checks status and metrics of a running or completed asynchronous backtest job.',
    permissionLevel: 'RESEARCH_QUANT',
    category: 'STRATEGY_BACKTEST',
    inputSchemaSummary: '{ jobId: string }',
  },
  {
    name: 'get_backtest_history',
    title: 'Backtest History & Metrics',
    description: 'Returns recent persisted backtest runs with Sharpe, Sortino, MaxDD, and net P&L.',
    permissionLevel: 'RESEARCH_QUANT',
    category: 'STRATEGY_BACKTEST',
    inputSchemaSummary: '{ limit?: number }',
  },
  {
    name: 'get_paper_portfolio',
    title: 'Read-Only Paper Portfolio Ledger',
    description: 'Returns simulated paper account equity, margin, open positions, and closed trades (live locked).',
    permissionLevel: 'PORTFOLIO_READ',
    category: 'PORTFOLIO_RISK',
    inputSchemaSummary: '{}',
  },
  {
    name: 'get_trade_journal',
    title: 'Read-Only Trade & Risk Journal',
    description: 'Returns recent simulated execution and deterministic risk-check journal entries.',
    permissionLevel: 'PORTFOLIO_READ',
    category: 'PORTFOLIO_RISK',
    inputSchemaSummary: '{ limit?: number }',
  },
  {
    name: 'get_risk_dashboard',
    title: 'Risk Limits & Kill Switch Status',
    description: 'Returns read-only risk parameters, kill switch state, and recent risk gatekeeper audit logs.',
    permissionLevel: 'PORTFOLIO_READ',
    category: 'PORTFOLIO_RISK',
    inputSchemaSummary: '{}',
  },
  {
    name: 'check_order_risk',
    title: 'Pre-Trade Risk Gatekeeper Simulation',
    description: 'Simulates 9-rule deterministic risk validation and position sizing without placing an order.',
    permissionLevel: 'PORTFOLIO_READ',
    category: 'PORTFOLIO_RISK',
    inputSchemaSummary: '{ symbol: string, side: BUY|SELL, entryPrice: number, stopLoss: number, target: number, requestedQty?: number }',
  },
  {
    name: 'search_rag_knowledge_base',
    title: 'Search Trading & SEBI Knowledge Base',
    description: 'Retrieves grounded document excerpts with citations from the 5 separated RAG collections.',
    permissionLevel: 'PUBLIC_MARKET',
    category: 'AI_ANALYSIS',
    inputSchemaSummary: '{ query: string, collection?: RagCollection, symbol?: string, topK?: number }',
  },
];

function sanitizeOutput(payload: unknown): string {
  const json = JSON.stringify(payload, null, 2);
  // Defense-in-depth: scrub accidental secret strings if any ever existed
  const scrubbed = json
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_KEY]')
    .replace(getServerMcpBearerToken(), '[REDACTED_TOKEN]');
  return scrubbed.length > 32000 ? `${scrubbed.slice(0, 32000)}\n...[truncated]` : scrubbed;
}

async function withTimeout<T>(promise: Promise<T>, ms = 10_000, label = 'MCP tool'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function asToolText(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: sanitizeOutput(data) }],
  };
}

function asToolError(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
  };
}

function parseTf(tf?: string): Timeframe {
  if (tf === '1m' || tf === '5m' || tf === '15m') return tf;
  return '5m';
}

export function createArthQuantMcpServer(): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  // Helper wrapper for audit + timeout + error safety
  const wrapTool = <TArgs>(
    toolName: string,
    permissionLevel: McpPermissionLevel,
    fn: (args: TArgs) => Promise<unknown> | unknown
  ) => {
    return async (args: TArgs) => {
      const start = Date.now();
      try {
        const result = await withTimeout(Promise.resolve(fn(args)), 10_000, toolName);
        appendMcpAuditLog({
          id: crypto.randomUUID().slice(0, 12),
          timestampIst: formatNowIst(),
          toolName,
          userId: 'mcp-protocol-session',
          permissionLevel,
          status: 'SUCCESS',
          durationMs: Date.now() - start,
          summary: `Executed ${toolName} successfully`,
        });
        return asToolText(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isTimeout = msg.includes('timed out');
        appendMcpAuditLog({
          id: crypto.randomUUID().slice(0, 12),
          timestampIst: formatNowIst(),
          toolName,
          userId: 'mcp-protocol-session',
          permissionLevel,
          status: isTimeout ? 'TIMEOUT' : 'ERROR',
          durationMs: Date.now() - start,
          summary: msg.slice(0, 160),
        });
        return asToolError(msg);
      }
    };
  };

  // 1. get_nse_market_status
  server.registerTool(
    'get_nse_market_status',
    {
      title: 'NSE Market Clock & Feed Status',
      description: 'Returns IST clock, NSE session status (OPEN, PRE_OPEN, MARKET_CLOSED), and live execution lock state.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrapTool('get_nse_market_status', 'PUBLIC_MARKET', () => {
      const clock = getNseMarketClockStatus();
      return {
        ...clock,
        dataMode: 'HISTORICAL_RESEARCH_DATASET',
        executionMode: 'SIMULATED_PAPER_TRADING',
        liveTradingLocked: true,
      };
    })
  );

  // 2. get_nse_stock_quote
  server.registerTool(
    'get_nse_stock_quote',
    {
      title: 'NSE Stock Quote',
      description: 'Fetches NSE stock quote from public .NS delayed feed with fallback to historical research dataset.',
      inputSchema: {
        symbol: z.string().min(1).max(24).describe('NSE symbol, e.g., RELIANCE, INFY, TCS'),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('get_nse_stock_quote', 'PUBLIC_MARKET', async ({ symbol }) => {
      const sym = symbol.toUpperCase().trim();
      const inResearch = isValidSymbol(sym);
      const dirEntry = inResearch ? null : await findNseDirectoryEntry(sym);
      if (!inResearch && !dirEntry) {
        throw new Error(`Unknown NSE symbol '${sym}'.`);
      }
      try {
        const pub = await fetchPublicNseCandles(sym, '5m');
        return {
          symbol: sym,
          name: STOCK_MAP.get(sym)?.name ?? dirEntry?.name ?? sym,
          dataMode: 'PUBLIC_DELAYED_NSE_FEED',
          quote: pub.quote,
        };
      } catch {
        if (!inResearch) {
          throw new Error(`Public delayed quote unavailable for '${sym}' and symbol has no local research bars.`);
        }
        const candles = getResearchCandles(sym, '5m');
        const last = candles[candles.length - 1];
        const firstToday = candles.find((c) => c.sessionDate === last.sessionDate) ?? last;
        return {
          symbol: sym,
          name: STOCK_MAP.get(sym)?.name ?? sym,
          dataMode: 'HISTORICAL_RESEARCH_DATASET',
          quote: {
            symbol: sym,
            ltp: last.close,
            previousClose: firstToday.open,
            changePct: Number((((last.close - firstToday.open) / firstToday.open) * 100).toFixed(2)),
            dayHigh: Math.max(...candles.filter((c) => c.sessionDate === last.sessionDate).map((c) => c.high)),
            dayLow: Math.min(...candles.filter((c) => c.sessionDate === last.sessionDate).map((c) => c.low)),
            volume: candles.filter((c) => c.sessionDate === last.sessionDate).reduce((s, c) => s + c.volume, 0),
            lastBarIst: last.istLabel,
            sourceLabel: 'NSE Historical Research Dataset (Offline Replay)',
          },
        };
      }
    })
  );

  // 3. get_historical_candles
  server.registerTool(
    'get_historical_candles',
    {
      title: 'Validated OHLCV Candles',
      description: 'Retrieves validated intraday OHLCV bars for an NSE symbol.',
      inputSchema: {
        symbol: z.string().min(1).max(24),
        timeframe: z.enum(['1m', '5m', '15m']).optional(),
        limit: z.number().int().min(5).max(260).optional(),
        feed: z.enum(['auto', 'public', 'research']).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('get_historical_candles', 'PUBLIC_MARKET', async ({ symbol, timeframe, limit, feed }) => {
      const sym = symbol.toUpperCase().trim();
      const tf = parseTf(timeframe);
      const stepSec = tf === '1m' ? 60 : tf === '15m' ? 900 : 300;
      const inResearch = isValidSymbol(sym);
      const dirEntry = inResearch ? null : await findNseDirectoryEntry(sym);
      if (!inResearch && !dirEntry) throw new Error(`Unknown NSE symbol '${sym}'.`);

      if (feed === 'public' || !inResearch) {
        const pub = await fetchPublicNseCandles(sym, tf);
        const { cleaned, report } = validateCandles(pub.candles, stepSec);
        return {
          symbol: sym,
          timeframe: tf,
          dataMode: 'PUBLIC_DELAYED_NSE_FEED',
          validation: report,
          candles: cleaned.slice(-(limit || 40)),
        };
      }

      const { cleaned, report } = validateCandles(getResearchCandles(sym, tf), stepSec);
      return {
        symbol: sym,
        timeframe: tf,
        dataMode: 'HISTORICAL_RESEARCH_DATASET',
        validation: report,
        candles: cleaned.slice(-(limit || 40)),
      };
    })
  );

  // 4. search_nse_stocks
  server.registerTool(
    'search_nse_stocks',
    {
      title: 'Search NSE Instrument Directory',
      description: 'Searches all 3,100+ NSE equity instruments by symbol, company name, or sector.',
      inputSchema: {
        query: z.string().max(60).optional(),
        scope: z.enum(['clean', 'all', 'research']).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('search_nse_stocks', 'PUBLIC_MARKET', async ({ query, scope, limit }) => {
      const state = loadState();
      const res = await queryNseDirectory({
        q: query,
        scope: scope || 'clean',
        page: 1,
        limit: limit || 15,
        watchlist: new Set(state.watchlist),
      });
      return {
        counts: res.counts,
        totalMatches: res.totalMatches,
        items: res.items,
      };
    })
  );

  // 5. get_market_overview
  server.registerTool(
    'get_market_overview',
    {
      title: 'Market Overview & Breadth',
      description: 'Returns benchmark indices, market breadth, sector performance, and realized volatility.',
      inputSchema: {
        timeframe: z.enum(['1m', '5m', '15m']).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('get_market_overview', 'PUBLIC_MARKET', ({ timeframe }) => {
      const state = loadState();
      const snap = computeMarketSnapshot(
        new Set(state.watchlist),
        getAllStrategies(state),
        state.paperAccount.simulationBarOffset,
        parseTf(timeframe)
      );
      return snap.overview;
    })
  );

  // 6. scan_nse_stocks
  server.registerTool(
    'scan_nse_stocks',
    {
      title: 'Quantitative Stock Scanner',
      description: 'Filters NSE research universe by sector, regime, signal direction, or relative volume.',
      inputSchema: {
        timeframe: z.enum(['1m', '5m', '15m']).optional(),
        sector: z.string().optional(),
        regime: z.string().optional(),
        signal: z.enum(['BUY', 'SELL', 'HOLD', 'NO_TRADE', 'ALL']).optional(),
        minRvol: z.number().min(0).max(20).optional(),
        limit: z.number().int().min(1).max(24).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('scan_nse_stocks', 'RESEARCH_QUANT', ({ timeframe, sector, regime, signal, minRvol, limit }) => {
      const state = loadState();
      const snap = computeMarketSnapshot(
        new Set(state.watchlist),
        getAllStrategies(state),
        state.paperAccount.simulationBarOffset,
        parseTf(timeframe)
      );
      let rows = snap.scanner;
      if (sector && sector !== 'ALL') rows = rows.filter((r) => r.sector.toLowerCase().includes(sector.toLowerCase()));
      if (regime && regime !== 'ALL') rows = rows.filter((r) => r.regime === regime);
      if (signal && signal !== 'ALL') rows = rows.filter((r) => r.signal === signal);
      if (minRvol && minRvol > 0) rows = rows.filter((r) => r.relVolume >= minRvol);
      return {
        dataMode: snap.overview.dataMode,
        totalMatched: rows.length,
        rows: rows.slice(0, limit || 12),
      };
    })
  );

  // 7. get_technical_indicators
  server.registerTool(
    'get_technical_indicators',
    {
      title: 'Technical Indicators & Regime',
      description: 'Returns causal technical indicators and current market regime for an NSE symbol.',
      inputSchema: {
        symbol: z.string().min(1).max(24),
        timeframe: z.enum(['1m', '5m', '15m']).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('get_technical_indicators', 'RESEARCH_QUANT', ({ symbol, timeframe }) => {
      const sym = symbol.toUpperCase().trim();
      if (!isValidSymbol(sym)) throw new Error(`Symbol '${sym}' is outside local quant research universe.`);
      const tf = parseTf(timeframe);
      const stepSec = tf === '1m' ? 60 : tf === '15m' ? 900 : 300;
      const { cleaned } = validateCandles(getResearchCandles(sym, tf), stepSec);
      const indicators = computeIndicators(cleaned);
      const lastBar = cleaned[cleaned.length - 1];
      const lastInd = indicators[indicators.length - 1];
      return {
        symbol: sym,
        timeframe: tf,
        istLabel: lastBar.istLabel,
        close: lastBar.close,
        regime: classifyRegime(lastBar, lastInd),
        indicators: lastInd,
      };
    })
  );

  // 8. get_ai_trading_signals
  server.registerTool(
    'get_ai_trading_signals',
    {
      title: 'AI Trading Signals',
      description: 'Returns calibrated causal trading signals with confidence intervals and SL/Targets.',
      inputSchema: {
        timeframe: z.enum(['1m', '5m', '15m']).optional(),
        symbol: z.string().optional(),
        actionableOnly: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('get_ai_trading_signals', 'RESEARCH_QUANT', ({ timeframe, symbol, actionableOnly }) => {
      const state = loadState();
      const snap = computeMarketSnapshot(
        new Set(state.watchlist),
        getAllStrategies(state),
        state.paperAccount.simulationBarOffset,
        parseTf(timeframe)
      );
      let list = snap.signals;
      if (symbol) {
        const s = symbol.toUpperCase().trim();
        list = list.filter((x) => x.symbol === s);
      }
      if (actionableOnly) {
        list = list.filter((x) => x.direction === 'BUY' || x.direction === 'SELL');
      }
      return {
        dataMode: snap.overview.dataMode,
        istTimestamp: snap.overview.istTimestamp,
        count: list.length,
        signals: list.slice(0, 15),
      };
    })
  );

  // 9. evaluate_walk_forward_ml
  server.registerTool(
    'evaluate_walk_forward_ml',
    {
      title: 'Walk-Forward ML Evaluation',
      description: 'Runs anti-leakage chronological walk-forward logistic + Platt model evaluation.',
      inputSchema: {
        symbol: z.string().min(1).max(24),
        timeframe: z.enum(['1m', '5m', '15m']).optional(),
        threshold: z.number().min(0.5).max(0.8).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('evaluate_walk_forward_ml', 'RESEARCH_QUANT', ({ symbol, timeframe, threshold }) => {
      const sym = symbol.toUpperCase().trim();
      if (!STOCK_MAP.has(sym)) throw new Error(`Unknown NSE equity symbol '${sym}'.`);
      const tf = parseTf(timeframe);
      const stepSec = tf === '1m' ? 60 : tf === '15m' ? 900 : 300;
      const { cleaned } = validateCandles(getResearchCandles(sym, tf), stepSec);
      const indicators = computeIndicators(cleaned);
      const { evaluation } = trainAndEvaluateWalkForward(sym, tf, cleaned, indicators, threshold ?? 0.62);
      return evaluation;
    })
  );

  // 10. explain_trading_signal
  server.registerTool(
    'explain_trading_signal',
    {
      title: 'Explain Trading Signal',
      description: 'Explains active signal triggers, invalidation levels, and regime fit for a stock.',
      inputSchema: {
        symbol: z.string().min(1).max(24),
        timeframe: z.enum(['1m', '5m', '15m']).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('explain_trading_signal', 'RESEARCH_QUANT', ({ symbol, timeframe }) => {
      const sym = symbol.toUpperCase().trim();
      const state = loadState();
      const snap = computeMarketSnapshot(
        new Set(state.watchlist),
        getAllStrategies(state),
        state.paperAccount.simulationBarOffset,
        parseTf(timeframe)
      );
      const sig = snap.signals.find((s) => s.symbol === sym);
      if (!sig) throw new Error(`No signal snapshot found for '${sym}'.`);
      return {
        symbol: sym,
        signal: sig,
        riskSummary: `Direction=${sig.direction}, Entry=₹${sig.entryPrice}, SL=₹${sig.stopLoss}, Target1=₹${sig.target1}, R:R=${sig.riskRewardRatio}:1, CalibratedProb=${(sig.estimatedProbability * 100).toFixed(1)}% (CI ${sig.confidenceLow}%–${sig.confidenceHigh}%).`,
      };
    })
  );

  // 11. list_strategies
  server.registerTool(
    'list_strategies',
    {
      title: 'List Quantitative Strategies',
      description: 'Lists built-in and custom trading strategies.',
      inputSchema: {
        category: z.string().optional(),
        enabledOnly: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('list_strategies', 'RESEARCH_QUANT', ({ category, enabledOnly }) => {
      const state = loadState();
      let strats = getAllStrategies(state);
      if (category) strats = strats.filter((s) => s.category === category.toUpperCase());
      if (enabledOnly) strats = strats.filter((s) => s.enabled);
      return {
        count: strats.length,
        strategies: strats.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          enabled: s.enabled,
          minProbThreshold: s.minProbThreshold,
          allowedRegimes: s.allowedRegimes,
          description: s.description,
        })),
      };
    })
  );

  // 12. get_strategy_rules
  server.registerTool(
    'get_strategy_rules',
    {
      title: 'Get Strategy Rules',
      description: 'Returns complete rule definitions and ATR stops for a strategy ID.',
      inputSchema: {
        strategyId: z.string().min(1),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('get_strategy_rules', 'RESEARCH_QUANT', ({ strategyId }) => {
      const state = loadState();
      const found = getAllStrategies(state).find((s) => s.id === strategyId);
      if (!found) throw new Error(`Strategy '${strategyId}' not found.`);
      return found;
    })
  );

  // 13. run_backtest
  server.registerTool(
    'run_backtest',
    {
      title: 'Run Strategy Backtest',
      description: 'Runs no-lookahead event-driven backtest (async job when >5 symbols).',
      inputSchema: {
        strategyId: z.string().optional(),
        symbols: z.array(z.string()).max(24).optional(),
        timeframe: z.enum(['1m', '5m', '15m']).optional(),
        useOutOfSampleOnly: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    wrapTool('run_backtest', 'RESEARCH_QUANT', ({ strategyId, symbols, timeframe, useOutOfSampleOnly }) => {
      const state = loadState();
      const allStrategies = getAllStrategies(state);
      const strategy = allStrategies.find((s) => s.id === strategyId) ?? allStrategies[0];
      const validSyms =
        symbols && symbols.length > 0
          ? symbols.map((s) => s.toUpperCase().trim()).filter((s) => STOCK_MAP.has(s))
          : ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'TATAMOTORS'];
      if (validSyms.length === 0) throw new Error('At least one valid NSE symbol is required.');

      const config: BacktestConfig = {
        symbols: validSyms,
        strategyId: strategy.id,
        timeframe: parseTf(timeframe),
        initialCapital: 1000000,
        riskPerTradePct: 1.0,
        brokerageFlatCap: 20,
        brokeragePct: 0.0003,
        slippageBps: 5,
        useOutOfSampleOnly: useOutOfSampleOnly ?? true,
      };

      if (validSyms.length > 5) {
        const jobId = `bt-${crypto.randomUUID().slice(0, 8)}`;
        const job: AsyncBacktestJob = {
          jobId,
          status: 'RUNNING',
          createdAtIst: formatNowIst(),
          strategyId: strategy.id,
          symbolsCount: validSyms.length,
        };
        asyncBacktestJobs.set(jobId, job);
        setTimeout(() => {
          try {
            const res = runBacktest(config, strategy);
            job.status = 'COMPLETED';
            job.result = res;
            const st = loadState();
            st.backtestHistory.unshift(res);
            if (st.backtestHistory.length > 25) st.backtestHistory.length = 25;
            saveState(st);
          } catch (e) {
            job.status = 'FAILED';
            job.error = e instanceof Error ? e.message : String(e);
          }
        }, 25);
        return {
          mode: 'ASYNC_JOB',
          jobId,
          status: 'RUNNING',
          message: `Backtest queued across ${validSyms.length} stocks. Poll get_backtest_status.`,
        };
      }

      const result = runBacktest(config, strategy);
      state.backtestHistory.unshift(result);
      if (state.backtestHistory.length > 25) state.backtestHistory.length = 25;
      saveState(state);

      return {
        mode: 'SYNC',
        id: result.id,
        strategyName: result.strategyName,
        dataMode: result.dataMode,
        totalTrades: result.totalTrades,
        winRatePct: result.winRatePct,
        winRateCI: result.winRateCI,
        totalNetProfit: result.totalNetProfit,
        netReturnPct: result.netReturnPct,
        profitFactor: result.profitFactor,
        maxDrawdownPct: result.maxDrawdownPct,
        sharpeRatio: result.sharpeRatio,
        totalCharges: result.totalCharges,
        validationNotice: result.validationNotice,
      };
    })
  );

  // 14. get_backtest_status
  server.registerTool(
    'get_backtest_status',
    {
      title: 'Backtest Async Job Status',
      description: 'Returns status and summary metrics for an async backtest job.',
      inputSchema: {
        jobId: z.string().min(1),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('get_backtest_status', 'RESEARCH_QUANT', ({ jobId }) => {
      const job = asyncBacktestJobs.get(jobId);
      if (!job) throw new Error(`Backtest job '${jobId}' not found.`);
      return {
        jobId: job.jobId,
        status: job.status,
        createdAtIst: job.createdAtIst,
        strategyId: job.strategyId,
        symbolsCount: job.symbolsCount,
        error: job.error,
        summary: job.result
          ? {
              totalTrades: job.result.totalTrades,
              winRatePct: job.result.winRatePct,
              totalNetProfit: job.result.totalNetProfit,
              profitFactor: job.result.profitFactor,
              maxDrawdownPct: job.result.maxDrawdownPct,
              sharpeRatio: job.result.sharpeRatio,
            }
          : undefined,
      };
    })
  );

  // 15. get_backtest_history
  server.registerTool(
    'get_backtest_history',
    {
      title: 'Backtest History',
      description: 'Lists recent saved backtest metrics.',
      inputSchema: {
        limit: z.number().int().min(1).max(25).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('get_backtest_history', 'RESEARCH_QUANT', ({ limit }) => {
      const state = loadState();
      return {
        count: state.backtestHistory.length,
        history: state.backtestHistory.slice(0, limit || 10).map((b) => ({
          id: b.id,
          createdAt: b.createdAt,
          strategyName: b.strategyName,
          timeframe: b.config.timeframe,
          symbolsCount: b.config.symbols.length,
          totalTrades: b.totalTrades,
          winRatePct: b.winRatePct,
          totalNetProfit: b.totalNetProfit,
          profitFactor: b.profitFactor,
          maxDrawdownPct: b.maxDrawdownPct,
          sharpeRatio: b.sharpeRatio,
        })),
      };
    })
  );

  // 16. get_paper_portfolio
  server.registerTool(
    'get_paper_portfolio',
    {
      title: 'Paper Portfolio Summary',
      description: 'Returns read-only simulated paper trading account balance, open positions, and recent closed trades.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrapTool('get_paper_portfolio', 'PORTFOLIO_READ', () => {
      const state = loadState();
      recalculateAccountTotals(state.paperAccount);
      return {
        executionMode: state.paperAccount.executionMode,
        liveTradingLocked: true,
        initialCapital: state.paperAccount.initialCapital,
        availableCapital: state.paperAccount.availableCapital,
        usedMargin: state.paperAccount.usedMargin,
        realizedPnlToday: state.paperAccount.realizedPnlToday,
        unrealizedPnl: state.paperAccount.unrealizedPnl,
        totalEquity: state.paperAccount.totalEquity,
        tradesToday: state.paperAccount.tradesToday,
        consecutiveLosses: state.paperAccount.consecutiveLosses,
        openPositions: state.paperAccount.positions,
        recentClosedTrades: state.paperAccount.closedTrades.slice(0, 10),
      };
    })
  );

  // 17. get_trade_journal
  server.registerTool(
    'get_trade_journal',
    {
      title: 'Simulated Trade Journal',
      description: 'Returns recent paper trading execution and risk-gatekeeper journal entries.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('get_trade_journal', 'PORTFOLIO_READ', ({ limit }) => {
      const state = loadState();
      return {
        entries: state.paperAccount.journal.slice(0, limit || 15),
      };
    })
  );

  // 18. get_risk_dashboard
  server.registerTool(
    'get_risk_dashboard',
    {
      title: 'Risk Engine Configuration & Audit Log',
      description: 'Returns deterministic risk thresholds, kill switch status, and recent risk audit log.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrapTool('get_risk_dashboard', 'PORTFOLIO_READ', () => {
      const state = loadState();
      return {
        liveTradingLocked: true,
        riskConfig: state.riskConfig,
        recentRiskDecisions: state.riskAuditLog.slice(0, 15),
      };
    })
  );

  // 19. check_order_risk
  server.registerTool(
    'check_order_risk',
    {
      title: 'Deterministic Pre-Trade Risk Simulation',
      description: 'Runs read-only 9-rule risk check and position sizing without submitting or executing an order.',
      inputSchema: {
        symbol: z.string().min(1).max(24),
        side: z.enum(['BUY', 'SELL']),
        entryPrice: z.number().positive(),
        stopLoss: z.number().positive(),
        target: z.number().positive(),
        requestedQty: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('check_order_risk', 'PORTFOLIO_READ', ({ symbol, side, entryPrice, stopLoss, target, requestedQty }) => {
      const state = loadState();
      recalculateAccountTotals(state.paperAccount);
      const decision = evaluateOrderRisk(
        {
          symbol: symbol.toUpperCase().trim(),
          side,
          entryPrice,
          stopLoss,
          target,
          requestedQty,
        },
        state.riskConfig,
        state.paperAccount
      );
      return {
        simulationOnly: true,
        orderExecuted: false,
        decision,
      };
    })
  );

  // 20. search_rag_knowledge_base
  server.registerTool(
    'search_rag_knowledge_base',
    {
      title: 'Search RAG Knowledge Base',
      description: 'Searches indexed Indian market rules, SEBI circulars, company filings, and technical docs with citations.',
      inputSchema: {
        query: z.string().min(2).max(500),
        collection: z
          .enum([
            'INDIAN_MARKET',
            'COMPANY_INFO',
            'FINANCIAL_NEWS_RESEARCH',
            'TRADING_KNOWLEDGE',
            'REGULATORY_COMPLIANCE',
          ])
          .optional(),
        symbol: z.string().optional(),
        topK: z.number().int().min(1).max(8).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrapTool('search_rag_knowledge_base', 'PUBLIC_MARKET', async ({ query, collection, symbol, topK }) => {
      return await retrieveRagContext(query, {
        collections: collection ? [collection as RagCollection] : undefined,
        symbol,
        topK: topK ?? 4,
      });
    })
  );

  return server;
}

export async function handleMcpHttpRequest(req: Request, res: Response): Promise<void> {
  // Enforce server-side Bearer authentication on every MCP endpoint call
  if (!validateMcpBearerHeader(req.headers.authorization)) {
    appendMcpAuditLog({
      id: crypto.randomUUID().slice(0, 12),
      timestampIst: formatNowIst(),
      toolName: 'mcp_auth_middleware',
      userId: req.ip || 'unknown',
      permissionLevel: 'ADMIN_RESTRICTED',
      status: 'DENIED',
      durationMs: 0,
      summary: 'Rejected unauthenticated or invalid Bearer token on /mcp endpoint',
    });
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized: Valid MCP Bearer token required.' },
      id: null,
    });
    return;
  }

  const userId = String(req.headers['x-mcp-user'] || 'arthquant-server-client');
  const rate = checkMcpRateLimit(userId);
  if (!rate.allowed) {
    res.status(429).json({
      jsonrpc: '2.0',
      error: { code: -32002, message: 'MCP rate limit exceeded (60 calls/min).' },
      id: null,
    });
    return;
  }

  if (req.method === 'GET') {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Stateless Streamable HTTP MCP server handles JSON-RPC via POST /mcp.' },
      id: null,
    });
    return;
  }

  const server = createArthQuantMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : 'Internal MCP transport error',
        },
        id: null,
      });
    }
  }
}

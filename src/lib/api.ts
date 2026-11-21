import {
  BacktestConfig,
  BacktestResult,
  BrokerAdapterInfo,
  Candle,
  CopilotQueryResponse,
  DataHealthStatus,
  HistoricalDatasetMetadata,
  IndicatorPoint,
  MarketOverviewResponse,
  McpIntegrationStatus,
  MlEvaluationResult,
  ModelFamily,
  MonitoringDashboardSummary,
  NseDirectoryResponse,
  PaperAccountState,
  PublicNseQuote,
  RagCollection,
  RagDocumentMetadata,
  RagDocumentStatus,
  RagRetrievalResult,
  RiskConfig,
  RiskDecision,
  ScannerRow,
  StockMetadata,
  StrategyConfig,
  Timeframe,
  TradingSignal,
} from '../types/trading';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    const errMsg = data?.error || data?.decision?.reasons?.join(' ') || `HTTP ${res.status}`;
    throw Object.assign(new Error(errMsg), { status: res.status, payload: data });
  }
  return data as T;
}

export const api = {
  getHealth: () =>
    requestJson<{
      status: string;
      dataMode: string;
      executionMode: string;
      liveTradingLocked: boolean;
      geminiConfigured: boolean;
      pythonMlServiceConfigured: boolean;
      universeCount: number;
      strategiesCount: number;
      istNow: string;
    }>('/api/health'),

  getDataHealth: (timeframe: Timeframe = '5m') =>
    requestJson<{
      dataMode: string;
      dataHealth: DataHealthStatus;
      universeCount: number;
      enforceLiveFreshnessApplied: boolean;
    }>(`/api/data/health?timeframe=${timeframe}`),

  getHistoricalManifest: () =>
    requestJson<{
      providers: {
        provider: string;
        configured: boolean;
        maxLookbackDays: number;
        note: string;
      }[];
      liquidPublicUniverse: string[];
      cachedCount: number;
      cachedSeries: HistoricalDatasetMetadata[];
      limitationNote: string;
    }>('/api/data/historical/manifest'),

  getMarketOverview: (timeframe: Timeframe = '5m') =>
    requestJson<{ overview: MarketOverviewResponse; universe: StockMetadata[] }>(
      `/api/market/overview?timeframe=${timeframe}`
    ),

  getCandles: (symbol: string, timeframe: Timeframe = '5m', feed: 'auto' | 'public' | 'research' = 'auto') =>
    requestJson<{
      symbol: string;
      name: string;
      sector: string;
      timeframe: Timeframe;
      dataMode: string;
      quote?: PublicNseQuote;
      validation: { valid: boolean; totalBars: number; issues: string[] };
      candles: Candle[];
      indicators: IndicatorPoint[];
    }>(`/api/market/candles/${encodeURIComponent(symbol)}?timeframe=${timeframe}&feed=${feed}`),

  getPublicQuote: (symbol: string) =>
    requestJson<{ symbol: string; name: string; quote: PublicNseQuote }>(
      `/api/market/public-quote/${encodeURIComponent(symbol)}`
    ),

  getScanner: (params: {
    timeframe?: Timeframe;
    sector?: string;
    regime?: string;
    signal?: string;
    search?: string;
    minRvol?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.timeframe) qs.set('timeframe', params.timeframe);
    if (params.sector) qs.set('sector', params.sector);
    if (params.regime) qs.set('regime', params.regime);
    if (params.signal) qs.set('signal', params.signal);
    if (params.search) qs.set('search', params.search);
    if (params.minRvol) qs.set('minRvol', String(params.minRvol));
    return requestJson<{ dataMode: string; count: number; rows: ScannerRow[] }>(
      `/api/scanner?${qs.toString()}`
    );
  },

  getNseDirectory: (params: {
    q?: string;
    scope?: 'clean' | 'all' | 'research';
    page?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.scope) qs.set('scope', params.scope);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    return requestJson<NseDirectoryResponse>(`/api/market/nse-directory?${qs.toString()}`);
  },

  syncNseDirectory: () =>
    requestJson<NseDirectoryResponse>('/api/market/nse-directory/sync', { method: 'POST' }),

  toggleWatchlist: (symbol: string, inWatchlist: boolean) =>
    inWatchlist
      ? requestJson<{ watchlist: string[] }>(`/api/watchlist/${encodeURIComponent(symbol)}`, {
          method: 'DELETE',
        })
      : requestJson<{ watchlist: string[] }>('/api/watchlist', {
          method: 'POST',
          body: JSON.stringify({ symbol }),
        }),

  getSignals: (timeframe: Timeframe = '5m') =>
    requestJson<{ dataMode: string; istTimestamp: string; signals: TradingSignal[] }>(
      `/api/signals?timeframe=${timeframe}`
    ),

  evaluateMl: (
    symbol: string,
    timeframe: Timeframe,
    threshold: number,
    dataset: 'research' | 'public' = 'research',
    modelFamily: ModelFamily = 'DUAL_LOGIT_PLATT',
    includeModelComparison = true
  ) =>
    requestJson<MlEvaluationResult>('/api/ml/evaluate', {
      method: 'POST',
      body: JSON.stringify({
        symbol,
        timeframe,
        threshold,
        dataset,
        modelFamily,
        includeModelComparison,
      }),
    }),

  getMonitoringSummary: () =>
    requestJson<MonitoringDashboardSummary>('/api/monitoring/summary'),

  resolveMonitoringPredictions: () =>
    requestJson<{ resolvedCount: number; summary: MonitoringDashboardSummary }>(
      '/api/monitoring/resolve',
      { method: 'POST' }
    ),

  rollbackModelVersion: (modelVersion: string) =>
    requestJson<{ activeModelVersion: string; summary: MonitoringDashboardSummary }>(
      '/api/monitoring/rollback',
      { method: 'POST', body: JSON.stringify({ modelVersion }) }
    ),

  getStrategies: () => requestJson<{ strategies: StrategyConfig[] }>('/api/strategies'),

  createStrategy: (payload: Partial<StrategyConfig>) =>
    requestJson<{ strategy: StrategyConfig; strategies: StrategyConfig[] }>('/api/strategies', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  toggleStrategy: (id: string) =>
    requestJson<{ strategies: StrategyConfig[] }>(`/api/strategies/${encodeURIComponent(id)}/toggle`, {
      method: 'PATCH',
    }),

  runBacktest: (config: BacktestConfig) =>
    requestJson<BacktestResult>('/api/backtest/run', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  getBacktestHistory: () => requestJson<{ history: BacktestResult[] }>('/api/backtest/history'),

  getPaperState: () =>
    requestJson<{ account: PaperAccountState; riskConfig: RiskConfig }>('/api/paper/state'),

  submitPaperOrder: (payload: {
    clientOrderId?: string;
    predictionId?: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT';
    quantity?: number;
    limitPrice?: number;
    stopLoss: number;
    target: number;
    strategyName: string;
    regime: string;
  }) =>
    requestJson<{ decision: RiskDecision; order: unknown; account: PaperAccountState }>(
      '/api/paper/order',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  closePaperPosition: (symbol: string) =>
    requestJson<{ account: PaperAccountState }>(`/api/paper/close/${encodeURIComponent(symbol)}`, {
      method: 'POST',
    }),

  stepPaperSim: () =>
    requestJson<{ account: PaperAccountState }>('/api/paper/step', { method: 'POST' }),

  resetPaperAccount: (initialCapital = 1000000) =>
    requestJson<{ account: PaperAccountState }>('/api/paper/reset', {
      method: 'POST',
      body: JSON.stringify({ initialCapital }),
    }),

  markAlertsRead: () => requestJson('/api/alerts/read-all', { method: 'POST' }),

  getRiskState: () =>
    requestJson<{
      riskConfig: RiskConfig;
      auditLog: RiskDecision[];
      accountSummary: {
        totalEquity: number;
        realizedPnlToday: number;
        unrealizedPnl: number;
        usedMargin: number;
        openPositions: number;
        tradesToday: number;
        consecutiveLosses: number;
      };
    }>('/api/risk/state'),

  updateRiskConfig: (config: Partial<RiskConfig>) =>
    requestJson<{ riskConfig: RiskConfig }>('/api/risk/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  toggleKillSwitch: (active: boolean) =>
    requestJson<{ killSwitchActive: boolean; account: PaperAccountState }>(
      '/api/risk/kill-switch',
      { method: 'POST', body: JSON.stringify({ active }) }
    ),

  getBrokers: () =>
    requestJson<{
      liveTradingLocked: boolean;
      sebiCircularRef: string;
      adapters: BrokerAdapterInfo[];
    }>('/api/brokers'),

  explainSignal: (signal: TradingSignal) =>
    requestJson<{ available: boolean; explanation?: string; error?: string }>(
      '/api/ai/explain-signal',
      { method: 'POST', body: JSON.stringify({ signal }) }
    ),

  generateMarketReport: (timeframe: Timeframe = '5m') =>
    requestJson<{ available: boolean; report?: string; error?: string }>(
      '/api/ai/market-report',
      { method: 'POST', body: JSON.stringify({ timeframe }) }
    ),

  generateStockSummary: (symbol: string) =>
    requestJson<{ available: boolean; summary?: string; error?: string }>(
      '/api/ai/stock-summary',
      { method: 'POST', body: JSON.stringify({ symbol }) }
    ),

  askCopilot: (query: string, symbol?: string) =>
    requestJson<CopilotQueryResponse>('/api/ai/copilot', {
      method: 'POST',
      body: JSON.stringify({ query, symbol }),
    }),

  getRagDocuments: (params?: {
    q?: string;
    collection?: RagCollection | 'ALL';
    status?: RagDocumentStatus | 'ALL';
    symbol?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.collection) qs.set('collection', params.collection);
    if (params?.status) qs.set('status', params.status);
    if (params?.symbol) qs.set('symbol', params.symbol);
    return requestJson<{
      documents: RagDocumentMetadata[];
      countsByCollection: Record<RagCollection, number>;
      totalChunks: number;
    }>(`/api/rag/documents?${qs.toString()}`);
  },

  uploadRagDocument: (
    payload: {
      fileName: string;
      contentBase64?: string;
      contentText?: string;
      mimeType?: string;
      title: string;
      sourceUrl: string;
      publisher: string;
      category: string;
      collection: RagCollection;
      publicationDate: string;
      effectiveDate?: string;
      exchangeOrCompany: string;
      relatedSymbol?: string;
      supersedeDocId?: string;
    },
    role: 'ADMIN' | 'TRADER' = 'ADMIN'
  ) =>
    requestJson<{ document: RagDocumentMetadata }>('/api/rag/documents', {
      method: 'POST',
      headers: { 'x-arthquant-role': role },
      body: JSON.stringify(payload),
    }),

  updateRagDocument: (
    docId: string,
    patch: {
      title?: string;
      status?: RagDocumentStatus;
      category?: string;
      effectiveDate?: string;
      newContent?: string;
    },
    role: 'ADMIN' | 'TRADER' = 'ADMIN'
  ) =>
    requestJson<{ document: RagDocumentMetadata }>(`/api/rag/documents/${encodeURIComponent(docId)}`, {
      method: 'PATCH',
      headers: { 'x-arthquant-role': role },
      body: JSON.stringify(patch),
    }),

  deleteRagDocument: (docId: string, role: 'ADMIN' | 'TRADER' = 'ADMIN') =>
    requestJson<{ deleted: boolean; docId: string }>(
      `/api/rag/documents/${encodeURIComponent(docId)}`,
      {
        method: 'DELETE',
        headers: { 'x-arthquant-role': role },
      }
    ),

  retrieveRag: (query: string, collection?: RagCollection) =>
    requestJson<RagRetrievalResult>('/api/rag/retrieve', {
      method: 'POST',
      body: JSON.stringify({
        query,
        collections: collection ? [collection] : undefined,
        topK: 5,
      }),
    }),

  getMcpStatus: () => requestJson<McpIntegrationStatus>('/api/mcp/status'),

  testMcpConnection: () =>
    requestJson<{
      ok: boolean;
      latencyMs: number;
      toolCount: number;
      sampleMarketStatus: unknown;
      error?: string;
      status: McpIntegrationStatus;
    }>('/api/mcp/test', { method: 'POST' }),

  invokeMcpTool: (toolName: string, args: Record<string, unknown> = {}) =>
    requestJson<{
      ok: boolean;
      data?: unknown;
      durationMs?: number;
      timestampIst?: string;
      error?: string;
    }>('/api/mcp/invoke', {
      method: 'POST',
      body: JSON.stringify({ toolName, args }),
    }),
};

export function formatInr(value: number, showSign = false): string {
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (value < 0) return `-₹${formatted}`;
  if (showSign && value > 0) return `+₹${formatted}`;
  return `₹${formatted}`;
}

export function formatPct(value: number, showSign = true): string {
  const prefix = showSign && value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

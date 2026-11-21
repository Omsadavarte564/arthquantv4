export type DataMode =
  | 'HISTORICAL_RESEARCH_DATASET'
  | 'PUBLIC_DELAYED_NSE_FEED'
  | 'PAPER_SIMULATION'
  | 'LIVE_BROKER_FEED'
  | 'DATA_UNAVAILABLE';

export type Timeframe = '1m' | '5m' | '15m';

export type MarketRegime =
  | 'STRONG_TREND_BULL'
  | 'STRONG_TREND_BEAR'
  | 'SIDEWAYS_RANGE'
  | 'HIGH_VOL_BREAKOUT'
  | 'UNCERTAIN_CHOP';

export type SignalDirection = 'BUY' | 'SELL' | 'HOLD' | 'NO_TRADE';

export interface Candle {
  time: number; // Unix seconds (UTC)
  istLabel: string; // e.g. "2026-11-18 10:15 IST"
  sessionDate: string; // YYYY-MM-DD in IST
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorPoint {
  time: number;
  ema9: number;
  ema21: number;
  sma50: number;
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  vwap: number;
  atr14: number;
  adx14: number;
  plusDi: number;
  minusDi: number;
  supertrend: number;
  supertrendDir: 1 | -1;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  relVolume: number;
  orbHigh: number;
  orbLow: number;
  support: number;
  resistance: number;
}

export interface StockMetadata {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  sector: string;
  marketCapCr: number;
  lotSize: number;
  tickSize: number;
  avgDailyVolume: number;
  beta: number;
  peRatio: number;
  roePct: number;
  institutionalHoldingPct: number;
}

export interface ScannerRow {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  sector: string;
  marketCapCr: number;
  ltp: number;
  changePct: number;
  volume: number;
  relVolume: number;
  rsi14: number;
  adx14: number;
  atrPct: number;
  vwapDistPct: number;
  regime: MarketRegime;
  aiProbUp: number;
  aiProbDown: number;
  riskReward: number;
  signal: SignalDirection;
  inWatchlist: boolean;
  dataMode: DataMode;
}

export interface IndexQuote {
  symbol: string;
  name: string;
  ltp: number;
  change: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  regime: MarketRegime;
}

export interface SectorPerformance {
  sector: string;
  changePct: number;
  advances: number;
  declines: number;
  relVolume: number;
  leaderSymbol: string;
}

export type StandardizedFeedClassification =
  | 'LIVE_REALTIME'
  | 'DELAYED'
  | 'CACHED'
  | 'HISTORICAL'
  | 'DEMO'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export interface DataHealthStatus {
  providerName: string;
  connectionStatus: 'CONNECTED_LOCAL_RESEARCH' | 'CONNECTED_LOCAL_ARCHIVE' | 'FEED_CONNECTED' | 'DISCONNECTED';
  marketStatus: 'OPEN' | 'PRE_OPEN' | 'MARKET_CLOSED';
  marketStatusReason: string;
  classification: StandardizedFeedClassification;
  liveVerificationStatus:
    | 'LIVE_VERIFICATION_PENDING'
    | 'VERIFIED_LIVE'
    | 'DELAYED_PUBLIC_DATA'
    | 'NOT_CONNECTED';
  lastUpdateIst: string;
  lastHeartbeatIst: string;
  latestSourceTimestampIst: string;
  feedLatencyMs: number | null;
  missingDataCount: number;
  reconnectionCount: number;
  validationPassed: boolean;
  staleFeedBlocked: boolean;
  validationNotes: string[];
}

export interface MarketOverviewResponse {
  dataMode: DataMode;
  dataSourceLabel: string;
  istTimestamp: string;
  marketStatus: 'OPEN' | 'PRE_OPEN' | 'MARKET_CLOSED' | 'CLOSED_RESEARCH_REPLAY';
  dataHealth: DataHealthStatus;
  indices: IndexQuote[];
  breadth: {
    advances: number;
    declines: number;
    unchanged: number;
    adRatio: number;
    realizedVolAnnualizedPct: number;
  };
  overallRegime: MarketRegime;
  sectors: SectorPerformance[];
  topGainers: ScannerRow[];
  topLosers: ScannerRow[];
  unusualVolume: ScannerRow[];
  fiiDiiContext: {
    note: string;
    fiiNetCr: number | null;
    diiNetCr: number | null;
    asOfDate: string;
    sourceStatus: 'UNAVAILABLE_REQUIRES_NSE_FEED';
  };
}

export interface TradingSignal {
  id: string;
  symbol: string;
  companyName: string;
  exchange: 'NSE' | 'BSE';
  direction: SignalDirection;
  entryPrice: number;
  entryZone: [number, number];
  stopLoss: number;
  target1: number;
  target2: number;
  riskRewardRatio: number;
  estimatedProbability: number; // Calibrated probability [0, 1]
  confidenceLow: number; // 95% Wilson CI lower bound
  confidenceHigh: number; // 95% Wilson CI upper bound
  modelConfidence: 'HIGH' | 'MODERATE' | 'LOW';
  strategyId: string;
  strategyName: string;
  regime: MarketRegime;
  technicalJustification: string;
  rejectionReason?: string;
  volumeData: {
    barVolume: number;
    relVolume: number;
  };
  timestampIst: string;
  marketDataTimestampIst?: string;
  predictionHorizonBars?: number;
  predictionId?: string;
  probUpPct?: number;
  probDownPct?: number;
  probTimeoutPct?: number;
  entryConditions?: string[];
  modelValidated?: boolean;
  calibrationReliable?: boolean;
  estimatedSpreadBps?: number;
  expectedMovePct?: number;
  roundTripCostPct?: number;
  dataQualityPassed?: boolean;
  expiresAtIst: string;
  riskClassification: 'LOW' | 'MODERATE' | 'HIGH';
  dataMode: DataMode;
  modelVersion: string;
}

export interface StrategyRuleCondition {
  indicator: 'RSI' | 'ADX' | 'REL_VOL' | 'PRICE_VS_VWAP' | 'EMA_CROSS' | 'SUPERTREND' | 'BB_POS';
  operator: '>' | '<' | '>=' | '<=' | 'ABOVE' | 'BELOW' | 'BULL_CROSS' | 'BEAR_CROSS';
  value: number;
}

export interface StrategyConfig {
  id: string;
  name: string;
  version: string;
  category: 'MOMENTUM' | 'TREND' | 'BREAKOUT' | 'MEAN_REVERSION' | 'ENSEMBLE' | 'CUSTOM';
  description: string;
  allowedRegimes: MarketRegime[];
  entryConditions: StrategyRuleCondition[];
  stopLossAtrMult: number;
  target1AtrMult: number;
  target2AtrMult: number;
  trailingStopAtrMult: number | null;
  maxHoldingBars: number;
  minProbThreshold: number;
  isCustom: boolean;
  enabled: boolean;
  createdAt: string;
}

export interface NseChargeBreakdown {
  turnover: number;
  brokerage: number;
  stt: number;
  exchangeTxnCharge: number;
  sebiTurnoverFee: number;
  ipftCharge: number;
  stampDuty: number;
  gst: number;
  slippageCost: number;
  totalCharges: number;
}

export interface BacktestConfig {
  symbols: string[];
  strategyId: string;
  timeframe: Timeframe;
  initialCapital: number;
  riskPerTradePct: number;
  brokerageFlatCap: number;
  brokeragePct: number;
  slippageBps: number;
  useOutOfSampleOnly: boolean;
  dataset?: 'research' | 'public';
  bidAskSpreadBps?: number;
  partialFillMode?: boolean;
  maxParticipationPct?: number;
  enforceCostHurdle?: boolean;
}

export interface BacktestTrade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryTimeIst: string;
  exitTimeIst: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  requestedQty?: number;
  fillRatio?: number;
  bidAskSpreadCostInr?: number;
  grossPnl: number;
  charges: NseChargeBreakdown;
  netPnl: number;
  returnPct: number;
  exitReason: 'TARGET_1' | 'TARGET_2' | 'STOP_LOSS' | 'TRAILING_SL' | 'EOD_SQUAREOFF' | 'MAX_BARS';
  regime: MarketRegime;
  barsHeld: number;
}

export interface WilsonCI {
  lowerPct: number;
  upperPct: number;
  sampleSize: number;
}

export interface RegimeStats {
  regime: MarketRegime;
  trades: number;
  wins: number;
  winRatePct: number;
  netPnl: number;
  profitFactor: number;
}

export interface BacktestCostSensitivityRow {
  slippageBps: number;
  totalTrades: number;
  winRatePct: number;
  profitFactor: number;
  netPnl: number;
  netReturnPct: number;
  totalCharges: number;
}

export interface BacktestSymbolSummary {
  symbol: string;
  trades: number;
  wins: number;
  winRatePct: number;
  netPnl: number;
  profitFactor: number;
}

export interface BacktestSessionSummary {
  sessionDate: string;
  trades: number;
  wins: number;
  netPnl: number;
}

export interface BacktestResult {
  id: string;
  createdAt: string;
  config: BacktestConfig;
  strategyName: string;
  strategyVersion: string;
  dataMode: DataMode;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  winRateCI: WilsonCI;
  lossRatePct: number;
  grossTotalPnl?: number;
  grossProfit: number;
  grossLoss: number;
  totalCharges: number;
  totalSlippage: number;
  totalSpreadCostInr?: number;
  totalNetProfit: number;
  netReturnPct: number;
  benchmarkReturnPct?: number;
  alphaOverBenchmarkPct?: number;
  liquiditySkippedCount?: number;
  partialFillCount?: number;
  avgFillRatioPct?: number;
  costHurdleSkippedCount?: number;
  portfolioDailySharpe?: number;
  dataSourceDetails?: {
    provider: string;
    totalBarsAnalyzed: number;
    zeroVolumeBarsExcluded: number;
    gapsDetected: number;
    dateRangeIst: string;
    datasetVersion?: string;
    isSynthetic?: boolean;
    symbolsRequested?: number;
    symbolsSkipped?: { symbol: string; reason: string }[];
  };
  profitFactor: number;
  expectancyInr: number;
  avgWinInr: number;
  avgLossInr: number;
  maxDrawdownInr: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxConsecutiveLosses: number;
  avgBarsHeld: number;
  target70Met: boolean;
  validationNotice: string;
  equityCurve: { index: number; timestampIst: string; equity: number; drawdownPct: number }[];
  regimeBreakdown: RegimeStats[];
  symbolBreakdown?: BacktestSymbolSummary[];
  sessionBreakdown?: BacktestSessionSummary[];
  costSensitivity?: BacktestCostSensitivityRow[];
  trades: BacktestTrade[];
}

export interface CalibrationBin {
  binLabel: string;
  predictedMean: number;
  empiricalWinRate: number;
  count: number;
}

export interface FeatureImportance {
  feature: string;
  weight: number;
  absImportance: number;
}

export interface MlClassificationMetrics {
  accuracyPct: number;
  precisionPct: number;
  recallPct: number;
  f1Pct: number;
  balancedAccPct: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

export interface MlBaselineComparison {
  name: string;
  accuracyPct: number;
  balancedAccPct: number;
  samples: number;
}

export interface MlWalkForwardFold {
  foldIndex: number;
  trainRangeIst: string;
  testRangeIst: string;
  trainBars: number;
  testBars: number;
  accuracyPct: number;
  brierScore: number;
  rocAuc: number;
  dominantRegime: MarketRegime;
}

export interface MlRegimePerformance {
  regime: MarketRegime;
  samples: number;
  accuracyPct: number;
  brierScore: number;
}

export type ModelFamily =
  | 'DUAL_LOGIT_PLATT'
  | 'MULTINOMIAL_3CLASS_SOFTMAX'
  | 'RANDOM_FOREST'
  | 'GBDT_ENSEMBLE';

export interface MultiModelBenchmarkEntry {
  modelFamily: ModelFamily;
  modelVersion: string;
  accuracyPct: number;
  balancedAccPct: number;
  precisionPct: number;
  recallPct: number;
  f1Pct: number;
  brierScore: number;
  logLoss: number;
  rocAucUp: number;
  rocAucDown: number;
  ecePct: number;
  mcePct: number;
  selectiveCount: number;
  selectiveWinRatePct: number;
  threeClassAccuracyPct?: number;
  threeClassLogLoss?: number;
  longTradeExpectancyR?: number;
  shortTradeExpectancyR?: number;
}

export interface MlEvaluationResult {
  symbol: string;
  timeframe: Timeframe;
  modelVersion: string;
  modelFamily?: ModelFamily;
  sourceDataset?: 'RESEARCH_REPLAY' | 'PUBLIC_DELAYED_NSE_FEED' | 'AUTHORIZED_HISTORICAL_ARCHIVE';
  horizonBars?: number;
  splitSummary: {
    trainBars: number;
    embargoBars: number;
    valBars: number;
    oosTestBars: number;
  };
  classPrevalence?: {
    upPct: number;
    downPct: number;
    timeoutPct: number;
  };
  oosSamples: number;
  oosRawWinRatePct: number;
  oosFilteredWinRatePct: number;
  oosFilteredSamples: number;
  oosFilteredCI: WilsonCI;
  brierScore: number;
  logLoss: number;
  rocAucApprox: number;
  ecePct?: number;
  mcePct?: number;
  threeClassMetrics?: {
    accuracyPct: number;
    logLoss: number;
    meanTimeoutProbPct: number;
  };
  classification?: MlClassificationMetrics;
  priorMatchedClassification?: MlClassificationMetrics & { thresholdUsedPct: number };
  shortClassification?: MlClassificationMetrics;
  shortBrierScore?: number;
  shortRocAuc?: number;
  baselines?: MlBaselineComparison[];
  modelComparison?: MultiModelBenchmarkEntry[];
  walkForwardFolds?: MlWalkForwardFold[];
  regimePerformance?: MlRegimePerformance[];
  overfittingWarning?: string | null;
  calibrationBins: CalibrationBin[];
  featureImportances: FeatureImportance[];
  honestAssessment: string;
  dataMode: DataMode;
}

export interface RiskConfig {
  killSwitchActive: boolean;
  maxLossPerTradePct: number;
  maxDailyLossInr: number;
  maxDrawdownPct: number;
  maxTotalExposurePct: number;
  maxStockExposurePct: number;
  maxOpenPositions: number;
  maxTradesPerDay: number;
  maxConsecutiveLosses: number;
  minRiskRewardRatio: number;
  maxSpreadBps: number;
  minDailyVolume: number;
  enforceMarketHoursCutoff: boolean;
  paperSlippageBps?: number;
  paperSpreadBps?: number;
}

export interface RiskDecision {
  id: string;
  timestampIst: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  requestedQty: number;
  approvedQty: number;
  verdict: 'APPROVED' | 'REJECTED';
  reasons: string[];
  estimatedRiskInr: number;
  riskRewardRatio: number;
}

export interface PaperOrder {
  id: string;
  clientOrderId: string;
  predictionId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  quantity: number;
  requestedPrice: number;
  limitPrice?: number;
  stopLoss: number;
  target: number;
  strategyName: string;
  regime: MarketRegime;
  status: 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  filledPrice?: number;
  createdAtIst: string;
  filledAtIst?: string;
  rejectionReason?: string;
}

export interface PaperPosition {
  symbol: string;
  predictionId?: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number;
  stopLoss: number;
  target: number;
  unrealizedPnl: number;
  strategyName: string;
  regime: MarketRegime;
  openedAtIst: string;
}

export interface PaperTrade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  grossPnl: number;
  charges: NseChargeBreakdown;
  netPnl: number;
  strategyName: string;
  regime: MarketRegime;
  openedAtIst: string;
  closedAtIst: string;
  exitReason: string;
}

export interface JournalEntry {
  id: string;
  timestampIst: string;
  type: 'SIGNAL' | 'RISK_CHECK' | 'ORDER_EXECUTION' | 'POSITION_CLOSE';
  symbol: string;
  strategyName: string;
  modelVersion: string;
  regime: MarketRegime;
  summary: string;
  netPnl?: number;
  chargesInr?: number;
  riskReward?: number;
  verdict: 'APPROVED' | 'REJECTED' | 'INFO';
}

export interface AlertItem {
  id: string;
  timestampIst: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  category: 'SIGNAL' | 'RISK' | 'EXECUTION' | 'REGIME' | 'DATA_FEED';
  title: string;
  message: string;
  read: boolean;
}

export interface PaperAccountState {
  executionMode: 'SIMULATED_PAPER_TRADING';
  initialCapital: number;
  availableCapital: number;
  usedMargin: number;
  realizedPnlToday: number;
  unrealizedPnl: number;
  totalEquity: number;
  tradesToday: number;
  consecutiveLosses: number;
  simulationBarOffset: number;
  positions: PaperPosition[];
  orders: PaperOrder[];
  closedTrades: PaperTrade[];
  journal: JournalEntry[];
  alerts: AlertItem[];
}

export interface BrokerAdapterInfo {
  id: 'zerodha' | 'upstox' | 'dhan' | 'angelone';
  name: string;
  status: 'DISCONNECTED_CREDENTIALS_NOT_SET' | 'CONFIGURED_READY_FOR_OAUTH';
  liveExecutionEnabled: false;
  pricingSummary: string;
  rateLimits: string;
  staticIpRequired: boolean;
  authFlow: string;
  algoTaggingRequired: boolean;
  complianceNotes: string;
}

export interface NseDirectoryEntry {
  symbol: string;
  name: string;
  exchange: 'NSE';
  segment: string;
  instrumentType: string;
  instrumentToken: string;
  exchangeToken: string;
  tickSize: number;
  lotSize: number;
  isStandardEquity: boolean;
  hasResearchCandles: boolean;
  sector?: string;
  inWatchlist?: boolean;
  ltp?: number;
  changePct?: number;
}

export interface NseDirectoryResponse {
  sourceName: string;
  sourceUrl: string;
  syncedAtIst: string;
  syncWarning?: string;
  counts: {
    standardEquities: number;
    totalCashInstruments: number;
    researchUniverse: number;
  };
  scope: 'clean' | 'all' | 'research';
  page: number;
  limit: number;
  totalMatches: number;
  totalPages: number;
  items: NseDirectoryEntry[];
}

export interface PublicNseQuote {
  symbol: string;
  ltp: number;
  previousClose: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  lastBarIst: string;
  sourceLabel: string;
}

export type RagCollection =
  | 'INDIAN_MARKET'
  | 'COMPANY_INFO'
  | 'FINANCIAL_NEWS_RESEARCH'
  | 'TRADING_KNOWLEDGE'
  | 'REGULATORY_COMPLIANCE';

export type RagDocumentStatus = 'ACTIVE' | 'SUPERSEDED' | 'ARCHIVED';
export type RagIndexingStatus = 'INDEXED' | 'FAILED' | 'PENDING';

export interface RagDocumentMetadata {
  docId: string;
  title: string;
  sourceUrl: string;
  publisher: string;
  category: string;
  collection: RagCollection;
  publicationDate: string;
  effectiveDate: string;
  uploadDate: string;
  lastUpdatedDate: string;
  version: number;
  exchangeOrCompany: string;
  relatedSymbol?: string;
  status: RagDocumentStatus;
  indexingStatus: RagIndexingStatus;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  chunkCount: number;
  pageCount: number;
  supersededByDocId?: string;
  geminiFileSearchStoreName?: string;
  geminiFileSearchDocName?: string;
  geminiFileSearchSynced: boolean;
  indexingError?: string;
}

export interface RagCitation {
  docId: string;
  chunkId: string;
  title: string;
  collection: RagCollection;
  category: string;
  publisher: string;
  sourceUrl: string;
  publicationDate: string;
  effectiveDate: string;
  relatedSymbol?: string;
  pageNumber: number;
  score: number;
  status: RagDocumentStatus;
  excerpt: string;
}

export interface RagRetrievalResult {
  query: string;
  classifiedCollections: RagCollection[];
  detectedSymbol?: string;
  prioritizeLatestRegulatory: boolean;
  sufficientEvidence: boolean;
  confidenceScore: number;
  citations: RagCitation[];
  engineUsed: 'HYBRID_BM25_VECTOR_WITH_FILE_SEARCH' | 'LOCAL_HYBRID_VECTOR_BM25';
  noResultReason?: string;
}

export type McpPermissionLevel =
  | 'PUBLIC_MARKET'
  | 'RESEARCH_QUANT'
  | 'PORTFOLIO_READ'
  | 'ADMIN_RESTRICTED';

export interface McpToolMetadata {
  name: string;
  title: string;
  description: string;
  permissionLevel: McpPermissionLevel;
  category: 'MARKET' | 'AI_ANALYSIS' | 'STRATEGY_BACKTEST' | 'PORTFOLIO_RISK';
  inputSchemaSummary: string;
}

export interface McpAuditLogEntry {
  id: string;
  timestampIst: string;
  toolName: string;
  userId: string;
  permissionLevel: McpPermissionLevel;
  status: 'SUCCESS' | 'DENIED' | 'VALIDATION_ERROR' | 'ERROR' | 'TIMEOUT';
  durationMs: number;
  summary: string;
}

export interface McpIntegrationStatus {
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
  transportType: 'StreamableHTTP';
  endpointPath: string;
  serverRunning: boolean;
  clientConnected: boolean;
  authMode: 'BEARER_TOKEN_SERVER_MANAGED';
  authConfigured: boolean;
  lastConnectedIst: string | null;
  lastToolInvocationIst: string | null;
  lastError: string | null;
  tools: McpToolMetadata[];
  recentAuditLogs: McpAuditLogEntry[];
}

export interface AssistantTransparencyTag {
  type:
    | 'LIVE_OR_DELAYED_MARKET_DATA'
    | 'QUANT_ML_ENGINE'
    | 'RETRIEVED_RAG_DOCUMENTS'
    | 'PAPER_PORTFOLIO_DATA'
    | 'GENERAL_EXPLANATION';
  label: string;
  timestampIst: string;
  source: string;
}

export interface CopilotQueryResponse {
  available: boolean;
  answer: string;
  error?: string;
  routing: {
    intent: 'DOCUMENT_QA' | 'LIVE_MARKET' | 'COMBINED_RESEARCH' | 'STRATEGY_PERF' | 'PORTFOLIO' | 'GENERAL';
    usedRag: boolean;
    usedMcp: boolean;
    detectedSymbol?: string;
  };
  sufficientEvidence: boolean;
  ragConfidenceScore: number;
  citations: RagCitation[];
  mcpToolsUsed: {
    toolName: string;
    durationMs: number;
    timestampIst: string;
    status: string;
    dataPreview: string;
  }[];
  transparencyTags: AssistantTransparencyTag[];
  modelUsed?: string;
}

export interface HistoricalDatasetMetadata {
  datasetVersion: string;
  provider: 'YAHOO_PUBLIC_NSE' | 'ZERODHA_KITE_HISTORICAL' | 'UPSTOX_HISTORICAL' | 'DHAN_HISTORICAL' | 'LOCAL_ARCHIVE_STORE' | 'RESEARCH_REPLAY';
  symbol: string;
  timeframe: Timeframe | '1d';
  timezone: 'Asia/Kolkata';
  startIst: string;
  endIst: string;
  totalBars: number;
  zeroVolumeBars: number;
  missingGaps: number;
  duplicatesRemoved: number;
  invalidOhlcBars: number;
  outlierBarsFlagged: number;
  overnightSplitFlags: number;
  formingBarExcluded: boolean;
  isMultiYearAuthorized: boolean;
  ingestedAtIst: string;
  limitationNote?: string;
}

export interface PaperPeriodPerformance {
  periodLabel: string;
  closedTrades: number;
  wins: number;
  winRatePct: number;
  grossPnlInr: number;
  chargesInr: number;
  netPnlInr: number;
  resolvedPredictions: number;
  predictionHits: number;
  predictionHitRatePct: number;
  avgConfidencePct: number;
}

export interface PredictionRecord {
  predictionId: string;
  predictionTimestampIst: string;
  marketDataTimestampIst: string;
  barIndex: number;
  symbol: string;
  timeframe: Timeframe;
  modelVersion: string;
  strategyId: string;
  direction: SignalDirection;
  regime: MarketRegime;
  probUp: number;
  probDown: number;
  probTimeout?: number;
  confidencePct: number;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  horizonBars: number;
  entryConditions?: string[];
  featureVector: number[];
  sourceDataset?: 'RESEARCH_REPLAY' | 'PUBLIC_DELAYED_NSE_FEED' | 'AUTHORIZED_HISTORICAL_ARCHIVE';
  dataQualityPassed?: boolean;
  modelValidated?: boolean;
  calibrationReliable?: boolean;
  estimatedSpreadBps?: number;
  expectedMovePct?: number;
  roundTripCostPct?: number;
  barTimeUnixSec?: number;
  status: 'PENDING' | 'RESOLVED_HIT' | 'RESOLVED_MISS' | 'RESOLVED_NEUTRAL';
  actualOutcome?: 'UP_TARGET' | 'DOWN_TARGET' | 'NEUTRAL_TIMEOUT';
  resolvedAtIst?: string;
  realizedReturnPct?: number;
  simulatedExecution?: {
    executed: boolean;
    orderId?: string;
    fillPrice?: number;
    exitPrice?: number;
    slippageInr?: number;
    chargesInr?: number;
    netPnlInr?: number;
    exitReason?: string;
  };
}

export interface ModelVersionEntry {
  modelVersion: string;
  deployedAtIst: string;
  active: boolean;
  notes: string;
  oosBrierScore: number;
  oosAccuracyPct: number;
  ecePct: number;
}

export interface MonitoringDashboardSummary {
  activeModelVersion: string;
  totalLoggedPredictions: number;
  pendingPredictions: number;
  resolvedPredictions: number;
  resolvedHitRatePct: number;
  avgConfidencePct: number;
  calibrationDriftPct: number;
  featureDriftZScore: number;
  driftAlertActive: boolean;
  driftAlertReason?: string;
  regimeBreakdown: {
    regime: MarketRegime;
    total: number;
    hits: number;
    hitRatePct: number;
  }[];
  symbolBreakdown: {
    symbol: string;
    total: number;
    hits: number;
    hitRatePct: number;
  }[];
  paperVsBacktestVariance: {
    paperClosedTrades: number;
    paperWinRatePct: number;
    paperNetPnl: number;
    latestBacktestWinRatePct: number | null;
    winRateDeltaPct: number | null;
  };
  dailyReports?: PaperPeriodPerformance[];
  weeklyReports?: PaperPeriodPerformance[];
  recentPredictions: PredictionRecord[];
  modelVersions: ModelVersionEntry[];
}

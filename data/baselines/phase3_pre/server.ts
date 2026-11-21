import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  BacktestConfig,
  HistoricalDatasetMetadata,
  ModelFamily,
  RiskConfig,
  StrategyConfig,
  Timeframe,
} from './src/types/trading.ts';
import {
  explainSignalWithGemini,
  generateMarketReportWithGemini,
  generateStockSummaryWithGemini,
  isGeminiConfigured,
} from './server/ai/geminiService.ts';
import { runAssistantCopilot } from './server/ai/assistantOrchestrator.ts';
import { mcpClientManager } from './server/mcp/mcpClient.ts';
import { handleMcpHttpRequest } from './server/mcp/mcpServer.ts';
import {
  deleteRagDocument,
  getRagDocumentById,
  ingestRagDocument,
  listRagDocuments,
  retrieveRagContext,
  updateRagDocument,
} from './server/rag/ragEngine.ts';
import { getBrokerAdaptersStatus } from './server/brokers/brokerAdapter.ts';
import {
  getResearchCandles,
  isValidSymbol,
  STOCK_MAP,
  STOCK_UNIVERSE,
} from './server/data/nseUniverse.ts';
import {
  findNseDirectoryEntry,
  queryNseDirectory,
  syncNseDirectory,
} from './server/data/nseDirectory.ts';
import {
  acquireHistoricalSeries,
  getAuthorizedHistoricalProvidersStatus,
  getCachedRealHistoricalCandles,
  LIQUID_NSE_PUBLIC_SYMBOLS,
} from './server/data/historicalProvider.ts';
import { fetchPublicNseCandles } from './server/data/publicMarketFeed.ts';
import { validateCandles } from './server/data/validator.ts';
import { runBacktest } from './server/quant/backtester.ts';
import { computeIndicators } from './server/quant/indicators.ts';
import { trainAndEvaluateWalkForward } from './server/quant/mlEngine.ts';
import {
  appendPredictionRecords,
  computeMonitoringSummary,
  resolvePendingPredictions,
  rollbackActiveModelVersion,
} from './server/quant/monitoringEngine.ts';
import { formatNowIst } from './server/quant/riskEngine.ts';
import { computeMarketSnapshot } from './server/quant/signals.ts';
import {
  closePaperPosition,
  getAllStrategies,
  loadState,
  recalculateAccountTotals,
  resetPaperAccount,
  saveState,
  stepSimulationBar,
  submitPaperOrder,
} from './server/storage/stateStore.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // ── Health & Runtime Status ──────────────────────────────────────────────────
  app.get('/api/health', (_req: Request, res: Response) => {
    const state = loadState();
    res.json({
      status: 'OK',
      service: 'ArthQuant Express Terminal',
      dataMode: 'HISTORICAL_RESEARCH_DATASET',
      executionMode: 'SIMULATED_PAPER_TRADING',
      liveTradingLocked: true,
      geminiConfigured: isGeminiConfigured(),
      pythonMlServiceConfigured: Boolean(process.env.ML_SERVICE_URL),
      universeCount: STOCK_UNIVERSE.length,
      strategiesCount: getAllStrategies(state).length,
      istNow: formatNowIst(),
    });
  });

  app.get('/api/data/health', (req: Request, res: Response) => {
    const state = loadState();
    const tf = parseTimeframe(req.query.timeframe);
    const enforceFresh = req.query.enforceLiveFreshness === 'true';
    const snap = computeMarketSnapshot(
      new Set(state.watchlist),
      getAllStrategies(state),
      state.paperAccount.simulationBarOffset,
      tf,
      enforceFresh
    );
    res.json({
      dataMode: snap.overview.dataMode,
      dataHealth: snap.overview.dataHealth,
      universeCount: STOCK_UNIVERSE.length,
      enforceLiveFreshnessApplied: enforceFresh,
    });
  });

  app.get('/api/data/historical/manifest', (_req: Request, res: Response) => {
    const cacheDir = path.resolve(process.cwd(), 'data', 'historical_cache');
    const cachedSeries: HistoricalDatasetMetadata[] = [];
    if (fs.existsSync(cacheDir)) {
      for (const file of fs.readdirSync(cacheDir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf-8'));
          if (parsed?.metadata) cachedSeries.push(parsed.metadata as HistoricalDatasetMetadata);
        } catch {
          // ignore unreadable cache file
        }
      }
    }
    res.json({
      providers: getAuthorizedHistoricalProvidersStatus(),
      liquidPublicUniverse: LIQUID_NSE_PUBLIC_SYMBOLS,
      cachedCount: cachedSeries.length,
      cachedSeries: cachedSeries.sort((a, b) =>
        `${a.symbol}_${a.timeframe}`.localeCompare(`${b.symbol}_${b.timeframe}`)
      ),
      limitationNote:
        'Public Yahoo NSE feed provides up to ~60 trading days for 5m/15m, ~21 trading days for 1m, and ~3 years for 1d. Drop licensed multi-year CSV/JSON archives into data/historical_archive/ or configure Zerodha/Upstox/Dhan credentials for 2-3y intraday ticks.',
    });
  });

  // ── Market Overview & Universe ──────────────────────────────────────────────
  app.get('/api/market/overview', (req: Request, res: Response) => {
    const state = loadState();
    const tf = parseTimeframe(req.query.timeframe);
    const snap = computeMarketSnapshot(
      new Set(state.watchlist),
      getAllStrategies(state),
      state.paperAccount.simulationBarOffset,
      tf
    );
    res.json({
      overview: snap.overview,
      universe: STOCK_UNIVERSE,
    });
  });

  app.get('/api/market/candles/:symbol', async (req: Request, res: Response) => {
    const symbol = String(req.params.symbol || 'RELIANCE').toUpperCase().trim();
    const tf = parseTimeframe(req.query.timeframe);
    const feedMode = String(req.query.feed || 'auto').toLowerCase();
    const stepSec = tf === '1m' ? 60 : tf === '15m' ? 900 : 300;

    const inResearchUniverse = isValidSymbol(symbol);
    const dirEntry = inResearchUniverse ? null : await findNseDirectoryEntry(symbol);

    if (!inResearchUniverse && !dirEntry) {
      res.status(404).json({ error: `Unknown NSE/BSE symbol '${symbol}'.` });
      return;
    }

    const usePublicFeed = feedMode === 'public' || !inResearchUniverse;
    if (usePublicFeed) {
      try {
        const publicData = await fetchPublicNseCandles(symbol, tf);
        const { cleaned, report } = validateCandles(publicData.candles, stepSec);
        const indicators = computeIndicators(cleaned);
        const meta = STOCK_MAP.get(symbol);

        res.json({
          symbol,
          name: meta?.name ?? dirEntry?.name ?? symbol,
          sector: meta?.sector ?? 'NSE Cash Equity',
          timeframe: tf,
          dataMode: 'PUBLIC_DELAYED_NSE_FEED',
          quote: publicData.quote,
          validation: report,
          candles: cleaned.slice(-260),
          indicators: indicators.slice(-260),
        });
        return;
      } catch (err) {
        if (feedMode === 'public' || !inResearchUniverse) {
          res.status(503).json({
            error:
              err instanceof Error
                ? err.message
                : `Public NSE candle feed unavailable for ${symbol}.`,
          });
          return;
        }
      }
    }

    const raw = getResearchCandles(symbol, tf);
    const { cleaned, report } = validateCandles(raw, stepSec);
    const indicators = computeIndicators(cleaned);
    const meta = STOCK_MAP.get(symbol);

    res.json({
      symbol,
      name: meta?.name ?? symbol,
      sector: meta?.sector ?? 'Index',
      timeframe: tf,
      dataMode: 'HISTORICAL_RESEARCH_DATASET',
      validation: report,
      candles: cleaned.slice(-260),
      indicators: indicators.slice(-260),
    });
  });

  app.get('/api/market/public-quote/:symbol', async (req: Request, res: Response) => {
    const symbol = String(req.params.symbol || '').toUpperCase().trim();
    const inResearchUniverse = isValidSymbol(symbol);
    const dirEntry = inResearchUniverse ? null : await findNseDirectoryEntry(symbol);
    if (!inResearchUniverse && !dirEntry) {
      res.status(404).json({ error: `Unknown NSE symbol '${symbol}'.` });
      return;
    }
    try {
      const data = await fetchPublicNseCandles(symbol, '5m');
      res.json({
        symbol,
        name: STOCK_MAP.get(symbol)?.name ?? dirEntry?.name ?? symbol,
        quote: data.quote,
      });
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : `Unable to fetch NSE quote for ${symbol}.`,
      });
    }
  });

  // ── Stock Scanner ───────────────────────────────────────────────────────────
  app.get('/api/scanner', (req: Request, res: Response) => {
    const state = loadState();
    const tf = parseTimeframe(req.query.timeframe);
    const snap = computeMarketSnapshot(
      new Set(state.watchlist),
      getAllStrategies(state),
      state.paperAccount.simulationBarOffset,
      tf
    );

    let rows = snap.scanner;
    const sector = String(req.query.sector || '').trim();
    const regime = String(req.query.regime || '').trim();
    const signal = String(req.query.signal || '').trim();
    const search = String(req.query.search || '').trim().toUpperCase();
    const minRvol = Number(req.query.minRvol || 0);
    const minProb = Number(req.query.minProb || 0);

    if (sector && sector !== 'ALL') {
      rows = rows.filter((r) => r.sector === sector);
    }
    if (regime && regime !== 'ALL') {
      rows = rows.filter((r) => r.regime === regime);
    }
    if (signal && signal !== 'ALL') {
      rows = rows.filter((r) => r.signal === signal);
    }
    if (search) {
      rows = rows.filter(
        (r) => r.symbol.includes(search) || r.name.toUpperCase().includes(search)
      );
    }
    if (minRvol > 0) {
      rows = rows.filter((r) => r.relVolume >= minRvol);
    }
    if (minProb > 0) {
      rows = rows.filter((r) => Math.max(r.aiProbUp, r.aiProbDown) >= minProb);
    }

    res.json({
      dataMode: 'HISTORICAL_RESEARCH_DATASET',
      count: rows.length,
      rows,
    });
  });

  app.get('/api/market/nse-directory', async (req: Request, res: Response) => {
    try {
      const state = loadState();
      const q = String(req.query.q || '').trim();
      const scopeRaw = String(req.query.scope || 'clean').trim();
      const scope =
        scopeRaw === 'all' || scopeRaw === 'research' ? scopeRaw : 'clean';
      const page = Number(req.query.page || 1);
      const limit = Number(req.query.limit || 50);
      const data = await queryNseDirectory({
        q,
        scope,
        page,
        limit,
        watchlist: new Set(state.watchlist),
      });
      res.json(data);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load NSE directory.',
      });
    }
  });

  app.post('/api/market/nse-directory/sync', async (_req: Request, res: Response) => {
    try {
      const state = loadState();
      await syncNseDirectory();
      const data = await queryNseDirectory({
        scope: 'clean',
        page: 1,
        limit: 50,
        watchlist: new Set(state.watchlist),
      });
      res.json(data);
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : 'Unable to sync NSE instrument master.',
      });
    }
  });

  // ── Watchlist ───────────────────────────────────────────────────────────────
  app.get('/api/watchlist', (_req: Request, res: Response) => {
    const state = loadState();
    res.json({ watchlist: state.watchlist });
  });

  app.post('/api/watchlist', (req: Request, res: Response) => {
    const symbol = String(req.body?.symbol || '').toUpperCase().trim();
    if (!symbol || !/^[A-Z0-9&-]{1,24}$/.test(symbol)) {
      res.status(400).json({ error: 'Valid NSE symbol required.' });
      return;
    }
    const state = loadState();
    if (!state.watchlist.includes(symbol)) {
      state.watchlist.push(symbol);
      saveState(state);
    }
    res.json({ watchlist: state.watchlist });
  });

  app.delete('/api/watchlist/:symbol', (req: Request, res: Response) => {
    const symbol = String(req.params.symbol || '').toUpperCase().trim();
    const state = loadState();
    state.watchlist = state.watchlist.filter((s) => s !== symbol);
    saveState(state);
    res.json({ watchlist: state.watchlist });
  });

  // ── AI Signals & Walk-Forward ML Evaluation ─────────────────────────────────
  app.get('/api/signals', (req: Request, res: Response) => {
    const state = loadState();
    const tf = parseTimeframe(req.query.timeframe);
    const snap = computeMarketSnapshot(
      new Set(state.watchlist),
      getAllStrategies(state),
      state.paperAccount.simulationBarOffset,
      tf
    );
    const added = appendPredictionRecords(
      state.monitoring,
      snap.signals,
      snap.barContextBySymbol,
      tf
    );
    const resolved = resolvePendingPredictions(
      state.monitoring,
      state.paperAccount.simulationBarOffset
    );
    if (added > 0 || resolved > 0) {
      saveState(state);
    }
    res.json({
      dataMode: 'HISTORICAL_RESEARCH_DATASET',
      istTimestamp: snap.overview.istTimestamp,
      signals: snap.signals,
    });
  });

  app.post('/api/ml/evaluate', async (req: Request, res: Response) => {
    const symbol = String(req.body?.symbol || 'RELIANCE').toUpperCase().trim();
    const tf = parseTimeframe(req.body?.timeframe);
    const threshold = Math.min(0.8, Math.max(0.5, Number(req.body?.threshold || 0.62)));
    const dataset = String(req.body?.dataset || 'research').toLowerCase() === 'public' ? 'public' : 'research';
    const rawFamily = String(req.body?.modelFamily || 'DUAL_LOGIT_PLATT').toUpperCase();
    const modelFamily: ModelFamily =
      rawFamily === 'MULTINOMIAL_3CLASS_SOFTMAX' ||
      rawFamily === 'RANDOM_FOREST' ||
      rawFamily === 'GBDT_ENSEMBLE'
        ? rawFamily
        : 'DUAL_LOGIT_PLATT';
    const includeModelComparison = req.body?.includeModelComparison !== false;
    const stepSec = tf === '1m' ? 60 : tf === '15m' ? 900 : 300;

    if (dataset === 'public') {
      const inResearch = STOCK_MAP.has(symbol);
      const dirEntry = inResearch ? null : await findNseDirectoryEntry(symbol);
      if (!inResearch && !dirEntry) {
        res.status(404).json({ error: `Unknown NSE symbol '${symbol}'.` });
        return;
      }
      try {
        const bundle = await acquireHistoricalSeries({
          symbol,
          timeframe: tf,
          excludeFormingBar: true,
        });
        const cleaned = bundle.candles;
        if (cleaned.length < 95) {
          res.status(422).json({
            error: `Insufficient closed intraday bars (${cleaned.length}) on public .NS feed for ${symbol} (${tf}). Need >= 95 closed bars.`,
          });
          return;
        }
        let niftyCandles = getCachedRealHistoricalCandles('NIFTY50', tf);
        if (!niftyCandles && symbol !== 'NIFTY50') {
          try {
            const niftyBundle = await acquireHistoricalSeries({
              symbol: 'NIFTY50',
              timeframe: tf,
              excludeFormingBar: true,
            });
            niftyCandles = niftyBundle.candles;
          } catch {
            niftyCandles = null;
          }
        }
        const indicators = computeIndicators(cleaned);
        const { evaluation } = trainAndEvaluateWalkForward(
          symbol,
          tf,
          cleaned,
          indicators,
          threshold,
          bundle.metadata.isMultiYearAuthorized ? 'AUTHORIZED_HISTORICAL_ARCHIVE' : 'PUBLIC_DELAYED_NSE_FEED',
          {
            modelFamily,
            includeModelComparison,
            indexCandles: niftyCandles ?? undefined,
          }
        );
        res.json(evaluation);
        return;
      } catch (err) {
        res.status(503).json({
          error:
            err instanceof Error
              ? err.message
              : `Public .NS intraday feed unavailable for ${symbol}.`,
        });
        return;
      }
    }

    if (!STOCK_MAP.has(symbol)) {
      res.status(404).json({ error: `Unknown NSE research symbol '${symbol}'.` });
      return;
    }

    const { cleaned } = validateCandles(getResearchCandles(symbol, tf), stepSec);
    const indicators = computeIndicators(cleaned);
    const { evaluation } = trainAndEvaluateWalkForward(
      symbol,
      tf,
      cleaned,
      indicators,
      threshold,
      'RESEARCH_REPLAY',
      {
        modelFamily,
        includeModelComparison,
        indexCandles: getResearchCandles('NIFTY50', tf),
      }
    );

    res.json(evaluation);
  });

  // ── Prediction Ledger, Drift Monitoring & Model Rollback ────────────────────
  app.get('/api/monitoring/summary', (_req: Request, res: Response) => {
    const state = loadState();
    // Ensure initial ledger snapshot exists on first view if completely empty
    if (state.monitoring.predictionLedger.length === 0) {
      const snap = computeMarketSnapshot(
        new Set(state.watchlist),
        getAllStrategies(state),
        state.paperAccount.simulationBarOffset,
        '5m'
      );
      const added = appendPredictionRecords(
        state.monitoring,
        snap.signals,
        snap.barContextBySymbol,
        '5m'
      );
      if (added > 0) saveState(state);
    }
    res.json(
      computeMonitoringSummary(
        state.monitoring,
        state.paperAccount,
        state.backtestHistory
      )
    );
  });

  app.post('/api/monitoring/resolve', (_req: Request, res: Response) => {
    const state = loadState();
    const resolved = resolvePendingPredictions(
      state.monitoring,
      state.paperAccount.simulationBarOffset
    );
    if (resolved > 0) saveState(state);
    res.json({
      resolvedCount: resolved,
      summary: computeMonitoringSummary(
        state.monitoring,
        state.paperAccount,
        state.backtestHistory
      ),
    });
  });

  app.post('/api/monitoring/rollback', (req: Request, res: Response) => {
    const targetVersion = String(req.body?.modelVersion || '').trim();
    if (!targetVersion) {
      res.status(400).json({ error: 'modelVersion is required.' });
      return;
    }
    const state = loadState();
    const rolled = rollbackActiveModelVersion(state.monitoring, targetVersion);
    if (!rolled) {
      res.status(404).json({ error: `Unknown model version '${targetVersion}'.` });
      return;
    }
    state.paperAccount.alerts.unshift({
      id: crypto.randomUUID(),
      timestampIst: formatNowIst(),
      severity: 'WARNING',
      category: 'REGIME',
      title: `Model Rollback: ${rolled.modelVersion}`,
      message: `Active ML model switched to ${rolled.modelVersion} (${rolled.notes}).`,
      read: false,
    });
    saveState(state);
    res.json({
      activeModelVersion: state.monitoring.activeModelVersion,
      summary: computeMonitoringSummary(
        state.monitoring,
        state.paperAccount,
        state.backtestHistory
      ),
    });
  });

  // ── Strategies & No-Code Strategy Builder ───────────────────────────────────
  app.get('/api/strategies', (_req: Request, res: Response) => {
    const state = loadState();
    res.json({ strategies: getAllStrategies(state) });
  });

  app.post('/api/strategies', (req: Request, res: Response) => {
    const body = req.body as Partial<StrategyConfig>;
    if (!body?.name || !Array.isArray(body.entryConditions) || body.entryConditions.length === 0) {
      res.status(400).json({ error: 'Strategy name and at least one entry condition are required.' });
      return;
    }

    const newStrategy: StrategyConfig = {
      id: `custom-${crypto.randomUUID().slice(0, 8)}`,
      name: String(body.name).trim().slice(0, 64),
      version: '1.0.0',
      category: 'CUSTOM',
      description: String(body.description || 'User-configured visual no-code intraday strategy.').slice(0, 220),
      allowedRegimes:
        Array.isArray(body.allowedRegimes) && body.allowedRegimes.length > 0
          ? body.allowedRegimes
          : ['STRONG_TREND_BULL', 'STRONG_TREND_BEAR', 'HIGH_VOL_BREAKOUT'],
      entryConditions: body.entryConditions,
      stopLossAtrMult: Math.max(0.4, Math.min(4, Number(body.stopLossAtrMult || 1.1))),
      target1AtrMult: Math.max(0.6, Math.min(8, Number(body.target1AtrMult || 1.8))),
      target2AtrMult: Math.max(1.0, Math.min(12, Number(body.target2AtrMult || 2.8))),
      trailingStopAtrMult: body.trailingStopAtrMult ? Number(body.trailingStopAtrMult) : null,
      maxHoldingBars: Math.max(3, Math.min(70, Number(body.maxHoldingBars || 20))),
      minProbThreshold: Math.max(0.5, Math.min(0.85, Number(body.minProbThreshold || 0.56))),
      isCustom: true,
      enabled: true,
      createdAt: formatNowIst(),
    };

    const state = loadState();
    state.customStrategies.unshift(newStrategy);
    saveState(state);
    res.status(201).json({ strategy: newStrategy, strategies: getAllStrategies(state) });
  });

  app.patch('/api/strategies/:id/toggle', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const state = loadState();
    const custom = state.customStrategies.find((s) => s.id === id);
    if (custom) {
      custom.enabled = !custom.enabled;
    } else {
      if (state.disabledBuiltinIds.includes(id)) {
        state.disabledBuiltinIds = state.disabledBuiltinIds.filter((x) => x !== id);
      } else {
        state.disabledBuiltinIds.push(id);
      }
    }
    saveState(state);
    res.json({ strategies: getAllStrategies(state) });
  });

  // ── Backtesting Laboratory ──────────────────────────────────────────────────
  app.post('/api/backtest/run', async (req: Request, res: Response) => {
    const state = loadState();
    const allStrategies = getAllStrategies(state);
    const body = req.body as Partial<BacktestConfig>;

    const strategy = allStrategies.find((s) => s.id === body?.strategyId) ?? allStrategies[0];
    const dataset: 'research' | 'public' =
      String(body?.dataset || 'research').toLowerCase() === 'public' ? 'public' : 'research';
    const tf = parseTimeframe(body?.timeframe);
    const symbols =
      Array.isArray(body?.symbols) && body.symbols.length > 0
        ? body.symbols.map((s) => String(s).toUpperCase()).filter((s) => STOCK_MAP.has(s))
        : dataset === 'public'
        ? ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'INFY']
        : ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'TATAMOTORS'];

    if (symbols.length === 0) {
      res.status(400).json({ error: 'Select at least one valid NSE symbol.' });
      return;
    }

    // Ensure requested real public historical series (plus NIFTY50 context) are cached cleanly if needed
    if (dataset === 'public') {
      for (const sym of ['NIFTY50', ...symbols]) {
        if (!getCachedRealHistoricalCandles(sym, tf)) {
          try {
            await acquireHistoricalSeries({ symbol: sym, timeframe: tf, excludeFormingBar: true });
          } catch {
            // Non-fatal per symbol; runBacktest falls back safely only if symbol unavailable
          }
        }
      }
    }

    const config: BacktestConfig = {
      symbols,
      strategyId: strategy.id,
      timeframe: tf,
      initialCapital: Math.max(50000, Number(body?.initialCapital || 1000000)),
      riskPerTradePct: Math.max(0.2, Math.min(5, Number(body?.riskPerTradePct || 1.0))),
      brokerageFlatCap: Math.max(0, Number(body?.brokerageFlatCap ?? 20)),
      brokeragePct: Math.max(0, Number(body?.brokeragePct ?? 0.0003)),
      slippageBps: Math.max(0, Math.min(50, Number(body?.slippageBps ?? 5))),
      useOutOfSampleOnly: Boolean(body?.useOutOfSampleOnly ?? true),
      dataset,
      bidAskSpreadBps: clampNum(body?.bidAskSpreadBps, 0, 25, 4),
      partialFillMode: body?.partialFillMode !== false,
      maxParticipationPct: clampNum(body?.maxParticipationPct, 1, 25, 5),
      enforceCostHurdle: body?.enforceCostHurdle !== false,
    };

    const result = runBacktest(config, strategy);
    state.backtestHistory.unshift(result);
    if (state.backtestHistory.length > 25) state.backtestHistory.length = 25;
    saveState(state);

    res.json(result);
  });

  app.get('/api/backtest/history', (_req: Request, res: Response) => {
    const state = loadState();
    res.json({ history: state.backtestHistory });
  });

  // ── Paper Trading & Portfolio ───────────────────────────────────────────────
  app.get('/api/paper/state', (_req: Request, res: Response) => {
    const state = loadState();
    recalculateAccountTotals(state.paperAccount);
    res.json({
      account: state.paperAccount,
      riskConfig: state.riskConfig,
    });
  });

  app.post('/api/paper/order', (req: Request, res: Response) => {
    const body = req.body;
    const symbol = String(body?.symbol || '').toUpperCase().trim();
    const rawSide = body?.side;
    const rawOrderType = body?.orderType ?? 'MARKET';
    const stopLoss = Number(body?.stopLoss);
    const target = Number(body?.target);

    if (!STOCK_MAP.has(symbol)) {
      res.status(400).json({ error: 'Invalid NSE stock symbol.' });
      return;
    }
    if (rawSide !== 'BUY' && rawSide !== 'SELL') {
      res.status(400).json({ error: 'Order side must be BUY or SELL.' });
      return;
    }
    if (rawOrderType !== 'MARKET' && rawOrderType !== 'LIMIT') {
      res.status(400).json({ error: 'Order type must be MARKET or LIMIT.' });
      return;
    }
    if (!Number.isFinite(stopLoss) || !Number.isFinite(target) || stopLoss <= 0 || target <= 0) {
      res.status(400).json({ error: 'Valid positive Stop-Loss and Target prices are required.' });
      return;
    }

    let parsedQty: number | undefined = undefined;
    if (body?.quantity !== undefined && body?.quantity !== null && body?.quantity !== '') {
      const q = Number(body.quantity);
      if (!Number.isFinite(q) || q <= 0 || !Number.isInteger(q)) {
        res.status(400).json({ error: 'Quantity must be a positive whole integer when specified.' });
        return;
      }
      parsedQty = q;
    }

    let parsedLimitPrice: number | undefined = undefined;
    if (rawOrderType === 'LIMIT') {
      const lp = Number(body?.limitPrice);
      if (!Number.isFinite(lp) || lp <= 0) {
        res.status(400).json({ error: 'Valid positive limitPrice is required for LIMIT orders.' });
        return;
      }
      parsedLimitPrice = lp;
    }

    const state = loadState();
    const result = submitPaperOrder(state, {
      clientOrderId: body?.clientOrderId ? String(body.clientOrderId) : undefined,
      predictionId: body?.predictionId ? String(body.predictionId) : undefined,
      symbol,
      side: rawSide,
      orderType: rawOrderType,
      quantity: parsedQty,
      limitPrice: parsedLimitPrice,
      stopLoss,
      target,
      strategyName: String(body?.strategyName || 'Manual Discretionary'),
      regime: body?.regime || 'STRONG_TREND_BULL',
    });

    const statusCode = result.decision.verdict === 'APPROVED' ? 201 : 403;
    res.status(statusCode).json(result);
  });

  app.post('/api/paper/close/:symbol', (req: Request, res: Response) => {
    const symbol = String(req.params.symbol || '').toUpperCase();
    const state = loadState();
    const account = closePaperPosition(state, symbol, 'MANUAL_SQUAREOFF');
    res.json({ account });
  });

  app.post('/api/paper/step', (_req: Request, res: Response) => {
    const state = loadState();
    const account = stepSimulationBar(state);
    res.json({ account });
  });

  app.post('/api/paper/reset', (req: Request, res: Response) => {
    const capital = Math.max(50000, Number(req.body?.initialCapital || 1000000));
    const state = loadState();
    const account = resetPaperAccount(state, capital);
    res.json({ account });
  });

  app.post('/api/alerts/read-all', (_req: Request, res: Response) => {
    const state = loadState();
    for (const a of state.paperAccount.alerts) a.read = true;
    saveState(state);
    res.json({ alerts: state.paperAccount.alerts });
  });

  // ── Risk Management Engine ──────────────────────────────────────────────────
  app.get('/api/risk/state', (_req: Request, res: Response) => {
    const state = loadState();
    recalculateAccountTotals(state.paperAccount);
    res.json({
      riskConfig: state.riskConfig,
      auditLog: state.riskAuditLog,
      accountSummary: {
        totalEquity: state.paperAccount.totalEquity,
        realizedPnlToday: state.paperAccount.realizedPnlToday,
        unrealizedPnl: state.paperAccount.unrealizedPnl,
        usedMargin: state.paperAccount.usedMargin,
        openPositions: state.paperAccount.positions.length,
        tradesToday: state.paperAccount.tradesToday,
        consecutiveLosses: state.paperAccount.consecutiveLosses,
      },
    });
  });

  app.put('/api/risk/config', (req: Request, res: Response) => {
    const state = loadState();
    const body = req.body as Partial<RiskConfig>;
    state.riskConfig = {
      ...state.riskConfig,
      maxLossPerTradePct: clampNum(body.maxLossPerTradePct, 0.2, 5, state.riskConfig.maxLossPerTradePct),
      maxDailyLossInr: clampNum(body.maxDailyLossInr, 1000, 500000, state.riskConfig.maxDailyLossInr),
      maxDrawdownPct: clampNum(body.maxDrawdownPct, 1, 25, state.riskConfig.maxDrawdownPct),
      maxTotalExposurePct: clampNum(body.maxTotalExposurePct, 10, 100, state.riskConfig.maxTotalExposurePct),
      maxStockExposurePct: clampNum(body.maxStockExposurePct, 5, 50, state.riskConfig.maxStockExposurePct),
      maxOpenPositions: Math.round(clampNum(body.maxOpenPositions, 1, 15, state.riskConfig.maxOpenPositions)),
      maxTradesPerDay: Math.round(clampNum(body.maxTradesPerDay, 1, 50, state.riskConfig.maxTradesPerDay)),
      maxConsecutiveLosses: Math.round(clampNum(body.maxConsecutiveLosses, 1, 10, state.riskConfig.maxConsecutiveLosses)),
      minRiskRewardRatio: clampNum(body.minRiskRewardRatio, 1.0, 5.0, state.riskConfig.minRiskRewardRatio),
      enforceMarketHoursCutoff:
        typeof body.enforceMarketHoursCutoff === 'boolean'
          ? body.enforceMarketHoursCutoff
          : state.riskConfig.enforceMarketHoursCutoff,
    };
    saveState(state);
    res.json({ riskConfig: state.riskConfig });
  });

  app.post('/api/risk/kill-switch', (req: Request, res: Response) => {
    const state = loadState();
    const active =
      typeof req.body?.active === 'boolean' ? req.body.active : !state.riskConfig.killSwitchActive;
    state.riskConfig.killSwitchActive = active;

    if (active) {
      // Cancel all pending limit orders safely on kill-switch activation
      for (const ord of state.paperAccount.orders) {
        if (ord.status === 'PENDING') ord.status = 'CANCELLED';
      }
      state.paperAccount.alerts.unshift({
        id: crypto.randomUUID(),
        timestampIst: formatNowIst(),
        severity: 'CRITICAL',
        category: 'RISK',
        title: 'EMERGENCY KILL SWITCH ACTIVATED',
        message: 'All pending orders cancelled and new order admission locked.',
        read: false,
      });
    }

    saveState(state);
    res.json({ killSwitchActive: state.riskConfig.killSwitchActive, account: state.paperAccount });
  });

  // ── Broker Connections Readiness ────────────────────────────────────────────
  app.get('/api/brokers', (_req: Request, res: Response) => {
    res.json({
      liveTradingLocked: true,
      sebiCircularRef: 'SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/0000013 (Feb 4, 2025)',
      adapters: getBrokerAdaptersStatus(),
    });
  });

  // ── Gemini Server-Side Explainability ───────────────────────────────────────
  app.post('/api/ai/explain-signal', async (req: Request, res: Response) => {
    const signal = req.body?.signal;
    if (!signal?.symbol) {
      res.status(400).json({ error: 'Valid signal payload required.' });
      return;
    }
    const result = await explainSignalWithGemini(signal);
    if (!result.available) {
      res.status(503).json(result);
      return;
    }
    res.json(result);
  });

  app.post('/api/ai/market-report', async (req: Request, res: Response) => {
    const state = loadState();
    const tf = parseTimeframe(req.body?.timeframe);
    const snap = computeMarketSnapshot(
      new Set(state.watchlist),
      getAllStrategies(state),
      state.paperAccount.simulationBarOffset,
      tf
    );
    const result = await generateMarketReportWithGemini(snap.overview);
    if (!result.available) {
      res.status(503).json(result);
      return;
    }
    res.json(result);
  });

  app.post('/api/ai/stock-summary', async (req: Request, res: Response) => {
    const symbol = String(req.body?.symbol || '').toUpperCase();
    const meta = STOCK_MAP.get(symbol);
    if (!meta) {
      res.status(400).json({ error: 'Valid NSE symbol required.' });
      return;
    }
    const state = loadState();
    const snap = computeMarketSnapshot(
      new Set(state.watchlist),
      getAllStrategies(state),
      state.paperAccount.simulationBarOffset,
      '5m'
    );
    const row = snap.scanner.find((r) => r.symbol === symbol);
    if (!row) {
      res.status(404).json({ error: 'Symbol snapshot not found.' });
      return;
    }
    const result = await generateStockSummaryWithGemini(row, {
      sector: meta.sector,
      peRatio: meta.peRatio,
      roePct: meta.roePct,
      institutionalHoldingPct: meta.institutionalHoldingPct,
    });
    if (!result.available) {
      res.status(503).json(result);
      return;
    }
    res.json(result);
  });

  // ── MCP Streamable HTTP Endpoint (Bearer Auth Protected) ─────────────────────
  app.post('/mcp', handleMcpHttpRequest);
  app.get('/mcp', handleMcpHttpRequest);
  app.delete('/mcp', handleMcpHttpRequest);

  // ── Server-Side MCP Diagnostics & Safe Tool Invocation ───────────────────────
  app.get('/api/mcp/status', (_req: Request, res: Response) => {
    res.json(mcpClientManager.getStatus());
  });

  app.post('/api/mcp/test', async (_req: Request, res: Response) => {
    const result = await mcpClientManager.testConnection();
    res.status(result.ok ? 200 : 503).json({
      ...result,
      status: mcpClientManager.getStatus(),
    });
  });

  app.post('/api/mcp/invoke', async (req: Request, res: Response) => {
    const toolName = String(req.body?.toolName || '').trim();
    const args = (req.body?.args && typeof req.body.args === 'object' ? req.body.args : {}) as Record<string, unknown>;
    if (!toolName) {
      res.status(400).json({ error: 'toolName is required.' });
      return;
    }
    try {
      const result = await mcpClientManager.callMcpToolForUser(
        'terminal-inspector',
        ['PUBLIC_MARKET', 'RESEARCH_QUANT', 'PORTFOLIO_READ'],
        toolName,
        args
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg.includes('Permission denied') ? 403 : 400).json({ ok: false, error: msg });
    }
  });

  // ── RAG AI Knowledge Base Management & Retrieval ─────────────────────────────
  app.get('/api/rag/documents', (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const collection = typeof req.query.collection === 'string' ? (req.query.collection as any) : 'ALL';
    const status = typeof req.query.status === 'string' ? (req.query.status as any) : 'ALL';
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : undefined;
    res.json(listRagDocuments({ q, collection, status, symbol }));
  });

  app.get('/api/rag/documents/:docId', (req: Request, res: Response) => {
    const found = getRagDocumentById(String(req.params.docId));
    if (!found) {
      res.status(404).json({ error: 'Knowledge base document not found.' });
      return;
    }
    res.json(found);
  });

  app.post('/api/rag/documents', async (req: Request, res: Response) => {
    const role = String(req.headers['x-arthquant-role'] || 'TRADER').toUpperCase();
    if (role !== 'ADMIN') {
      res.status(403).json({
        error: 'Admin permission required to upload or modify Knowledge Base documents (switch role to ADMIN).',
      });
      return;
    }

    try {
      const body = req.body || {};
      const fileName = String(body.fileName || 'document.txt').trim();
      let buffer: Buffer;
      if (typeof body.contentBase64 === 'string' && body.contentBase64.length > 0) {
        buffer = Buffer.from(body.contentBase64, 'base64');
      } else if (typeof body.contentText === 'string' && body.contentText.length > 0) {
        buffer = Buffer.from(body.contentText, 'utf-8');
      } else {
        res.status(400).json({ error: 'Provide either contentBase64 or contentText.' });
        return;
      }

      const doc = await ingestRagDocument({
        fileName,
        buffer,
        mimeType: body.mimeType ? String(body.mimeType) : undefined,
        title: String(body.title || fileName),
        sourceUrl: String(body.sourceUrl || 'local://admin-upload'),
        publisher: String(body.publisher || 'ArthQuant Knowledge Admin'),
        category: String(body.category || 'Uploaded Research'),
        collection: body.collection || 'TRADING_KNOWLEDGE',
        publicationDate: String(body.publicationDate || formatNowIst().slice(0, 10)),
        effectiveDate: body.effectiveDate ? String(body.effectiveDate) : undefined,
        exchangeOrCompany: String(body.exchangeOrCompany || 'NSE'),
        relatedSymbol: body.relatedSymbol ? String(body.relatedSymbol) : undefined,
        supersedeDocId: body.supersedeDocId ? String(body.supersedeDocId) : undefined,
      });

      res.status(201).json({ document: doc });
    } catch (err: any) {
      const status = typeof err?.statusCode === 'number' ? err.statusCode : 400;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Failed to ingest document.',
        existingDocId: err?.existingDocId,
      });
    }
  });

  app.patch('/api/rag/documents/:docId', async (req: Request, res: Response) => {
    const role = String(req.headers['x-arthquant-role'] || 'TRADER').toUpperCase();
    if (role !== 'ADMIN') {
      res.status(403).json({
        error: 'Admin permission required to update Knowledge Base documents.',
      });
      return;
    }

    try {
      const updated = await updateRagDocument(String(req.params.docId), req.body || {});
      res.json({ document: updated });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to update document.',
      });
    }
  });

  app.delete('/api/rag/documents/:docId', async (req: Request, res: Response) => {
    const role = String(req.headers['x-arthquant-role'] || 'TRADER').toUpperCase();
    if (role !== 'ADMIN') {
      res.status(403).json({
        error: 'Admin permission required to delete Knowledge Base documents.',
      });
      return;
    }

    try {
      const result = await deleteRagDocument(String(req.params.docId));
      res.json(result);
    } catch (err) {
      res.status(404).json({
        error: err instanceof Error ? err.message : 'Document not found.',
      });
    }
  });

  app.post('/api/rag/retrieve', async (req: Request, res: Response) => {
    const query = String(req.body?.query || '').trim();
    if (!query) {
      res.status(400).json({ error: 'Search query is required.' });
      return;
    }
    const result = await retrieveRagContext(query, {
      collections: Array.isArray(req.body?.collections) ? req.body.collections : undefined,
      symbol: req.body?.symbol ? String(req.body.symbol) : undefined,
      topK: req.body?.topK ? Number(req.body.topK) : 5,
      includeSuperseded: Boolean(req.body?.includeSuperseded),
    });
    res.json(result);
  });

  // ── Gemini + RAG + MCP Interactive Copilot ──────────────────────────────────
  app.post('/api/ai/copilot', async (req: Request, res: Response) => {
    const query = String(req.body?.query || '').trim();
    if (!query) {
      res.status(400).json({ error: 'Question prompt is required.' });
      return;
    }
    try {
      const preferredSymbol = req.body?.symbol ? String(req.body.symbol) : undefined;
      const result = await runAssistantCopilot({
        query,
        userId: 'terminal-ui',
        preferredSymbol,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Copilot execution failed.',
      });
    }
  });

  // ── Vite Dev Middleware / Production Static Serve ───────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ArthQuant server listening on http://0.0.0.0:${PORT}`);
  });
}

function parseTimeframe(val: unknown): Timeframe {
  if (val === '1m' || val === '5m' || val === '15m') return val;
  return '5m';
}

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});

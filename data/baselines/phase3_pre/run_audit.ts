/**
 * Pre-change baseline audit (code snapshot captured before Phase 3 fixes).
 * Run with: npx tsx data/baselines/phase3_pre/run_audit.ts
 *
 * Uses ONLY deterministic modules from this snapshot so the same script shape can be
 * mirrored against the post-change tree on identical datasets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { computeIndicators } from './server/quant/indicators.ts';
import { trainAndEvaluateWalkForward } from './server/quant/mlEngine.ts';
import { runBacktest } from './server/quant/backtester.ts';
import { BUILTIN_STRATEGIES } from './server/quant/strategies.ts';
import { getResearchCandles } from './server/data/nseUniverse.ts';
import { getCachedRealHistoricalCandles } from './server/data/historicalProvider.ts';

const ML_SYMBOLS = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK'];
const BT_SYMBOLS = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'AXISBANK', 'LT'];

function mlAudit(dataset: 'research' | 'public') {
  const results: Record<string, unknown> = {};
  const nifty =
    dataset === 'public'
      ? getCachedRealHistoricalCandles('NIFTY50', '5m') ?? undefined
      : getResearchCandles('NIFTY50', '5m');
  for (const symbol of ML_SYMBOLS) {
    const candles =
      dataset === 'public'
        ? getCachedRealHistoricalCandles(symbol, '5m')
        : getResearchCandles(symbol, '5m');
    if (!candles || candles.length < 120) {
      results[symbol] = { skipped: true, reason: `insufficient ${dataset} candles` };
      continue;
    }
    const ind = computeIndicators(candles);
    const { evaluation } = trainAndEvaluateWalkForward(
      symbol,
      '5m',
      candles,
      ind,
      0.6,
      dataset === 'public' ? 'PUBLIC_DELAYED_NSE_FEED' : 'RESEARCH_REPLAY',
      { includeModelComparison: true, indexCandles: nifty }
    );
    results[symbol] = {
      bars: candles.length,
      classPrevalence: evaluation.classPrevalence,
      oosSamples: evaluation.oosSamples,
      rocAucUp: evaluation.rocAucApprox,
      rocAucDown: evaluation.shortRocAuc,
      brier: evaluation.brierScore,
      logLoss: evaluation.logLoss,
      ecePct: evaluation.ecePct,
      mcePct: evaluation.mcePct,
      accuracyPct: evaluation.classification?.accuracyPct,
      balancedAccPct: evaluation.classification?.balancedAccPct,
      precisionPct: evaluation.classification?.precisionPct,
      recallPct: evaluation.classification?.recallPct,
      f1Pct: evaluation.classification?.f1Pct,
      confusion: {
        tp: evaluation.classification?.tp,
        fp: evaluation.classification?.fp,
        tn: evaluation.classification?.tn,
        fn: evaluation.classification?.fn,
      },
      threeClass: evaluation.threeClassMetrics,
      folds: evaluation.walkForwardFolds,
      modelComparison: (evaluation.modelComparison ?? []).map((m) => ({
        family: m.modelFamily,
        aucUp: m.rocAucUp,
        aucDown: m.rocAucDown,
        brier: m.brierScore,
        logLoss: m.logLoss,
        ecePct: m.ecePct,
        acc3: m.threeClassAccuracyPct,
        selectiveWinRatePct: m.selectiveWinRatePct,
        selectiveCount: m.selectiveCount,
      })),
      overfittingWarning: evaluation.overfittingWarning,
    };
  }
  return results;
}

function strategyAudit(dataset: 'research' | 'public') {
  const rows: unknown[] = [];
  for (const strategy of BUILTIN_STRATEGIES) {
    const result = runBacktest(
      {
        symbols: BT_SYMBOLS,
        strategyId: strategy.id,
        timeframe: '5m',
        initialCapital: 1_000_000,
        riskPerTradePct: 1.0,
        brokerageFlatCap: 20,
        brokeragePct: 0.0003,
        slippageBps: 5,
        bidAskSpreadBps: 4,
        useOutOfSampleOnly: true,
        dataset,
        enforceCostHurdle: true,
      },
      strategy,
      true
    );
    const r = result as unknown as Record<string, unknown>;
    rows.push({
      id: strategy.id,
      name: strategy.name,
      trades: r.totalTrades,
      winRatePct: r.winRatePct,
      winRateCI: r.winRateCI,
      profitFactor: r.profitFactor,
      expectancyInr: r.expectancyInr,
      netPnl: r.totalNetProfit,
      netReturnPct: r.netReturnPct,
      maxDrawdownPct: r.maxDrawdownPct,
      maxDrawdownInr: r.maxDrawdownInr,
      sharpe: r.portfolioDailySharpe ?? r.sharpeRatio,
      sortino: r.portfolioDailySortino ?? r.sortinoRatio,
      avgBarsHeld: r.avgBarsHeld,
      symbolBreakdown: r.symbolBreakdown,
      regimeBreakdown: r.regimeBreakdown,
      totalCharges: r.totalCharges,
      totalSlippage: r.totalSlippage,
      costHurdleSkipped: r.costHurdleSkippedCount,
      liquiditySkipped: r.liquiditySkippedCount,
      dataSource: r.dataSourceDetails,
      costSensitivity: r.costSensitivity,
      validationNotice: r.validationNotice,
    });
  }
  return rows;
}

const out = {
  phase: 'phase3_pre',
  capturedAtIst: new Date().toISOString(),
  datasets: {
    research: { ml: mlAudit('research'), strategies: strategyAudit('research') },
    public: { ml: mlAudit('public'), strategies: strategyAudit('public') },
  },
};

const outPath = path.resolve(process.cwd(), 'data', 'baselines', 'phase3_pre', 'baseline_metrics.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8');
console.log(`Wrote ${outPath}`);

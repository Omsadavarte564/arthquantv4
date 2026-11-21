import fs from 'node:fs';
import path from 'node:path';
import { LIQUID_NSE_PUBLIC_SYMBOLS } from '../../../server/data/historicalProvider.ts';
import { STOCK_UNIVERSE } from '../../../server/data/nseUniverse.ts';
import { runBacktest } from '../../../server/quant/backtester.ts';
import { computeMonitoringSummary } from '../../../server/quant/monitoringEngine.ts';
import { computeMarketSnapshot } from '../../../server/quant/signals.ts';
import { BUILTIN_STRATEGIES } from '../../../server/quant/strategies.ts';
import { migratePersistedState } from '../../../server/storage/stateStore.ts';
import { Timeframe } from '../../../src/types/trading.ts';

const OUT_DIR = path.resolve(process.cwd(), 'data', 'baselines', 'phase2_post');
const BLUE_CHIPS = ['RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY'];
const ALL_24_RESEARCH = STOCK_UNIVERSE.map((s) => s.symbol);
const ALL_23_PUBLIC = LIQUID_NSE_PUBLIC_SYMBOLS;

function runStrategyAndExecutionAudit() {
  const prePath = path.resolve(process.cwd(), 'data', 'baselines', 'phase2_pre', 'baseline_metrics.json');
  const pre = JSON.parse(fs.readFileSync(prePath, 'utf-8'));

  const run15 = (
    dataset: 'research' | 'public',
    tf: Timeframe,
    symbols: string[],
    opts: any = {},
    includeSensitivity = true
  ) =>
    BUILTIN_STRATEGIES.map((s) => {
      const r = runBacktest(
        {
          symbols,
          strategyId: s.id,
          timeframe: tf,
          initialCapital: 1000000,
          riskPerTradePct: 1.0,
          brokerageFlatCap: 20,
          brokeragePct: 0.0003,
          slippageBps: opts.slippageBps ?? 5,
          useOutOfSampleOnly: true,
          dataset,
          bidAskSpreadBps: opts.bidAskSpreadBps ?? 4,
          partialFillMode: opts.partialFillMode ?? true,
          maxParticipationPct: opts.maxParticipationPct ?? 5,
          enforceCostHurdle: opts.enforceCostHurdle ?? true,
        },
        s,
        includeSensitivity
      );
      return {
        id: s.id,
        name: s.name,
        category: s.category,
        totalTrades: r.totalTrades,
        winRatePct: r.winRatePct,
        winRateCI: r.winRateCI,
        profitFactor: r.profitFactor,
        grossTotalPnl: r.grossTotalPnl,
        totalCharges: r.totalCharges,
        totalSlippage: r.totalSlippage,
        totalSpreadCostInr: r.totalSpreadCostInr,
        totalNetProfit: r.totalNetProfit,
        netReturnPct: r.netReturnPct,
        benchmarkReturnPct: r.benchmarkReturnPct,
        alphaOverBenchmarkPct: r.alphaOverBenchmarkPct,
        expectancyInr: r.expectancyInr,
        maxDrawdownPct: r.maxDrawdownPct,
        sharpeRatio: r.sharpeRatio,
        portfolioDailySharpe: r.portfolioDailySharpe,
        sortinoRatio: r.sortinoRatio,
        avgBarsHeld: r.avgBarsHeld,
        liquiditySkippedCount: r.liquiditySkippedCount,
        partialFillCount: r.partialFillCount,
        avgFillRatioPct: r.avgFillRatioPct,
        costHurdleSkippedCount: r.costHurdleSkippedCount,
        costSensitivity: r.costSensitivity,
        regimeBreakdown: r.regimeBreakdown,
      };
    });

  const t0 = Date.now();
  const research5mAll15After = run15('research', '5m', ALL_24_RESEARCH, {}, true);
  console.log('research5mAll15After done in', Date.now() - t0, 'ms');

  const t1 = Date.now();
  const research5mNoHurdleNoSpread = run15(
    'research',
    '5m',
    ALL_24_RESEARCH,
    { bidAskSpreadBps: 0, partialFillMode: false, enforceCostHurdle: false },
    false
  );
  console.log('research5mNoHurdleNoSpread done in', Date.now() - t1, 'ms');

  const t2 = Date.now();
  const real15mAll15 = run15('public', '15m', ALL_23_PUBLIC, {}, false);
  console.log('real15mAll15 done in', Date.now() - t2, 'ms');

  const t3 = Date.now();
  const real5mAll15 = run15('public', '5m', ALL_23_PUBLIC, {}, false);
  console.log('real5mAll15 done in', Date.now() - t3, 'ms');

  // Detailed cost sensitivity for top strategies on Real 5m & Real 15m
  const keyRealIds = ['vwap-momentum-pullback', 'orb-15-breakout', 'bollinger-mean-reversion', 'regime-adaptive-ensemble'];
  const real5mSensitivity = keyRealIds.map((id) => {
    const s = BUILTIN_STRATEGIES.find((x) => x.id === id)!;
    const r = runBacktest(
      {
        symbols: ALL_23_PUBLIC,
        strategyId: id,
        timeframe: '5m',
        initialCapital: 1000000,
        riskPerTradePct: 1.0,
        brokerageFlatCap: 20,
        brokeragePct: 0.0003,
        slippageBps: 5,
        useOutOfSampleOnly: true,
        dataset: 'public',
        bidAskSpreadBps: 4,
        partialFillMode: true,
        maxParticipationPct: 5,
        enforceCostHurdle: true,
      },
      s,
      true
    );
    return {
      id,
      totalTrades: r.totalTrades,
      netPnl: r.totalNetProfit,
      portfolioDailySharpe: r.portfolioDailySharpe,
      costHurdleSkippedCount: r.costHurdleSkippedCount,
      costSensitivity: r.costSensitivity,
    };
  });

  // Partial fill stress test on active liquid strategy
  const regimeStrat = BUILTIN_STRATEGIES.find((s) => s.id === 'regime-adaptive-ensemble')!;
  const partialFillStress = runBacktest(
    {
      symbols: ['RELIANCE', 'INFY', 'SBIN', 'HDFCBANK'],
      strategyId: regimeStrat.id,
      timeframe: '5m',
      initialCapital: 5000000,
      riskPerTradePct: 1.0,
      brokerageFlatCap: 20,
      brokeragePct: 0.0003,
      slippageBps: 5,
      useOutOfSampleOnly: true,
      dataset: 'public',
      bidAskSpreadBps: 4,
      partialFillMode: true,
      maxParticipationPct: 0.2,
      enforceCostHurdle: true,
    },
    regimeStrat,
    false
  );

  const preMap = new Map<string, any>((pre.stratResults15 || []).map((x: any) => [x.id, x]));
  const beforeVsAfter15 = research5mAll15After.map((after) => {
    const p = preMap.get(after.id);
    return {
      id: after.id,
      name: after.name,
      category: after.category,
      pre: p
        ? {
            trades: p.trades,
            winRatePct: p.winRatePct,
            pf: p.pf,
            netPnl: p.netPnl,
            charges: p.charges,
            sharpe: p.sharpe,
            maxDdPct: p.maxDdPct,
          }
        : null,
      after: {
        trades: after.totalTrades,
        winRatePct: after.winRatePct,
        pf: after.profitFactor,
        netPnl: after.totalNetProfit,
        charges: after.totalCharges,
        spreadCostInr: after.totalSpreadCostInr,
        sharpe: after.sharpeRatio,
        portfolioDailySharpe: after.portfolioDailySharpe,
        maxDdPct: after.maxDrawdownPct,
        costHurdleSkippedCount: after.costHurdleSkippedCount,
      },
    };
  });

  const out = {
    beforeVsAfter15,
    research5mAll15After,
    research5mNoHurdleNoSpread,
    real5mAll15,
    real15mAll15,
    real5mSensitivity,
    partialFillStress: {
      strategyId: regimeStrat.id,
      symbols: ['RELIANCE', 'INFY', 'SBIN', 'HDFCBANK'],
      capital: 5000000,
      maxParticipationPct: 0.2,
      totalTrades: partialFillStress.totalTrades,
      partialFillCount: partialFillStress.partialFillCount,
      avgFillRatioPct: partialFillStress.avgFillRatioPct,
      liquiditySkippedCount: partialFillStress.liquiditySkippedCount,
      costHurdleSkippedCount: partialFillStress.costHurdleSkippedCount,
      netPnl: partialFillStress.totalNetProfit,
      portfolioDailySharpe: partialFillStress.portfolioDailySharpe,
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, 'strategy_execution_audit.json'), JSON.stringify(out, null, 2));
  console.log('Saved strategy_execution_audit.json');
}

function runPaperAudit() {
  const snap5m = computeMarketSnapshot(new Set(BLUE_CHIPS), BUILTIN_STRATEGIES, 0, '5m', false);
  const snapStaleBlocked = computeMarketSnapshot(new Set(BLUE_CHIPS), BUILTIN_STRATEGIES, 0, '5m', true);

  const signalCounts: Record<string, number> = {};
  for (const sig of snap5m.signals) {
    signalCounts[sig.direction] = (signalCounts[sig.direction] ?? 0) + 1;
  }
  const staleCounts: Record<string, number> = {};
  for (const sig of snapStaleBlocked.signals) {
    staleCounts[sig.direction] = (staleCounts[sig.direction] ?? 0) + 1;
  }

  const preStatePath = path.resolve(process.cwd(), 'data', 'baselines', 'phase2_pre', 'arthquant-state.json');
  const curStatePath = path.resolve(process.cwd(), 'data', 'arthquant-state.json');
  const preState = JSON.parse(fs.readFileSync(preStatePath, 'utf-8'));
  const curState = JSON.parse(fs.readFileSync(curStatePath, 'utf-8'));

  const migratedPre = migratePersistedState(preState);
  const curMonitoringSummary = computeMonitoringSummary(
    curState.monitoring,
    curState.paperAccount,
    curState.backtestHistory
  );

  const out = {
    snapshot5mSignalCounts: signalCounts,
    snapshot5mSignalsSample: snap5m.signals.slice(0, 6).map((s) => ({
      symbol: s.symbol,
      direction: s.direction,
      regime: s.regime,
      probUpPct: s.probUpPct,
      probDownPct: s.probDownPct,
      probTimeoutPct: s.probTimeoutPct,
      modelValidated: s.modelValidated,
      estimatedSpreadBps: s.estimatedSpreadBps,
      entryConditions: s.entryConditions,
      reason: s.reason,
    })),
    snapshotStaleEnforcedCounts: staleCounts,
    migrationVerification: {
      preSchemaVersion: preState.schemaVersion ?? 'undefined',
      migratedSchemaVersion: migratedPre.schemaVersion,
      preClosedTrades: preState.paperAccount?.closedTrades?.length ?? 0,
      migratedClosedTrades: migratedPre.paperAccount.closedTrades.length,
      prePredictionLedger: preState.monitoring?.predictionLedger?.length ?? 0,
      migratedPredictionLedger: migratedPre.monitoring.predictionLedger.length,
      preCustomStrategies: preState.customStrategies?.length ?? 0,
      migratedCustomStrategies: migratedPre.customStrategies.length,
      registeredModelsCount: migratedPre.monitoring.modelVersions.length,
    },
    currentStateMonitoring: {
      schemaVersion: curState.schemaVersion,
      totalPredictions: curMonitoringSummary.totalPredictions,
      resolvedPredictions: curMonitoringSummary.resolvedPredictions,
      pendingPredictions: curMonitoringSummary.pendingPredictions,
      dailyReports: curMonitoringSummary.dailyReports,
      weeklyReports: curMonitoringSummary.weeklyReports,
      modelVersions: curMonitoringSummary.modelVersions.map((m) => ({
        modelVersion: m.modelVersion,
        active: m.active,
        oosBrierScore: m.oosBrierScore,
        ecePct: m.ecePct,
      })),
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, 'paper_audit.json'), JSON.stringify(out, null, 2));
  console.log('Saved paper_audit.json');
}

runStrategyAndExecutionAudit();
runPaperAudit();

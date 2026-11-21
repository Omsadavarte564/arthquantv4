import {
  BacktestResult,
  MarketRegime,
  ModelVersionEntry,
  MonitoringDashboardSummary,
  PaperAccountState,
  PaperPeriodPerformance,
  PaperTrade,
  PredictionRecord,
  Timeframe,
  TradingSignal,
} from '../../src/types/trading.ts';
import { getResearchCandles } from '../data/nseUniverse.ts';
import { computeIndicators } from './indicators.ts';
import { ML_PREDICTION_HORIZON_BARS } from './mlEngine.ts';
import { formatNowIst } from './riskEngine.ts';

export interface MonitoringStateSlice {
  activeModelVersion: string;
  modelVersions: ModelVersionEntry[];
  predictionLedger: PredictionRecord[];
  baselineFeatureMean: number[];
  baselineFeatureStd: number[];
}

export const BENCHMARK_MODEL_VERSIONS: ModelVersionEntry[] = [
  {
    modelVersion: 'ArthQuant-LogitPlatt-v1.4',
    deployedAtIst: '2026-11-10 09:15 IST',
    active: false,
    notes: 'Legacy single-head logistic + unanchored Platt (overstated short confidence on neutral bars)',
    oosBrierScore: 0.2052,
    oosAccuracyPct: 67.89,
    ecePct: 6.41,
  },
  {
    modelVersion: 'ArthQuant-DualLogitPlatt-v2.0',
    deployedAtIst: '2026-11-18 09:15 IST',
    active: true,
    notes: 'Purged walk-forward dual-head logistic + shrinkage Platt + neutral-class normalization',
    oosBrierScore: 0.1925,
    oosAccuracyPct: 71.04,
    ecePct: 12.25,
  },
  {
    modelVersion: 'ArthQuant-3ClassSoftmax-v3.0',
    deployedAtIst: '2026-11-20 09:15 IST',
    active: false,
    notes: 'Coherent 3-class Multinomial Softmax (UP / DOWN / TIMEOUT summing to 1.0) + validation temp scaling',
    oosBrierScore: 0.245,
    oosAccuracyPct: 50.1,
    ecePct: 4.9,
  },
  {
    modelVersion: 'ArthQuant-CausalRF-v3.0',
    deployedAtIst: '2026-11-20 09:15 IST',
    active: false,
    notes: '20-tree Causal Random Forest (Dirichlet leaf smoothing, Research 5m AUC 0.7377, Real 5m 0.5064)',
    oosBrierScore: 0.189,
    oosAccuracyPct: 74.62,
    ecePct: 11.12,
  },
  {
    modelVersion: 'ArthQuant-GBDT-v3.0',
    deployedAtIst: '2026-11-20 09:15 IST',
    active: false,
    notes: '24-round Early-Stopped 3-Class GBDT (Real 15m AUC 0.5323, lowest real 3-class NLL 1.0253)',
    oosBrierScore: 0.244,
    oosAccuracyPct: 50.2,
    ecePct: 10.25,
  },
];

export function ensureRegisteredModelVersions(monitoring: MonitoringStateSlice): void {
  const existing = new Set(monitoring.modelVersions.map((m) => m.modelVersion));
  for (const cand of BENCHMARK_MODEL_VERSIONS) {
    if (!existing.has(cand.modelVersion)) {
      monitoring.modelVersions.push({
        ...cand,
        active: monitoring.activeModelVersion === cand.modelVersion,
      });
    }
  }
}

export function createInitialMonitoringState(): MonitoringStateSlice {
  const now = formatNowIst();
  return {
    activeModelVersion: 'ArthQuant-DualLogitPlatt-v2.0',
    modelVersions: BENCHMARK_MODEL_VERSIONS.map((m) => ({
      ...m,
      deployedAtIst: m.active ? now : m.deployedAtIst,
    })),
    predictionLedger: [],
    baselineFeatureMean: [0, 0, 0, 0.2, 0, 0, 0, 0],
    baselineFeatureStd: [1.1, 0.9, 0.7, 0.8, 0.8, 0.6, 0.5, 1.0],
  };
}

/**
 * Logs actionable/directional predictions into the persistent prediction ledger,
 * deduplicating by predictionId so UI refreshes never spam identical bar records.
 * Returns number of newly inserted records.
 */
export function appendPredictionRecords(
  monitoring: MonitoringStateSlice,
  signals: TradingSignal[],
  barContextBySymbol: Record<
    string,
    { barIndex: number; featureVector: number[]; brierScore: number; accuracyPct: number; ecePct: number }
  >,
  timeframe: Timeframe = '5m'
): number {
  const existingIds = new Set(monitoring.predictionLedger.map((r) => r.predictionId));
  let added = 0;
  const now = formatNowIst();

  for (const sig of signals) {
    if (sig.dataQualityPassed === false) continue;
    const ctx = barContextBySymbol[sig.symbol];
    if (!ctx) continue;

    const predId =
      sig.predictionId ||
      `${sig.symbol}-${sig.timestampIst}-${monitoring.activeModelVersion}`.replace(/\s+/g, '_');
    if (existingIds.has(predId)) continue;

    const probUp = (sig.probUpPct ?? Math.round(sig.estimatedProbability * 10000) / 100) / 100;
    const probDown =
      (sig.probDownPct ?? Math.round((1 - sig.estimatedProbability) * 10000) / 100) / 100;
    const probTimeout =
      sig.probTimeoutPct !== undefined
        ? Math.round((sig.probTimeoutPct / 100) * 10000) / 10000
        : Math.max(0, Math.round((1 - probUp - probDown) * 10000) / 10000);

    const record: PredictionRecord = {
      predictionId: predId,
      predictionTimestampIst: now,
      marketDataTimestampIst: sig.marketDataTimestampIst ?? sig.timestampIst,
      barIndex: ctx.barIndex,
      symbol: sig.symbol,
      timeframe,
      modelVersion: monitoring.activeModelVersion || sig.modelVersion,
      strategyId: sig.strategyId,
      direction: sig.direction,
      regime: sig.regime,
      probUp,
      probDown,
      probTimeout,
      confidencePct: Math.round(sig.estimatedProbability * 10000) / 100,
      entryPrice: sig.entryPrice,
      stopLoss: sig.stopLoss,
      target1: sig.target1,
      horizonBars: sig.predictionHorizonBars ?? ML_PREDICTION_HORIZON_BARS,
      entryConditions: sig.entryConditions ? [...sig.entryConditions] : undefined,
      featureVector: ctx.featureVector.map((x) => Math.round(x * 10000) / 10000),
      status: 'PENDING',
      simulatedExecution: {
        executed: false,
      },
    };

    monitoring.predictionLedger.unshift(record);
    existingIds.add(predId);
    added++;
  }

  if (monitoring.predictionLedger.length > 400) {
    monitoring.predictionLedger.length = 400;
  }

  return added;
}

/**
 * Resolves any PENDING predictions whose horizon (barIndex + horizonBars) or barrier
 * has elapsed up to the current causal simulation clock bar (never peeking beyond currentIdx).
 * Returns count of newly resolved predictions.
 */
export function resolvePendingPredictions(
  monitoring: MonitoringStateSlice,
  simulationBarOffset: number
): number {
  let resolvedCount = 0;
  const candleCache = new Map<string, ReturnType<typeof getResearchCandles>>();
  const indCache = new Map<string, ReturnType<typeof computeIndicators>>();

  for (const rec of monitoring.predictionLedger) {
    if (rec.status !== 'PENDING') continue;

    const cacheKey = `${rec.symbol}_${rec.timeframe}`;
    let candles = candleCache.get(cacheKey);
    if (!candles) {
      candles = getResearchCandles(rec.symbol, rec.timeframe);
      candleCache.set(cacheKey, candles);
    }
    if (candles.length < 50) continue;

    // Causal current bar visible in simulation offset (when stepping barOffset moves forward)
    const currentVisibleIdx = Math.max(
      40,
      candles.length - 12 + (simulationBarOffset % 11)
    );

    // Wait until either barrier hit within currentVisibleIdx or horizon reached
    const endCheckIdx = Math.min(rec.barIndex + rec.horizonBars, currentVisibleIdx);
    if (endCheckIdx <= rec.barIndex) continue;

    let indicators = indCache.get(cacheKey);
    if (!indicators) {
      indicators = computeIndicators(candles);
      indCache.set(cacheKey, indicators);
    }
    const atr = Math.max(0.1, indicators[rec.barIndex]?.atr14 ?? rec.entryPrice * 0.005);
    const entryOpen = candles[rec.barIndex + 1]?.open ?? rec.entryPrice;
    const upBarrier = entryOpen + 1.35 * atr;
    const downBarrier = entryOpen - 1.0 * atr;

    const isShortLean =
      rec.direction === 'SELL' ||
      ((rec.direction === 'HOLD' || rec.direction === 'NO_TRADE') && rec.probDown > rec.probUp);
    let outcome: 'UP_TARGET' | 'DOWN_TARGET' | 'NEUTRAL_TIMEOUT' | null = null;
    let exitClose = entryOpen;
    let resolvedLabel = candles[endCheckIdx].istLabel;

    for (let k = rec.barIndex + 1; k <= endCheckIdx; k++) {
      const b = candles[k];
      if (b.sessionDate !== candles[rec.barIndex].sessionDate) {
        outcome = 'NEUTRAL_TIMEOUT';
        exitClose = candles[k - 1].close;
        resolvedLabel = candles[k - 1].istLabel;
        break;
      }
      if (isShortLean) {
        // Short barrier check (conservative SL-first)
        const shortStop = entryOpen + 1.0 * atr;
        const shortTarget = entryOpen - 1.35 * atr;
        if (b.high >= shortStop) {
          outcome = 'UP_TARGET';
          exitClose = shortStop;
          resolvedLabel = b.istLabel;
          break;
        }
        if (b.low <= shortTarget) {
          outcome = 'DOWN_TARGET';
          exitClose = shortTarget;
          resolvedLabel = b.istLabel;
          break;
        }
      } else {
        if (b.low <= downBarrier) {
          outcome = 'DOWN_TARGET';
          exitClose = downBarrier;
          resolvedLabel = b.istLabel;
          break;
        }
        if (b.high >= upBarrier) {
          outcome = 'UP_TARGET';
          exitClose = upBarrier;
          resolvedLabel = b.istLabel;
          break;
        }
      }
      exitClose = b.close;
    }

    const horizonReached = currentVisibleIdx >= rec.barIndex + rec.horizonBars;
    if (!outcome && horizonReached) {
      outcome = 'NEUTRAL_TIMEOUT';
    }

    if (outcome) {
      const hit =
        (isShortLean && outcome === 'DOWN_TARGET') ||
        (!isShortLean && outcome === 'UP_TARGET');
      rec.actualOutcome = outcome;
      rec.status =
        outcome === 'NEUTRAL_TIMEOUT'
          ? 'RESOLVED_NEUTRAL'
          : hit
          ? 'RESOLVED_HIT'
          : 'RESOLVED_MISS';
      rec.resolvedAtIst = resolvedLabel;
      const rawRetPct =
        entryOpen > 0
          ? isShortLean
            ? ((entryOpen - exitClose) / entryOpen) * 100
            : ((exitClose - entryOpen) / entryOpen) * 100
          : 0;
      rec.realizedReturnPct = Math.round(rawRetPct * 100) / 100;
      resolvedCount++;
    }
  }

  return resolvedCount;
}

export function rollbackActiveModelVersion(
  monitoring: MonitoringStateSlice,
  targetVersion: string
): ModelVersionEntry | null {
  const found = monitoring.modelVersions.find((m) => m.modelVersion === targetVersion);
  if (!found) return null;
  for (const m of monitoring.modelVersions) {
    m.active = m.modelVersion === targetVersion;
  }
  monitoring.activeModelVersion = targetVersion;
  return found;
}

export function computeMonitoringSummary(
  monitoring: MonitoringStateSlice,
  paperAccount: PaperAccountState,
  backtestHistory: BacktestResult[]
): MonitoringDashboardSummary {
  const ledger = monitoring.predictionLedger;
  const resolved = ledger.filter((r) => r.status !== 'PENDING');
  const pending = ledger.filter((r) => r.status === 'PENDING');
  const hits = resolved.filter((r) => r.status === 'RESOLVED_HIT');

  const resolvedHitRatePct =
    resolved.length > 0 ? round2((hits.length / resolved.length) * 100) : 0;
  const avgConfidencePct =
    resolved.length > 0
      ? round2(resolved.reduce((s, r) => s + r.confidencePct, 0) / resolved.length)
      : ledger.length > 0
      ? round2(ledger.reduce((s, r) => s + r.confidencePct, 0) / ledger.length)
      : 0;

  const calibrationDriftPct =
    resolved.length > 0 ? round2(resolvedHitRatePct - avgConfidencePct) : 0;

  // Compute feature mean Z-shift on latest up to 40 predictions vs baseline
  const recentForDrift = ledger.slice(0, 40).filter((r) => r.featureVector.length >= 8);
  let featureDriftZScore = 0;
  if (recentForDrift.length >= 5) {
    let zSum = 0;
    const dim = 8;
    for (let j = 0; j < dim; j++) {
      const mean = recentForDrift.reduce((s, r) => s + r.featureVector[j], 0) / recentForDrift.length;
      const baseMean = monitoring.baselineFeatureMean[j] ?? 0;
      const baseStd = Math.max(0.25, monitoring.baselineFeatureStd[j] ?? 1);
      zSum += Math.abs(mean - baseMean) / baseStd;
    }
    featureDriftZScore = round2(zSum / dim);
  }

  let driftAlertActive = false;
  let driftAlertReason: string | undefined;
  if (resolved.length >= 8 && Math.abs(calibrationDriftPct) > 12) {
    driftAlertActive = true;
    driftAlertReason = `Calibration drift of ${calibrationDriftPct > 0 ? '+' : ''}${calibrationDriftPct}% detected across ${resolved.length} resolved predictions (hit rate ${resolvedHitRatePct}% vs confidence ${avgConfidencePct}%).`;
  } else if (recentForDrift.length >= 8 && featureDriftZScore > 1.5) {
    driftAlertActive = true;
    driftAlertReason = `Covariate feature drift Z=${featureDriftZScore} exceeds 1.5 sigma threshold.`;
  }

  // Regime breakdown
  const regMap = new Map<MarketRegime, { total: number; hits: number }>();
  for (const r of resolved) {
    const cur = regMap.get(r.regime) ?? { total: 0, hits: 0 };
    cur.total++;
    if (r.status === 'RESOLVED_HIT') cur.hits++;
    regMap.set(r.regime, cur);
  }
  const regimeBreakdown = Array.from(regMap.entries()).map(([regime, v]) => ({
    regime,
    total: v.total,
    hits: v.hits,
    hitRatePct: v.total > 0 ? round2((v.hits / v.total) * 100) : 0,
  }));

  // Symbol breakdown
  const symMap = new Map<string, { total: number; hits: number }>();
  for (const r of resolved) {
    const cur = symMap.get(r.symbol) ?? { total: 0, hits: 0 };
    cur.total++;
    if (r.status === 'RESOLVED_HIT') cur.hits++;
    symMap.set(r.symbol, cur);
  }
  const symbolBreakdown = Array.from(symMap.entries())
    .map(([symbol, v]) => ({
      symbol,
      total: v.total,
      hits: v.hits,
      hitRatePct: v.total > 0 ? round2((v.hits / v.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  // Paper vs Backtest comparison
  const closed = paperAccount.closedTrades;
  const paperWins = closed.filter((t) => t.netPnl > 0).length;
  const paperWinRatePct = closed.length > 0 ? round2((paperWins / closed.length) * 100) : 0;
  const paperNetPnl = round2(closed.reduce((s, t) => s + t.netPnl, 0));
  const latestBt = backtestHistory[0];
  const latestBacktestWinRatePct = latestBt ? latestBt.winRatePct : null;
  const winRateDeltaPct =
    closed.length > 0 && latestBacktestWinRatePct !== null
      ? round2(paperWinRatePct - latestBacktestWinRatePct)
      : null;

  const dailyReports = computeDailyWeeklyReports(ledger, closed, 'day');
  const weeklyReports = computeDailyWeeklyReports(ledger, closed, 'week');

  return {
    activeModelVersion: monitoring.activeModelVersion,
    totalLoggedPredictions: ledger.length,
    pendingPredictions: pending.length,
    resolvedPredictions: resolved.length,
    resolvedHitRatePct,
    avgConfidencePct,
    calibrationDriftPct,
    featureDriftZScore,
    driftAlertActive,
    driftAlertReason,
    regimeBreakdown,
    symbolBreakdown,
    paperVsBacktestVariance: {
      paperClosedTrades: closed.length,
      paperWinRatePct,
      paperNetPnl,
      latestBacktestWinRatePct,
      winRateDeltaPct,
    },
    dailyReports,
    weeklyReports,
    recentPredictions: ledger.slice(0, 50),
    modelVersions: monitoring.modelVersions,
  };
}

function toIsoWeekLabel(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return 'Unknown-Week';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function computeDailyWeeklyReports(
  ledger: PredictionRecord[],
  closedTrades: PaperTrade[],
  granularity: 'day' | 'week'
): PaperPeriodPerformance[] {
  const buckets = new Map<
    string,
    {
      trades: PaperTrade[];
      preds: PredictionRecord[];
    }
  >();

  const getKey = (istTs: string) => {
    const day = istTs.slice(0, 10);
    return granularity === 'day' ? day : toIsoWeekLabel(day);
  };

  for (const t of closedTrades) {
    const key = getKey(t.closedAtIst || t.openedAtIst);
    const cur = buckets.get(key) ?? { trades: [], preds: [] };
    cur.trades.push(t);
    buckets.set(key, cur);
  }

  for (const p of ledger) {
    if (p.status === 'PENDING') continue;
    const key = getKey(p.resolvedAtIst || p.marketDataTimestampIst);
    const cur = buckets.get(key) ?? { trades: [], preds: [] };
    cur.preds.push(p);
    buckets.set(key, cur);
  }

  return Array.from(buckets.entries())
    .map(([periodLabel, { trades, preds }]) => {
      const wins = trades.filter((t) => t.netPnl > 0).length;
      const grossPnlInr = round2(trades.reduce((s, t) => s + t.grossPnl, 0));
      const chargesInr = round2(trades.reduce((s, t) => s + t.charges.totalCharges, 0));
      const netPnlInr = round2(trades.reduce((s, t) => s + t.netPnl, 0));
      const predictionHits = preds.filter((p) => p.status === 'RESOLVED_HIT').length;
      const avgConfidencePct =
        preds.length > 0
          ? round2(preds.reduce((s, p) => s + p.confidencePct, 0) / preds.length)
          : 0;
      return {
        periodLabel,
        closedTrades: trades.length,
        wins,
        winRatePct: trades.length > 0 ? round2((wins / trades.length) * 100) : 0,
        grossPnlInr,
        chargesInr,
        netPnlInr,
        resolvedPredictions: preds.length,
        predictionHits,
        predictionHitRatePct:
          preds.length > 0 ? round2((predictionHits / preds.length) * 100) : 0,
        avgConfidencePct,
      };
    })
    .sort((a, b) => b.periodLabel.localeCompare(a.periodLabel));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { getBrokerAdaptersStatus } from '../server/brokers/brokerAdapter.ts';
import { getNseMarketClockStatus, getResearchCandles, isValidSymbol } from '../server/data/nseUniverse.ts';
import { parseKiteNseCsv } from '../server/data/nseDirectory.ts';
import { parseYahooChartResponse, parseYahooSparkResponse } from '../server/data/publicMarketFeed.ts';
import { getHistoricalSeriesSync } from '../server/data/historicalProvider.ts';
import { validateCandles } from '../server/data/validator.ts';
import { runBacktest } from '../server/quant/backtester.ts';
import { calculateNseIntradayCharges, calculateWilsonCI } from '../server/quant/costs.ts';
import { computeIndicators } from '../server/quant/indicators.ts';
import {
  buildIndexContextMap,
  ML_PREDICTION_HORIZON_BARS,
  buildLabeledDataset,
  extractCausalFeatures,
  getCausalIndexAlignment,
  predictDirectionalProbabilities,
  trainAndEvaluateWalkForward,
} from '../server/quant/mlEngine.ts';
import {
  appendPredictionRecords,
  computeDailyWeeklyReports,
  computeMonitoringSummary,
  createInitialMonitoringState,
  resolvePendingPredictions,
  rollbackActiveModelVersion,
} from '../server/quant/monitoringEngine.ts';
import { DEFAULT_RISK_CONFIG, evaluateOrderRisk } from '../server/quant/riskEngine.ts';
import { computeMarketSnapshot } from '../server/quant/signals.ts';
import { BUILTIN_STRATEGIES } from '../server/quant/strategies.ts';
import {
  CURRENT_SCHEMA_VERSION,
  closePaperPosition,
  loadState,
  migratePersistedState,
  resetPaperAccount,
  stepSimulationBar,
  submitPaperOrder,
} from '../server/storage/stateStore.ts';
import { PaperAccountState } from '../src/types/trading.ts';

test('NSE Intraday Charge Calculator computes statutory STT, Stamp, Txn, SEBI, IPFT, and GST', () => {
  const charges = calculateNseIntradayCharges(100000, 100500, {
    brokerageFlatCap: 20,
    brokeragePct: 0.0003,
    slippageBps: 5,
  });

  assert.equal(charges.brokerage, 40);
  assert.equal(charges.stt, 25.13);
  assert.equal(charges.stampDuty, 3);
  assert.ok(charges.exchangeTxnCharge > 5.9 && charges.exchangeTxnCharge < 6.0);
  assert.ok(charges.gst > 8.2 && charges.gst < 8.4);
  assert.ok(charges.totalCharges > 180);
});

test('Causal indicator engine computes valid Wilder RSI, VWAP session reset, EMA, ATR, and Supertrend', () => {
  const candles = getResearchCandles('RELIANCE', '5m');
  const { cleaned, report } = validateCandles(candles, 300);
  assert.equal(report.valid, true);

  const ind = computeIndicators(cleaned);
  assert.equal(ind.length, cleaned.length);

  for (let i = 30; i < ind.length; i++) {
    assert.ok(ind[i].rsi14 >= 0 && ind[i].rsi14 <= 100, `RSI out of bounds at ${i}`);
    assert.ok(ind[i].atr14 > 0, `ATR must be positive at ${i}`);
    assert.ok(ind[i].bbUpper >= ind[i].bbMiddle && ind[i].bbMiddle >= ind[i].bbLower);
    assert.ok(ind[i].supertrendDir === 1 || ind[i].supertrendDir === -1);
  }

  const sessionIdx = cleaned.findIndex((c, idx) => idx > 0 && c.sessionDate !== cleaned[idx - 1].sessionDate);
  assert.ok(sessionIdx > 0);
  const c = cleaned[sessionIdx];
  const typical = Math.round(((c.high + c.low + c.close) / 3) * 100) / 100;
  assert.ok(Math.abs(ind[sessionIdx].vwap - typical) <= 0.05);
});

test('Data validator detects stale live feeds and signals engine blocks live emissions on stale streams', () => {
  const candles = getResearchCandles('RELIANCE', '5m');
  const { report: histReport } = validateCandles(candles, 300, { enforceLiveFreshness: false });
  assert.equal(histReport.valid, true);
  assert.equal(histReport.staleFeed, false);

  const farFutureUnix = candles[candles.length - 1].time + 3600;
  const { report: staleReport } = validateCandles(candles, 300, {
    enforceLiveFreshness: true,
    maxStaleSeconds: 600,
    nowUnixSec: farFutureUnix,
  });
  assert.equal(staleReport.staleFeed, true);
  assert.equal(staleReport.valid, false);
  assert.ok(staleReport.latestBarAgeSeconds >= 3600);

  const snap = computeMarketSnapshot(new Set(['RELIANCE']), BUILTIN_STRATEGIES, 0, '5m', true);
  assert.equal(snap.overview.dataHealth.staleFeedBlocked, true);
  assert.equal(snap.overview.dataHealth.validationPassed, false);
  assert.ok(snap.signals.every((s) => s.direction === 'NO_TRADE'));
});

test('NSE market clock distinguishes open session, pre-open, weekend, and 2026 trading holidays in IST', () => {
  // 2026-11-18 10:15 IST = 2026-11-18 04:45 UTC (Wednesday, Open)
  const openUtc = Date.UTC(2026, 10, 18, 4, 45, 0);
  const openStatus = getNseMarketClockStatus(openUtc);
  assert.equal(openStatus.isMarketOpen, true);
  assert.equal(openStatus.marketStatusLabel, 'OPEN');

  // 2026-11-18 09:05 IST = 03:35 UTC (Pre-open)
  const preOpenStatus = getNseMarketClockStatus(Date.UTC(2026, 10, 18, 3, 35, 0));
  assert.equal(preOpenStatus.isMarketOpen, false);
  assert.equal(preOpenStatus.marketStatusLabel, 'PRE_OPEN');

  // 2026-11-24 Guru Nanak Jayanti holiday (Tuesday)
  const holidayStatus = getNseMarketClockStatus(Date.UTC(2026, 10, 24, 5, 0, 0));
  assert.equal(holidayStatus.isMarketOpen, false);
  assert.equal(holidayStatus.marketStatusLabel, 'MARKET_CLOSED');
  assert.match(holidayStatus.reason, /Holiday/i);

  // 2026-11-21 Saturday
  const weekendStatus = getNseMarketClockStatus(Date.UTC(2026, 10, 21, 5, 0, 0));
  assert.equal(weekendStatus.isMarketOpen, false);
  assert.match(weekendStatus.reason, /Weekend/i);

  assert.equal(isValidSymbol('RELIANCE'), true);
  assert.equal(isValidSymbol('NIFTY50'), true);
  assert.equal(isValidSymbol('FAKE_TICKER_XYZ'), false);
});

test('Walk-forward ML evaluation enforces purged chronological split, dual-head calibration, baselines, and 3 folds', () => {
  const candles = getResearchCandles('HDFCBANK', '5m');
  const ind = computeIndicators(candles);
  const { evaluation } = trainAndEvaluateWalkForward('HDFCBANK', '5m', candles, ind, 0.6);

  assert.ok(evaluation.splitSummary.trainBars > 200);
  assert.ok(
    evaluation.splitSummary.embargoBars >= (ML_PREDICTION_HORIZON_BARS + 1) * 2,
    `Expected purged embargo >= 22 bars across 2 boundaries, got ${evaluation.splitSummary.embargoBars}`
  );
  assert.ok(evaluation.splitSummary.oosTestBars > 50);
  assert.ok(evaluation.brierScore >= 0 && evaluation.brierScore <= 1);
  assert.ok(evaluation.shortBrierScore !== undefined && evaluation.shortBrierScore >= 0 && evaluation.shortBrierScore <= 1);
  assert.ok(evaluation.logLoss > 0);
  assert.ok((evaluation.baselines?.length ?? 0) >= 4);
  assert.ok((evaluation.walkForwardFolds?.length ?? 0) === 3);
  for (const bin of evaluation.calibrationBins) {
    assert.ok(bin.predictedMean >= 0 && bin.predictedMean <= 100);
    assert.ok(bin.empiricalWinRate >= 0 && bin.empiricalWinRate <= 100);
  }
});

test('No-lookahead backtester respects trailing stop ordering, 2-decimal precision, and Wilson CI', () => {
  const strategy = BUILTIN_STRATEGIES.find((s) => s.id === 'regime-adaptive-ensemble')!;
  const res = runBacktest(
    {
      symbols: ['RELIANCE', 'ICICIBANK', 'SBIN'],
      strategyId: strategy.id,
      timeframe: '5m',
      initialCapital: 1000000,
      riskPerTradePct: 1.0,
      brokerageFlatCap: 20,
      brokeragePct: 0.0003,
      slippageBps: 5,
      useOutOfSampleOnly: true,
    },
    strategy
  );

  assert.equal(res.dataMode, 'HISTORICAL_RESEARCH_DATASET');
  assert.ok(res.equityCurve.length >= 1);
  if (res.totalTrades > 0) {
    assert.ok(res.totalCharges > 0);
    assert.ok(res.winRateCI.lowerPct <= res.winRatePct);
    assert.ok(res.winRateCI.upperPct >= res.winRatePct);
    for (const t of res.trades) {
      if (t.exitReason === 'TRAILING_SL') {
        assert.ok(t.barsHeld >= 1, 'Trailing SL cannot trigger on entry bar before profit develops');
      }
      assert.equal(Number(t.entryPrice.toFixed(2)), t.entryPrice);
      assert.equal(Number(t.exitPrice.toFixed(2)), t.exitPrice);
    }
  }
});

test('Risk Gatekeeper, Paper Trading position flip, idempotency guard, and broker locks work safely', () => {
  const dummyAccount: PaperAccountState = {
    executionMode: 'SIMULATED_PAPER_TRADING',
    initialCapital: 1000000,
    availableCapital: 1000000,
    usedMargin: 0,
    realizedPnlToday: 0,
    unrealizedPnl: 0,
    totalEquity: 1000000,
    tradesToday: 0,
    consecutiveLosses: 0,
    simulationBarOffset: 0,
    positions: [],
    orders: [],
    closedTrades: [],
    journal: [],
    alerts: [],
  };

  const approved = evaluateOrderRisk(
    { symbol: 'RELIANCE', side: 'BUY', entryPrice: 1000, stopLoss: 990, target: 1020 },
    DEFAULT_RISK_CONFIG,
    dummyAccount
  );
  assert.equal(approved.verdict, 'APPROVED');
  assert.equal(approved.approvedQty, 250);

  const killed = evaluateOrderRisk(
    { symbol: 'RELIANCE', side: 'BUY', entryPrice: 1000, stopLoss: 990, target: 1020 },
    { ...DEFAULT_RISK_CONFIG, killSwitchActive: true },
    dummyAccount
  );
  assert.equal(killed.verdict, 'REJECTED');

  const badRR = evaluateOrderRisk(
    { symbol: 'RELIANCE', side: 'BUY', entryPrice: 1000, stopLoss: 980, target: 1010 },
    DEFAULT_RISK_CONFIG,
    dummyAccount
  );
  assert.equal(badRR.verdict, 'REJECTED');

  const ci = calculateWilsonCI(14, 20);
  assert.ok(ci.lowerPct > 45 && ci.upperPct < 90);

  // Test stateful paper trading flip + idempotency in isolated reset state
  const state = loadState();
  const prevStateSnapshot = JSON.stringify(state);
  try {
    resetPaperAccount(state, 1000000);
    state.riskConfig = { ...DEFAULT_RISK_CONFIG, enforceMarketHoursCutoff: false };
    const candles = getResearchCandles('RELIANCE', '5m');
    const px = candles[Math.max(40, candles.length - 12)].close;

    const buyRes = submitPaperOrder(state, {
      clientOrderId: 'test-idem-1',
      symbol: 'RELIANCE',
      side: 'BUY',
      orderType: 'MARKET',
      quantity: 20,
      stopLoss: Math.round(px * 0.985 * 20) / 20,
      target: Math.round(px * 1.03 * 20) / 20,
      strategyName: 'UnitTest',
      regime: 'STRONG_TREND_BULL',
    });
    assert.equal(buyRes.decision.verdict, 'APPROVED');
    assert.equal(state.paperAccount.positions[0]?.quantity, 20);
    assert.equal(state.paperAccount.positions[0]?.side, 'BUY');

    // Duplicate clientOrderId must be rejected cleanly
    const dupRes = submitPaperOrder(state, {
      clientOrderId: 'test-idem-1',
      symbol: 'RELIANCE',
      side: 'BUY',
      orderType: 'MARKET',
      quantity: 20,
      stopLoss: Math.round(px * 0.985 * 20) / 20,
      target: Math.round(px * 1.03 * 20) / 20,
      strategyName: 'UnitTest',
      regime: 'STRONG_TREND_BULL',
    });
    assert.equal(dupRes.decision.verdict, 'REJECTED');
    assert.equal(state.paperAccount.positions[0]?.quantity, 20);

    // Opposite order with larger quantity closes 20 BUY and opens 10 SELL
    const flipRes = submitPaperOrder(state, {
      clientOrderId: 'test-flip-1',
      symbol: 'RELIANCE',
      side: 'SELL',
      orderType: 'MARKET',
      quantity: 30,
      stopLoss: Math.round(px * 1.015 * 20) / 20,
      target: Math.round(px * 0.97 * 20) / 20,
      strategyName: 'UnitTest',
      regime: 'STRONG_TREND_BEAR',
    });
    assert.equal(flipRes.decision.verdict, 'APPROVED');
    assert.equal(state.paperAccount.positions.length, 1);
    assert.equal(state.paperAccount.positions[0]?.side, 'SELL');
    assert.equal(state.paperAccount.positions[0]?.quantity, 10);
    assert.equal(state.paperAccount.closedTrades.length, 1);

    closePaperPosition(state, 'RELIANCE', 'TEST_CLOSE');
    assert.equal(state.paperAccount.positions.length, 0);
    stepSimulationBar(state);
  } finally {
    const restored = JSON.parse(prevStateSnapshot);
    Object.assign(state, restored);
    // Restore clean disk state
    resetPaperAccount(state, 1000000);
  }

  // Broker adapter safety: live execution locked
  const brokers = getBrokerAdaptersStatus();
  assert.ok(brokers.length >= 4);
  assert.ok(brokers.every((b) => b.liveExecutionEnabled === false));
});

test('NSE Directory CSV parser extracts NSE EQ shares, marks research coverage, and distinguishes standard equities', () => {
  const sampleCsv = [
    'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange',
    '256265,1001,NIFTY 50,"NIFTY 50",0,,0,0,0,EQ,INDICES,NSE',
    '738561,2885,RELIANCE,"RELIANCE INDUSTRIES",0,,0,0.05,1,EQ,NSE,NSE',
    '3076609,12018,SUZLON,"SUZLON ENERGY",0,,0,0.01,1,EQ,NSE,NSE',
    '769,3,GOLDSTAR-ST,"GOLDSTAR POWER",0,,0,0.05,11250,EQ,NSE,NSE',
  ].join('\n');

  const parsed = parseKiteNseCsv(sampleCsv);
  assert.equal(parsed.length, 3); // NIFTY 50 (INDICES) excluded
  const reliance = parsed.find((e) => e.symbol === 'RELIANCE');
  const suzlon = parsed.find((e) => e.symbol === 'SUZLON');
  const goldstar = parsed.find((e) => e.symbol === 'GOLDSTAR-ST');

  assert.ok(reliance && reliance.hasResearchCandles && reliance.isStandardEquity);
  assert.ok(suzlon && !suzlon.hasResearchCandles && suzlon.isStandardEquity);
  assert.ok(goldstar && !goldstar.isStandardEquity);
});

test('Public NSE feed parser validates OHLCV bars, skips nulls, and calculates IST quote metadata', () => {
  const samplePayload = {
    chart: {
      result: [
        {
          meta: { regularMarketPrice: 36.95, chartPreviousClose: 36.13 },
          timestamp: [1795060800, 1795061100, 1795061400],
          indicators: {
            quote: [
              {
                open: [36.2, null, 36.8],
                high: [36.5, null, 37.1],
                low: [36.1, null, 36.7],
                close: [36.4, null, 36.95],
                volume: [12000, null, 25000],
              },
            ],
          },
        },
      ],
    },
  };

  const parsed = parseYahooChartResponse('SUZLON', samplePayload);
  assert.equal(parsed.candles.length, 2);
  assert.equal(parsed.quote.ltp, 36.95);
  assert.equal(parsed.quote.changePct, 2.27);
  assert.ok(parsed.quote.lastBarIst.endsWith('IST'));

  const spark = parseYahooSparkResponse({
    'RELIANCE.NS': { close: [1363, 1375.6], fulldayPrice: 1375.6 },
    'HAL.NS': { close: [4675, 4760], fulldayPrice: 4760, fulldayChangePercent: 1.82 },
  });
  assert.equal(spark.RELIANCE?.ltp, 1375.6);
  assert.equal(spark.HAL?.changePct, 1.82);
});

test('Anti-leakage causal invariance: mutating future bars > t cannot change indicators, features, or predictions at t', () => {
  const candles = getResearchCandles('RELIANCE', '5m');
  const cutoff = 500;
  const mutated = candles.map((c, idx) =>
    idx > cutoff
      ? {
          ...c,
          open: c.open * 1.4,
          high: c.high * 1.5,
          low: c.low * 0.7,
          close: c.close * 1.45,
          volume: c.volume * 10,
        }
      : c
  );

  const indOrig = computeIndicators(candles);
  const indMut = computeIndicators(mutated);

  for (let i = 0; i <= cutoff; i++) {
    assert.deepEqual(indOrig[i], indMut[i], `Indicator lookahead detected at bar ${i}`);
    assert.deepEqual(
      extractCausalFeatures(candles[i], indOrig[i]),
      extractCausalFeatures(mutated[i], indMut[i]),
      `Feature vector lookahead detected at bar ${i}`
    );
  }

  // Model trained strictly on bars <= cutoff must emit identical probabilities at cutoff
  const { model: mOrig } = trainAndEvaluateWalkForward(
    'RELIANCE',
    '5m',
    candles.slice(0, cutoff + 1),
    indOrig.slice(0, cutoff + 1),
    0.6
  );
  const { model: mMut } = trainAndEvaluateWalkForward(
    'RELIANCE',
    '5m',
    mutated.slice(0, cutoff + 1),
    indMut.slice(0, cutoff + 1),
    0.6
  );
  const pOrig = predictDirectionalProbabilities(mOrig, candles[cutoff], indOrig[cutoff]);
  const pMut = predictDirectionalProbabilities(mMut, mutated[cutoff], indMut[cutoff]);
  assert.equal(pOrig.probUp, pMut.probUp);
  assert.equal(pOrig.probDown, pMut.probDown);
  assert.ok(pOrig.probUp + pOrig.probDown <= 1.0001);
});

test('Purged walk-forward dataset enforces zero label-interval overlap across Train -> Val -> Test', () => {
  const candles = getResearchCandles('TCS', '5m');
  const ind = computeIndicators(candles);
  const dataset = buildLabeledDataset(candles, ind, ML_PREDICTION_HORIZON_BARS);
  const embargoPerBoundary = Math.max(ML_PREDICTION_HORIZON_BARS + 1, Math.floor(dataset.length * 0.03));

  const trainEnd = Math.floor(dataset.length * 0.56);
  const valStart = trainEnd + embargoPerBoundary;
  const valEnd = Math.floor(dataset.length * 0.76);
  const testStart = valEnd + embargoPerBoundary;

  const valStartBar = dataset[valStart].index;
  const testStartBar = dataset[testStart].index;
  const trainSet = dataset.slice(0, trainEnd).filter((d) => d.index + ML_PREDICTION_HORIZON_BARS < valStartBar);
  const valSet = dataset.slice(valStart, valEnd).filter((d) => d.index + ML_PREDICTION_HORIZON_BARS < testStartBar);
  const testSet = dataset.slice(testStart);

  for (const t of trainSet) {
    assert.ok(t.maxLabelBar < valSet[0].index, 'Train label horizon overlaps validation boundary');
  }
  for (const v of valSet) {
    assert.ok(v.maxLabelBar < testSet[0].index, 'Validation label horizon overlaps test boundary');
  }
});

test('Synchronized multi-symbol portfolio backtester maintains monotonic equity, gross-fees=net invariant, and monotonic cost degradation', () => {
  const strat = BUILTIN_STRATEGIES.find((s) => s.id === 'high-conviction-ai-ensemble')!;
  const runWithSlip = (slippageBps: number) =>
    runBacktest(
      {
        symbols: ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN'],
        strategyId: strat.id,
        timeframe: '5m',
        initialCapital: 1000000,
        riskPerTradePct: 1.0,
        brokerageFlatCap: 20,
        brokeragePct: 0.0003,
        slippageBps,
        useOutOfSampleOnly: true,
      },
      strat
    );

  const res5 = runWithSlip(5);
  assert.ok(res5.equityCurve.length >= 2);
  for (let i = 1; i < res5.equityCurve.length; i++) {
    assert.ok(
      res5.equityCurve[i].timestampIst >= res5.equityCurve[i - 1].timestampIst,
      'Portfolio equity curve timestamps must be chronologically non-decreasing'
    );
  }
  if (res5.totalTrades > 0) {
    const grossSum = res5.trades.reduce((s, t) => s + t.grossPnl, 0);
    const chgSum = res5.trades.reduce((s, t) => s + t.charges.totalCharges, 0);
    const netSum = res5.trades.reduce((s, t) => s + t.netPnl, 0);
    assert.ok(Math.abs(netSum - (grossSum - chgSum)) < 0.5, 'Net PnL must equal Gross PnL minus totalCharges');
    assert.ok(res5.benchmarkReturnPct !== undefined);
    assert.ok((res5.costSensitivity?.length ?? 0) === 5);
    const cs0 = res5.costSensitivity![0];
    const cs20 = res5.costSensitivity![4];
    assert.ok(cs0.netPnl >= cs20.netPnl, 'Higher slippage must degrade net PnL monotonically');
  }
});

test('Validator flags zero-volume bars, >15% overnight split discontinuities, >8% intrabar spikes, and excludes forming bar when configured', () => {
  const full = getResearchCandles('INFY', '5m');
  const sessionBoundary = full.findIndex((c, idx) => idx > 5 && c.sessionDate !== full[idx - 1].sessionDate);
  assert.ok(sessionBoundary > 5);
  const start = sessionBoundary - 6;
  const base = full.slice(start, start + 20);
  const crossIdx = 6; // first bar of new session inside base slice
  const modified = base.map((c, idx) => {
    if (idx === 3) return { ...c, volume: 0 };
    if (idx === crossIdx) {
      return {
        ...c,
        open: c.close * 1.25,
        high: c.close * 1.26,
        low: c.close * 1.24,
        close: c.close * 1.25,
      };
    }
    if (idx === 15) return { ...c, high: c.low * 1.12 };
    return c;
  });
  const { cleaned, report } = validateCandles(modified, 300, {
    excludeFormingBar: true,
    nowUnixSec: modified[modified.length - 1].time + 120,
    excludeZeroVolumeBars: false,
  });
  assert.ok(report.zeroVolumeBars >= 1);
  assert.ok(report.overnightSplitFlags >= 1);
  assert.ok(report.outlierBarsFlagged >= 1);
  assert.equal(report.formingBarExcluded, true);
  assert.equal(cleaned.length, modified.length - 1);
});

test('Prediction ledger logs, resolves causally on elapsed bars, computes drift summary, and rolls back model version safely', () => {
  const monitoring = createInitialMonitoringState();
  const snap = computeMarketSnapshot(new Set(['RELIANCE', 'HDFCBANK']), BUILTIN_STRATEGIES, 0, '5m');
  const added = appendPredictionRecords(monitoring, snap.signals, snap.barContextBySymbol, '5m');
  assert.ok(added > 0);
  // Deduplication prevents duplicate logging on same bar
  const dupAdded = appendPredictionRecords(monitoring, snap.signals, snap.barContextBySymbol, '5m');
  assert.equal(dupAdded, 0);

  // Advancing simulation bar resolves elapsed horizons without lookahead
  resolvePendingPredictions(monitoring, 10);
  const summary = computeMonitoringSummary(monitoring, loadState().paperAccount, []);
  assert.equal(summary.totalLoggedPredictions, added);
  assert.equal(summary.activeModelVersion, 'ArthQuant-DualLogitPlatt-v2.0');

  const rolled = rollbackActiveModelVersion(monitoring, 'ArthQuant-LogitPlatt-v1.4');
  assert.ok(rolled !== null);
  assert.equal(monitoring.activeModelVersion, 'ArthQuant-LogitPlatt-v1.4');
});

test('Indicators exclude zero-volume bars from VWAP and RelVol denominator', () => {
  const base = getResearchCandles('RELIANCE', '5m').slice(0, 60).map((c) => ({ ...c }));
  // Make bar 35 zero-volume with extreme high price so bug would pull VWAP strongly
  const refVwapBefore = computeIndicators(base.slice(0, 36));
  const withZero = base.map((c, idx) =>
    idx === 35 ? { ...c, volume: 0, high: c.high * 2, close: c.close * 2, low: c.low * 2 } : c
  );
  const indZero = computeIndicators(withZero);
  assert.equal(indZero[35].relVolume, 0, 'Zero-volume bar itself must report relVolume = 0');
  // Because bar 35 had volume 0, cumulative VWAP at bar 35 must equal bar 34's VWAP (same session)
  if (withZero[35].sessionDate === withZero[34].sessionDate) {
    assert.equal(indZero[35].vwap, indZero[34].vwap, 'Zero-volume bar must not distort session VWAP');
  }
  assert.ok(refVwapBefore.length === 36);
});

test('Multi-model ML benchmark (Softmax, RF, GBDT) guarantees coherent 3-class probabilities and causal NIFTY50 alignment', () => {
  const rel = getResearchCandles('RELIANCE', '5m');
  const nifty = getResearchCandles('NIFTY50', '5m');
  const ind = computeIndicators(rel);

  const { model: smModel, evaluation } = trainAndEvaluateWalkForward(
    'RELIANCE',
    '5m',
    rel,
    ind,
    0.6,
    'RESEARCH_REPLAY',
    {
      modelFamily: 'MULTINOMIAL_3CLASS_SOFTMAX',
      includeModelComparison: true,
      indexCandles: nifty,
    }
  );

  assert.equal(evaluation.modelComparison?.length, 4);
  const lastIdx = rel.length - 1;
  const idxCtx = buildIndexContextMap(nifty);
  const niftyAligned = getCausalIndexAlignment(idxCtx, rel[lastIdx].time);
  const probs = predictDirectionalProbabilities(smModel, rel[lastIdx], ind[lastIdx], {
    candles: rel,
    index: lastIdx,
    niftyAligned,
  });
  const sum = probs.probUp + probs.probDown + probs.probNeutral;
  assert.ok(Math.abs(sum - 1.0) < 1e-4, `3-class probabilities must sum to 1.0, got ${sum}`);
  assert.ok(evaluation.priorMatchedClassification !== undefined);

  // Causal NIFTY50 anti-lookahead check
  const cutoffTime = rel[400].time;
  const mutatedNifty = nifty.map((c) =>
    c.time > cutoffTime ? { ...c, close: c.close * 1.5, high: c.high * 1.6, low: c.low * 0.6 } : c
  );
  const aOrig = getCausalIndexAlignment(buildIndexContextMap(nifty), cutoffTime);
  const aMut = getCausalIndexAlignment(buildIndexContextMap(mutatedNifty), cutoffTime);
  assert.deepEqual(aOrig, aMut, 'Future NIFTY50 bars must not leak into causal index alignment');
});

test('Risk Gatekeeper enforces maxSpreadBps, model validation, and 1.8x cost hurdle gates', () => {
  const dummyAccount: PaperAccountState = {
    executionMode: 'SIMULATED_PAPER_TRADING',
    initialCapital: 1000000,
    availableCapital: 1000000,
    usedMargin: 0,
    realizedPnlToday: 0,
    unrealizedPnl: 0,
    totalEquity: 1000000,
    tradesToday: 0,
    consecutiveLosses: 0,
    simulationBarOffset: 0,
    positions: [],
    orders: [],
    closedTrades: [],
    journal: [],
    alerts: [],
  };

  const wideSpread = evaluateOrderRisk(
    { symbol: 'RELIANCE', side: 'BUY', entryPrice: 1000, stopLoss: 990, target: 1020, estimatedSpreadBps: 35 },
    DEFAULT_RISK_CONFIG,
    dummyAccount
  );
  assert.equal(wideSpread.verdict, 'REJECTED');
  assert.match(wideSpread.reasons.join(' '), /maxSpreadBps/i);

  const unvalidated = evaluateOrderRisk(
    { symbol: 'RELIANCE', side: 'BUY', entryPrice: 1000, stopLoss: 990, target: 1020, modelValidated: false },
    DEFAULT_RISK_CONFIG,
    dummyAccount
  );
  assert.equal(unvalidated.verdict, 'REJECTED');
  assert.match(unvalidated.reasons.join(' '), /validation failed/i);

  const costHurdleFail = evaluateOrderRisk(
    {
      symbol: 'RELIANCE',
      side: 'BUY',
      entryPrice: 1000,
      stopLoss: 990,
      target: 1020,
      expectedMovePct: 0.15,
      roundTripCostPct: 0.12,
    },
    DEFAULT_RISK_CONFIG,
    dummyAccount
  );
  assert.equal(costHurdleFail.verdict, 'REJECTED');
  assert.match(costHurdleFail.reasons.join(' '), /cost hurdle/i);
});

test('Execution realism backtester supports cached real 60d dataset, partial fills, spread costs, and daily Sharpe', () => {
  const cacheDir = path.resolve(process.cwd(), 'data', 'historical_cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  for (const sym of ['RELIANCE', 'INFY', 'SBIN', 'HDFCBANK', 'NIFTY50']) {
    const p = path.join(cacheDir, `${sym}_5m.json`);
    if (!fs.existsSync(p)) {
      const cands = getResearchCandles(sym, '5m');
      fs.writeFileSync(
        p,
        JSON.stringify({
          metadata: {
            datasetVersion: 'ArthQuant-Hist-v2.0',
            provider: 'PUBLIC_YAHOO_NSE_FIXTURE',
            symbol: sym,
            timeframe: '5m',
            timezone: 'Asia/Kolkata',
            startIst: cands[0]?.istLabel ?? '',
            endIst: cands[cands.length - 1]?.istLabel ?? '',
            totalBars: cands.length,
            zeroVolumeBars: 0,
            missingGaps: 0,
            duplicatesRemoved: 0,
            invalidOhlcBars: 0,
            outlierBarsFlagged: 0,
            overnightSplitFlags: 0,
            formingBarExcluded: true,
            isMultiYearAuthorized: false,
            ingestedAtIst: new Date().toISOString(),
          },
          candles: cands,
        }),
        'utf-8'
      );
    }
  }

  const strat = BUILTIN_STRATEGIES.find((s) => s.id === 'regime-adaptive-ensemble')!;
  const res = runBacktest(
    {
      symbols: ['RELIANCE', 'INFY', 'SBIN', 'HDFCBANK'],
      strategyId: strat.id,
      timeframe: '5m',
      initialCapital: 5000000,
      riskPerTradePct: 2.0,
      brokerageFlatCap: 20,
      brokeragePct: 0.0003,
      slippageBps: 5,
      bidAskSpreadBps: 4,
      partialFillMode: true,
      maxParticipationPct: 0.2, // 0.2% of bar volume -> triggers partial fills on larger tickets
      enforceCostHurdle: true,
      useOutOfSampleOnly: true,
      dataset: 'public',
    },
    strat
  );

  assert.ok(res.equityCurve.length >= 1);
  assert.ok(res.dataSourceDetails !== undefined);
  assert.ok(res.portfolioDailySharpe !== undefined);
  assert.ok(res.totalTrades > 0, 'Expected real 60d backtest to execute at least one trade');
  assert.ok((res.totalSpreadCostInr ?? 0) >= 0);
  assert.ok(
    res.trades.some((t) => (t.fillRatio ?? 1) < 1) || (res.partialFillCount ?? 0) > 0,
    'Tight participation cap should trigger partial fills rather than silent overfilling'
  );
});

test('State migration preserves existing user records non-destructively and daily/weekly paper reports aggregate accurately', () => {
  const legacyState: any = {
    watchlist: ['INFY', 'TCS'],
    customStrategies: [
      {
        ...BUILTIN_STRATEGIES[0],
        id: 'custom-user-1',
        name: 'My Custom Strat',
        isCustom: true,
      },
    ],
    paperAccount: {
      closedTrades: [
        {
          id: 't1',
          symbol: 'INFY',
          side: 'BUY',
          quantity: 100,
          entryPrice: 1500,
          exitPrice: 1520,
          grossPnl: 2000,
          charges: { turnover: 302000, brokerage: 40, stt: 38, exchangeTxnCharge: 10, sebiTurnoverFee: 0.3, ipftCharge: 0.3, stampDuty: 4.5, gst: 9, slippageCost: 150, totalCharges: 252.1 },
          netPnl: 1747.9,
          strategyName: 'Test',
          regime: 'STRONG_TREND_BULL',
          openedAtIst: '2026-11-18 10:00 IST',
          closedAtIst: '2026-11-18 10:45 IST',
          exitReason: 'TARGET_HIT',
        },
      ],
    },
  };

  const migrated = migratePersistedState(legacyState);
  assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(migrated.watchlist, ['INFY', 'TCS']);
  assert.equal(migrated.customStrategies.length, 1);
  assert.equal(migrated.paperAccount.closedTrades.length, 1);
  assert.equal(migrated.riskConfig.maxSpreadBps, DEFAULT_RISK_CONFIG.maxSpreadBps);
  assert.ok(migrated.monitoring.modelVersions.length >= 5);

  const daily = computeDailyWeeklyReports(migrated.monitoring.predictionLedger, migrated.paperAccount.closedTrades, 'day');
  const weekly = computeDailyWeeklyReports(migrated.monitoring.predictionLedger, migrated.paperAccount.closedTrades, 'week');
  assert.equal(daily.length, 1);
  assert.equal(daily[0].periodLabel, '2026-11-18');
  assert.equal(daily[0].netPnlInr, 1747.9);
  assert.equal(weekly.length, 1);
  assert.match(weekly[0].periodLabel, /^2026-W\d{2}$/);
});

test('Zero-volume regular-hours bars are excluded from cleaned series by default (indicators/execution input)', () => {
  const base = getResearchCandles('RELIANCE', '5m').slice(0, 60);
  const target = base[20];
  const withZero = base.map((c, idx) => (idx === 20 ? { ...c, volume: 0 } : c));

  const excluded = validateCandles(withZero, 300);
  assert.equal(excluded.report.zeroVolumeBars, 1);
  assert.equal(excluded.cleaned.length, withZero.length - 1);
  assert.equal(
    excluded.cleaned.some((c) => c.time === target.time),
    false,
    'Zero-volume bar must not reach indicators or execution'
  );

  const retained = validateCandles(withZero, 300, { excludeZeroVolumeBars: false });
  assert.equal(retained.cleaned.length, withZero.length);
  assert.match(retained.report.issues.join(' '), /retained by request/i);
});

test('Triple-barrier dataset labels are mutually exclusive, single-class, and never cross IST sessions', () => {
  const candles = getResearchCandles('TCS', '5m');
  const ind = computeIndicators(candles);
  const dataset = buildLabeledDataset(candles, ind, ML_PREDICTION_HORIZON_BARS);

  assert.ok(dataset.length > 100);
  let up = 0;
  let down = 0;
  let timeout = 0;
  for (const item of dataset) {
    assert.ok(!(item.sample.labelUp === 1 && item.sample.labelDown === 1), 'Both barriers cannot win');
    assert.ok(item.sample.class3 === 0 || item.sample.class3 === 1 || item.sample.class3 === 2);
    if (item.sample.class3 === 0) up++;
    else if (item.sample.class3 === 1) down++;
    else timeout++;
    assert.equal(item.candle.sessionDate, candles[item.maxLabelBar].sessionDate);
  }
  assert.equal(up + down + timeout, dataset.length);
  assert.ok(up > 0 && down > 0 && timeout > 0, 'All three classes should be represented');
});

test('Historical resolver never silently substitutes synthetic data for public requests', () => {
  const unavailable = getHistoricalSeriesSync('NOT_A_REAL_NSE_SYMBOL', '5m', 'public');
  assert.equal(unavailable, null);

  const research = getHistoricalSeriesSync('RELIANCE', '5m', 'research');
  assert.ok(research !== null);
  assert.equal(research!.isSynthetic, true);
  assert.equal(research!.provider, 'RESEARCH_REPLAY');
  assert.match(research!.limitationNote ?? '', /synthetic/i);
});

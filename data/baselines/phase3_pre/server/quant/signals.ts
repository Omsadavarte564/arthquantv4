import crypto from 'node:crypto';
import {
  DataHealthStatus,
  MarketOverviewResponse,
  MarketRegime,
  ScannerRow,
  SectorPerformance,
  SignalDirection,
  StrategyConfig,
  Timeframe,
  TradingSignal,
} from '../../src/types/trading.ts';
import {
  getNseMarketClockStatus,
  getResearchCandles,
  STOCK_UNIVERSE,
} from '../data/nseUniverse.ts';
import { validateCandles } from '../data/validator.ts';
import { calculateNseIntradayCharges } from './costs.ts';
import { computeIndicators } from './indicators.ts';
import {
  buildIndexContextMap,
  getCausalIndexAlignment,
  ML_PREDICTION_HORIZON_BARS,
  extractCausalFeatures,
  predictDirectionalProbabilities,
  trainAndEvaluateWalkForward,
} from './mlEngine.ts';
import { classifyRegime } from './regime.ts';
import { DEFAULT_RISK_CONFIG } from './riskEngine.ts';
import { evaluateStrategyAtBar } from './strategies.ts';

export interface SignalBarContext {
  barIndex: number;
  featureVector: number[];
  brierScore: number;
  accuracyPct: number;
  ecePct: number;
}

/**
 * Generates current scanner snapshot & causal trading signals across the NSE universe
 * using validated candles, NIFTY50 index context, 3-class probabilities, and NO_TRADE safety gates.
 */
export function computeMarketSnapshot(
  watchlistSymbols: Set<string>,
  strategies: StrategyConfig[],
  barOffset = 0,
  timeframe: Timeframe = '5m',
  enforceLiveFeedFreshness = false
): {
  scanner: ScannerRow[];
  signals: TradingSignal[];
  overview: MarketOverviewResponse;
  barContextBySymbol: Record<string, SignalBarContext>;
} {
  const scanner: ScannerRow[] = [];
  const signals: TradingSignal[] = [];
  const barContextBySymbol: Record<string, SignalBarContext> = {};

  const adaptiveStrategy =
    strategies.find((s) => s.id === 'high-conviction-ai-ensemble' && s.enabled) ??
    strategies.find((s) => s.id === 'regime-adaptive-ensemble' && s.enabled) ??
    strategies[0];

  const niftyCandlesAll = getResearchCandles('NIFTY50', timeframe);
  const niftyContextFull = buildIndexContextMap(niftyCandlesAll);

  let advances = 0;
  let declines = 0;
  let unchanged = 0;
  let latestIstLabel = '';
  let missingDataCount = 0;
  let anyStaleFeed = false;
  const validationNotes: string[] = [];

  for (const meta of STOCK_UNIVERSE) {
    const raw = getResearchCandles(meta.symbol, timeframe);
    const stepSec = timeframe === '1m' ? 60 : timeframe === '15m' ? 900 : 300;
    const { cleaned: candles, report } = validateCandles(raw, stepSec, {
      enforceLiveFreshness: enforceLiveFeedFreshness,
    });
    missingDataCount += report.gapsDetected + report.invalidOhlcBars;
    if (report.staleFeed) anyStaleFeed = true;
    if (candles.length < 80) continue;

    const idx = Math.max(40, candles.length - 12 + (barOffset % 11));
    const bar = candles[idx];
    latestIstLabel = bar.istLabel;

    let sessionOpen = bar.open;
    for (let k = idx; k >= 0; k--) {
      if (candles[k].sessionDate !== bar.sessionDate) break;
      sessionOpen = candles[k].open;
    }

    const prefixCandles = candles.slice(0, idx + 1);
    const indicators = computeIndicators(prefixCandles);
    const ind = indicators[indicators.length - 1];
    const regime = classifyRegime(bar, ind);
    const causalNiftyCandles = niftyCandlesAll.filter((c) => c.time <= bar.time);
    const niftyAligned = getCausalIndexAlignment(niftyContextFull, bar.time);

    const { model, evaluation } = trainAndEvaluateWalkForward(
      meta.symbol,
      timeframe,
      prefixCandles,
      indicators,
      0.6,
      'RESEARCH_REPLAY',
      { indexCandles: causalNiftyCandles }
    );
    const histCtx = { candles: prefixCandles, index: prefixCandles.length - 1, niftyAligned };
    const { probUp, probDown, probNeutral } = predictDirectionalProbabilities(
      model,
      bar,
      ind,
      histCtx
    );
    const featureVec = extractCausalFeatures(bar, ind, histCtx);

    const modelValidated =
      evaluation.rocAucApprox >= 0.55 &&
      evaluation.brierScore < 0.245 &&
      (evaluation.ecePct ?? 0) <= 15.0;

    barContextBySymbol[meta.symbol] = {
      barIndex: idx,
      featureVector: featureVec,
      brierScore: evaluation.brierScore,
      accuracyPct: evaluation.oosRawWinRatePct,
      ecePct: evaluation.ecePct ?? 0,
    };

    const changePct = sessionOpen > 0 ? round2(((bar.close - sessionOpen) / sessionOpen) * 100) : 0;
    if (changePct > 0.05) advances++;
    else if (changePct < -0.05) declines++;
    else unchanged++;

    const vwapDistPct = ind.vwap > 0 ? round2(((bar.close - ind.vwap) / ind.vwap) * 100) : 0;
    const atrPct = bar.close > 0 ? round2((ind.atr14 / bar.close) * 100) : 0;
    const estimatedSpreadBps = 4;

    let bestSide: SignalDirection = 'NO_TRADE';
    let bestReason = '';
    let bestStrategy = adaptiveStrategy;
    const entryConditions: string[] = [
      `DataValid=${report.valid && !report.staleFeed}`,
      `BarVol=${bar.volume} (RelVol=${ind.relVolume}x)`,
      `Regime=${regime}`,
      `OOS_AUC=${evaluation.rocAucApprox}, Brier=${evaluation.brierScore}`,
    ];

    if (!report.valid || report.staleFeed) {
      bestSide = 'NO_TRADE';
      bestReason = report.staleFeed
        ? `Stale feed blocked (${report.latestBarAgeSeconds}s old) — live signal generation halted`
        : 'Data validation failed';
    } else if (bar.volume <= 0) {
      bestSide = 'NO_TRADE';
      bestReason = 'Zero-volume bar detected — excluded from signal execution';
    } else if (regime === 'UNCERTAIN_CHOP') {
      bestSide = 'NO_TRADE';
      bestReason = `Market regime is UNCERTAIN_CHOP (ADX ${ind.adx14}, RelVol ${ind.relVolume}x) — capital preservation active`;
    } else if (estimatedSpreadBps > DEFAULT_RISK_CONFIG.maxSpreadBps) {
      bestSide = 'NO_TRADE';
      bestReason = `Estimated spread ${estimatedSpreadBps} bps exceeds maxSpreadBps (${DEFAULT_RISK_CONFIG.maxSpreadBps} bps)`;
    } else {
      for (const strat of strategies.filter((s) => s.enabled)) {
        const isAiDependent =
          strat.id === 'high-conviction-ai-ensemble' || strat.id === 'regime-adaptive-ensemble';
        if (isAiDependent && !modelValidated) {
          continue;
        }
        const res = evaluateStrategyAtBar(
          strat,
          prefixCandles,
          indicators,
          indicators.length - 1,
          regime,
          probUp,
          probDown
        );
        if (res.side) {
          bestSide = res.side;
          bestReason = res.reason;
          bestStrategy = strat;
          entryConditions.push(`MatchedStrategy=${strat.id}`);
          break;
        }
      }
      if (bestSide === 'NO_TRADE') {
        const dominantDirProb = Math.max(probUp, probDown);
        if (!modelValidated) {
          bestSide = 'NO_TRADE';
          bestReason = `OOS ML validation gate failed (AUC ${evaluation.rocAucApprox}, Brier ${evaluation.brierScore}) — NO_TRADE abstention`;
        } else {
          bestSide =
            dominantDirProb >= 0.57 && Math.abs(probUp - probDown) >= 0.08 ? 'HOLD' : 'NO_TRADE';
          bestReason =
            bestSide === 'HOLD'
              ? `Directional lean (P_up=${(probUp * 100).toFixed(1)}%, P_down=${(probDown * 100).toFixed(1)}%) without strategy trigger confluence`
              : `No active strategy entry setup triggered in ${regime}`;
        }
      }
    }

    const atr = Math.max(0.25, ind.atr14);
    const slDist = roundTick(atr * bestStrategy.stopLossAtrMult);
    const t1Dist = roundTick(atr * bestStrategy.target1AtrMult);
    const t2Dist = roundTick(atr * bestStrategy.target2AtrMult);

    const isBear = bestSide === 'SELL' || (bestSide === 'HOLD' && probDown > probUp);
    const entryPrice = roundTick(bar.close);
    const stopLoss = roundTick(isBear ? entryPrice + slDist : entryPrice - slDist);
    const target1 = roundTick(isBear ? entryPrice - t1Dist : entryPrice + t1Dist);
    const target2 = roundTick(isBear ? entryPrice - t2Dist : entryPrice + t2Dist);
    const riskRewardRatio = slDist > 0 ? round2(t1Dist / slDist) : 0;

    // 1.8x expected-move cost hurdle + minimum R/R enforcement on actionable signals
    const repQty = Math.max(1, Math.floor(100000 / Math.max(1, entryPrice)));
    const repTurnover = entryPrice * repQty;
    const estCharges = calculateNseIntradayCharges(repTurnover, repTurnover, {
      brokerageFlatCap: 20,
      brokeragePct: 0.0003,
      slippageBps: 5,
    });
    const spreadInr = repTurnover * (estimatedSpreadBps / 10000);
    const roundTripCostPct = ((estCharges.totalCharges + spreadInr) / Math.max(1, repTurnover)) * 100;
    const expectedMovePct = (t1Dist / Math.max(1, entryPrice)) * 100;
    entryConditions.push(
      `CostHurdle=${expectedMovePct.toFixed(3)}% vs ${(roundTripCostPct * 1.8).toFixed(3)}%`,
      `RR=${riskRewardRatio}:1`
    );

    if (bestSide === 'BUY' || bestSide === 'SELL') {
      if (riskRewardRatio < DEFAULT_RISK_CONFIG.minRiskRewardRatio) {
        bestSide = 'NO_TRADE';
        bestReason = `Risk/Reward ${riskRewardRatio}:1 below minimum ${DEFAULT_RISK_CONFIG.minRiskRewardRatio}:1 — NO_TRADE`;
      } else if (expectedMovePct < roundTripCostPct * 1.8) {
        bestSide = 'NO_TRADE';
        bestReason = `Expected move ${expectedMovePct.toFixed(3)}% fails 1.8x NSE cost hurdle (${(roundTripCostPct * 1.8).toFixed(3)}%) — NO_TRADE`;
      }
    }

    const estProb = isBear ? probDown : probUp;
    const modelConfidence: 'HIGH' | 'MODERATE' | 'LOW' =
      modelValidated && estProb >= 0.64 && evaluation.brierScore < 0.245
        ? 'HIGH'
        : modelValidated && estProb >= 0.56
        ? 'MODERATE'
        : 'LOW';

    const predictionId = crypto
      .createHash('sha1')
      .update(`${meta.symbol}-${bar.istLabel}-${model.modelVersion}`)
      .digest('hex')
      .slice(0, 12);

    scanner.push({
      symbol: meta.symbol,
      name: meta.name,
      exchange: meta.exchange,
      sector: meta.sector,
      marketCapCr: meta.marketCapCr,
      ltp: entryPrice,
      changePct,
      volume: bar.volume * 20,
      relVolume: ind.relVolume,
      rsi14: ind.rsi14,
      adx14: ind.adx14,
      atrPct,
      vwapDistPct,
      regime,
      aiProbUp: round2(probUp * 100),
      aiProbDown: round2(probDown * 100),
      riskReward: riskRewardRatio,
      signal: bestSide,
      inWatchlist: watchlistSymbols.has(meta.symbol),
      dataMode: 'HISTORICAL_RESEARCH_DATASET',
    });

    signals.push({
      id: crypto.createHash('sha1').update(`${meta.symbol}-${bar.istLabel}-${bestStrategy.id}`).digest('hex').slice(0, 12),
      symbol: meta.symbol,
      companyName: meta.name,
      exchange: meta.exchange,
      direction: bestSide,
      entryPrice,
      entryZone: [roundTick(entryPrice * 0.999), roundTick(entryPrice * 1.001)],
      stopLoss,
      target1,
      target2,
      riskRewardRatio,
      estimatedProbability: round2(estProb),
      confidenceLow: evaluation.oosFilteredCI.lowerPct,
      confidenceHigh: evaluation.oosFilteredCI.upperPct,
      modelConfidence,
      strategyId: bestStrategy.id,
      strategyName: bestStrategy.name,
      regime,
      technicalJustification:
        bestSide === 'BUY' || bestSide === 'SELL'
          ? bestReason
          : `RSI(14)=${ind.rsi14}, ADX(14)=${ind.adx14}, VWAP=₹${ind.vwap}, RelVol=${ind.relVolume}x`,
      rejectionReason: bestSide === 'HOLD' || bestSide === 'NO_TRADE' ? bestReason : undefined,
      volumeData: {
        barVolume: bar.volume,
        relVolume: ind.relVolume,
      },
      timestampIst: bar.istLabel,
      marketDataTimestampIst: bar.istLabel,
      predictionHorizonBars: ML_PREDICTION_HORIZON_BARS,
      predictionId,
      probUpPct: round2(probUp * 100),
      probDownPct: round2(probDown * 100),
      probTimeoutPct: round2(probNeutral * 100),
      entryConditions,
      modelValidated,
      estimatedSpreadBps,
      dataQualityPassed: report.valid && !report.staleFeed && bar.volume > 0,
      expiresAtIst: `+${ML_PREDICTION_HORIZON_BARS} bars`,
      riskClassification: atrPct > 0.35 ? 'HIGH' : atrPct > 0.2 ? 'MODERATE' : 'LOW',
      dataMode: 'HISTORICAL_RESEARCH_DATASET',
      modelVersion: model.modelVersion,
    });
  }

  // Indices & realized volatility computation (zero hardcoded VIX numbers)
  const indexSpecs = [
    { symbol: 'NIFTY50', name: 'NIFTY 50' },
    { symbol: 'BANKNIFTY', name: 'BANK NIFTY' },
    { symbol: 'SENSEX', name: 'BSE SENSEX' },
  ];
  let niftyRealizedVolPct = 0;

  const indices = indexSpecs.map((spec) => {
    const c = getResearchCandles(spec.symbol, '5m');
    const idx = Math.max(40, c.length - 12 + (barOffset % 11));
    const cur = c[idx];
    let sessOpen = cur.open;
    let dayHigh = cur.high;
    let dayLow = cur.low;
    for (let k = idx; k >= 0 && c[k].sessionDate === cur.sessionDate; k--) {
      sessOpen = c[k].open;
      dayHigh = Math.max(dayHigh, c[k].high);
      dayLow = Math.min(dayLow, c[k].low);
    }
    const ind = computeIndicators(c.slice(0, idx + 1));
    const regime = classifyRegime(cur, ind[ind.length - 1]);

    if (spec.symbol === 'NIFTY50') {
      const rets: number[] = [];
      for (let k = Math.max(1, idx - 74); k <= idx; k++) {
        rets.push(Math.log(c[k].close / Math.max(1, c[k - 1].close)));
      }
      const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
      const varSum = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
      niftyRealizedVolPct = round2(Math.sqrt(varSum) * Math.sqrt(75 * 252) * 100);
    }

    return {
      symbol: spec.symbol,
      name: spec.name,
      ltp: round2(cur.close),
      change: round2(cur.close - sessOpen),
      changePct: sessOpen > 0 ? round2(((cur.close - sessOpen) / sessOpen) * 100) : 0,
      dayHigh: round2(dayHigh),
      dayLow: round2(dayLow),
      regime,
    };
  });

  const sectorMap = new Map<string, ScannerRow[]>();
  for (const row of scanner) {
    const arr = sectorMap.get(row.sector) ?? [];
    arr.push(row);
    sectorMap.set(row.sector, arr);
  }
  const sectors: SectorPerformance[] = Array.from(sectorMap.entries())
    .map(([sector, rows]) => {
      const avgChg = rows.reduce((s, r) => s + r.changePct, 0) / rows.length;
      const avgRvol = rows.reduce((s, r) => s + r.relVolume, 0) / rows.length;
      const leader = [...rows].sort((a, b) => b.changePct - a.changePct)[0];
      return {
        sector,
        changePct: round2(avgChg),
        advances: rows.filter((r) => r.changePct > 0).length,
        declines: rows.filter((r) => r.changePct <= 0).length,
        relVolume: round2(avgRvol),
        leaderSymbol: leader?.symbol ?? '',
      };
    })
    .sort((a, b) => b.changePct - a.changePct);

  const sortedByChange = [...scanner].sort((a, b) => b.changePct - a.changePct);
  const sortedByRvol = [...scanner].sort((a, b) => b.relVolume - a.relVolume);

  const dirRank = (d: SignalDirection) => (d === 'BUY' || d === 'SELL' ? 0 : d === 'HOLD' ? 1 : 2);
  signals.sort((a, b) => {
    const dr = dirRank(a.direction) - dirRank(b.direction);
    return dr !== 0 ? dr : b.estimatedProbability - a.estimatedProbability;
  });

  const clock = getNseMarketClockStatus();
  const hasAnyBrokerFeed = Boolean(
    process.env.ZERODHA_API_KEY ||
      process.env.UPSTOX_API_KEY ||
      process.env.DHAN_ACCESS_TOKEN ||
      process.env.ANGELONE_API_KEY
  );

  if (!hasAnyBrokerFeed) {
    validationNotes.push('No live broker WebSocket credentials configured; using Historical Research Dataset.');
  }
  if (anyStaleFeed) {
    validationNotes.push('Live freshness enforcement flagged stale timestamps; live signal emission blocked.');
  }

  const dataHealth: DataHealthStatus = {
    providerName: hasAnyBrokerFeed
      ? 'Broker Adapter Configured (OAuth Handshake Required)'
      : 'NSE Historical Research Dataset (Offline Replay)',
    connectionStatus: hasAnyBrokerFeed ? 'DISCONNECTED' : 'CONNECTED_LOCAL_RESEARCH',
    marketStatus: clock.marketStatusLabel,
    marketStatusReason: clock.reason,
    classification: 'HISTORICAL',
    liveVerificationStatus: 'LIVE_VERIFICATION_PENDING',
    lastUpdateIst: clock.istTimeLabel,
    lastHeartbeatIst: clock.istTimeLabel,
    latestSourceTimestampIst: latestIstLabel || 'UNAVAILABLE',
    feedLatencyMs: null,
    missingDataCount,
    reconnectionCount: 0,
    validationPassed: !anyStaleFeed,
    staleFeedBlocked: anyStaleFeed,
    validationNotes,
  };

  const overview: MarketOverviewResponse = {
    dataMode: 'HISTORICAL_RESEARCH_DATASET',
    dataSourceLabel: 'NSE Historical Research Dataset (Non-Live Replay)',
    istTimestamp: latestIstLabel || '2026-11-18 14:30 IST',
    marketStatus: clock.marketStatusLabel,
    dataHealth,
    indices,
    breadth: {
      advances,
      declines,
      unchanged,
      adRatio: declines > 0 ? round2(advances / declines) : advances,
      realizedVolAnnualizedPct: niftyRealizedVolPct,
    },
    overallRegime: indices[0]?.regime ?? 'STRONG_TREND_BULL',
    sectors,
    topGainers: sortedByChange.slice(0, 6),
    topLosers: [...sortedByChange].reverse().slice(0, 6),
    unusualVolume: sortedByRvol.slice(0, 6),
    fiiDiiContext: {
      note: 'FII/DII institutional net flow is unavailable without an authorized NSE/vendor EOD data feed.',
      fiiNetCr: null,
      diiNetCr: null,
      asOfDate: 'Unavailable',
      sourceStatus: 'UNAVAILABLE_REQUIRES_NSE_FEED',
    },
  };

  return { scanner, signals, overview, barContextBySymbol };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function roundTick(price: number): number {
  const rounded = Math.round(price / 0.05) * 0.05;
  return Math.round(rounded * 100) / 100;
}

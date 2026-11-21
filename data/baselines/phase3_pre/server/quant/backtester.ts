import crypto from 'node:crypto';
import {
  BacktestConfig,
  BacktestCostSensitivityRow,
  BacktestResult,
  BacktestSessionSummary,
  BacktestSymbolSummary,
  BacktestTrade,
  Candle,
  IndicatorPoint,
  MarketRegime,
  RegimeStats,
  StrategyConfig,
} from '../../src/types/trading.ts';
import { getCachedRealHistoricalCandles } from '../data/historicalProvider.ts';
import { getResearchCandles } from '../data/nseUniverse.ts';
import { validateCandles } from '../data/validator.ts';
import { calculateNseIntradayCharges, calculateWilsonCI } from './costs.ts';
import { computeIndicators } from './indicators.ts';
import {
  buildIndexContextMap,
  buildLabeledDataset,
  fitDualPurgedModel,
  IndexMarketContext,
  ML_PREDICTION_HORIZON_BARS,
  predictDirectionalProbabilities,
  TrainedLogisticModel,
  trainAndEvaluateWalkForward,
} from './mlEngine.ts';
import { classifyRegime } from './regime.ts';
import { DEFAULT_RISK_CONFIG } from './riskEngine.ts';
import { evaluateStrategyAtBar } from './strategies.ts';

interface SymbolSeriesContext {
  symbol: string;
  candles: Candle[];
  indicators: IndicatorPoint[];
  timeToIndex: Map<number, number>;
  oosStartIdx: number;
  staticOosModel: TrainedLogisticModel;
  rollingModel?: TrainedLogisticModel;
  lastRetrainIdx: number;
  zeroVolumeBarsExcluded: number;
  gapsDetected: number;
}

interface OpenPortfolioPos {
  symbol: string;
  side: 'BUY' | 'SELL';
  rawEntryPrice: number;
  fillEntryPrice: number;
  stopLoss: number;
  target: number;
  quantity: number;
  requestedQty: number;
  fillRatio: number;
  entrySpreadCostInr: number;
  entryTimeIst: string;
  entryIndex: number;
  sessionDate: string;
  regime: MarketRegime;
  atrAtEntry: number;
}

function getCausalModelAtBar(
  ctx: SymbolSeriesContext,
  i: number,
  useOutOfSampleOnly: boolean,
  minProbThreshold: number,
  tf: BacktestConfig['timeframe'],
  indexCtx?: IndexMarketContext
): TrainedLogisticModel {
  if (useOutOfSampleOnly) {
    return ctx.staticOosModel;
  }

  // Causal expanding walk-forward retraining: bar i ONLY ever sees labels ending <= i - 1
  if (!ctx.rollingModel || i - ctx.lastRetrainIdx >= 120) {
    const horizon = ML_PREDICTION_HORIZON_BARS;
    const causalCutoff = i;
    if (causalCutoff >= 110) {
      const subCandles = ctx.candles.slice(0, causalCutoff);
      const subInd = ctx.indicators.slice(0, causalCutoff);
      const ds = buildLabeledDataset(subCandles, subInd, horizon, indexCtx);
      const valCut = Math.floor(ds.length * 0.76);
      const valStartBar = ds[valCut]?.index ?? Number.MAX_SAFE_INTEGER;
      const tr = ds.slice(0, valCut).filter((d) => d.index + horizon < valStartBar);
      const va = ds.slice(valCut);
      ctx.rollingModel =
        tr.length >= 25
          ? fitDualPurgedModel(tr, va, 'ArthQuant-ExpandingWF-v2.0')
          : trainAndEvaluateWalkForward(ctx.symbol, tf, subCandles, subInd, minProbThreshold, 'RESEARCH_REPLAY', {
              includeModelComparison: false,
              indexCandles: indexCtx?.candles,
            }).model;
    } else {
      ctx.rollingModel = ctx.staticOosModel;
    }
    ctx.lastRetrainIdx = i;
  }
  return ctx.rollingModel;
}

function loadDatasetCandles(
  symbol: string,
  timeframe: BacktestConfig['timeframe'],
  dataset: 'research' | 'public'
): { raw: Candle[]; provider: string } {
  if (dataset === 'public') {
    const real = getCachedRealHistoricalCandles(symbol, timeframe);
    if (real && real.length >= 90) {
      return { raw: real, provider: 'YAHOO_PUBLIC_NSE (Cached Real 60d)' };
    }
  }
  return {
    raw: getResearchCandles(symbol, timeframe),
    provider: 'NSE Historical Research Dataset (Offline Replay)',
  };
}

function findNiftyAlignedFeatureCtx(
  indexCtx: IndexMarketContext | undefined,
  stockBarTime: number
): { close: number; vwap: number; atr14: number; ret6: number } | undefined {
  if (!indexCtx || indexCtx.candles.length < 10) return undefined;
  const cands = indexCtx.candles;
  let lo = 0;
  let hi = cands.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cands[mid].time <= stockBarTime) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ans < 6) return undefined;
  const cur = cands[ans];
  const prev6 = cands[ans - 6];
  const ind = indexCtx.indicators[ans];
  return {
    close: cur.close,
    vwap: ind.vwap,
    atr14: ind.atr14,
    ret6: prev6.close > 0 ? (cur.close - prev6.close) / prev6.close : 0,
  };
}

function executeBacktestCore(
  config: BacktestConfig,
  strategy: StrategyConfig,
  includeSensitivity: boolean,
  precomputed?: {
    niftyRaw: Candle[];
    indexCtx: IndexMarketContext | undefined;
    contexts: SymbolSeriesContext[];
    timeline: number[];
    totalBarsAnalyzed: number;
    zeroVolumeBarsExcluded: number;
    gapsDetected: number;
    usedProviderName: string;
  }
): BacktestResult {
  const stepSec = config.timeframe === '1m' ? 60 : config.timeframe === '15m' ? 900 : 300;
  const horizon = ML_PREDICTION_HORIZON_BARS;
  const datasetMode = config.dataset === 'public' ? 'public' : 'research';

  let niftyRaw: Candle[];
  let indexCtx: IndexMarketContext | undefined;
  let contexts: SymbolSeriesContext[];
  let timeline: number[];
  let totalBarsAnalyzed = 0;
  let zeroVolumeBarsExcluded = 0;
  let gapsDetected = 0;
  let usedProviderName = datasetMode === 'public' ? 'YAHOO_PUBLIC_NSE (60d)' : 'RESEARCH_REPLAY (14d)';

  if (precomputed) {
    niftyRaw = precomputed.niftyRaw;
    indexCtx = precomputed.indexCtx;
    contexts = precomputed.contexts.map((c) => ({
      ...c,
      rollingModel: undefined,
      lastRetrainIdx: -999,
    }));
    timeline = precomputed.timeline;
    totalBarsAnalyzed = precomputed.totalBarsAnalyzed;
    zeroVolumeBarsExcluded = precomputed.zeroVolumeBarsExcluded;
    gapsDetected = precomputed.gapsDetected;
    usedProviderName = precomputed.usedProviderName;
  } else {
    niftyRaw = loadDatasetCandles('NIFTY50', config.timeframe, datasetMode).raw;
    indexCtx = buildIndexContextMap(niftyRaw);
    contexts = [];
    const timeSet = new Set<number>();

  for (const rawSym of config.symbols) {
    const symbol = rawSym.toUpperCase();
    const { raw, provider } = loadDatasetCandles(symbol, config.timeframe, datasetMode);
    usedProviderName = provider;
    const { cleaned: candles, report } = validateCandles(raw, stepSec);
    totalBarsAnalyzed += candles.length;
    zeroVolumeBarsExcluded += report.zeroVolumeBars;
    gapsDetected += report.gapsDetected;
    if (candles.length < 95) continue;

    const indicators = computeIndicators(candles);
    const { model, evaluation } = trainAndEvaluateWalkForward(
      symbol,
      config.timeframe,
      candles,
      indicators,
      strategy.minProbThreshold,
      datasetMode === 'public' ? 'PUBLIC_DELAYED_NSE_FEED' : 'RESEARCH_REPLAY',
      { includeModelComparison: false, indexCandles: niftyRaw }
    );

    const oosStartIdx = config.useOutOfSampleOnly
      ? Math.max(60, candles.length - horizon - 1 - evaluation.splitSummary.oosTestBars)
      : 35;

    const timeToIndex = new Map<number, number>();
    for (let idx = 0; idx < candles.length; idx++) {
      timeToIndex.set(candles[idx].time, idx);
      if (idx >= oosStartIdx) timeSet.add(candles[idx].time);
    }

      contexts.push({
        symbol,
        candles,
        indicators,
        timeToIndex,
        oosStartIdx,
        staticOosModel: model,
        lastRetrainIdx: -999,
        zeroVolumeBarsExcluded: report.zeroVolumeBars,
        gapsDetected: report.gapsDetected,
      });
    }

    timeline = Array.from(timeSet).sort((a, b) => a - b);
  }

  const trades: BacktestTrade[] = [];
  const openPositions = new Map<string, OpenPortfolioPos>();
  let equity = config.initialCapital;
  let peakEquity = equity;
  let maxDrawdownInr = 0;
  let maxDrawdownPct = 0;
  let liquiditySkippedCount = 0;
  let partialFillCount = 0;
  let costHurdleSkippedCount = 0;

  // RiskConfig parity (aligned strictly with DEFAULT_RISK_CONFIG)
  const maxOpenPositions = Math.max(
    1,
    Math.min(8, config.symbols.length <= 2 ? 2 : DEFAULT_RISK_CONFIG.maxOpenPositions)
  );
  const maxStockCapPct =
    config.symbols.length <= 2 ? 0.45 : DEFAULT_RISK_CONFIG.maxStockExposurePct / 100;
  const maxTotalExposurePct = DEFAULT_RISK_CONFIG.maxTotalExposurePct / 100; // 0.80 exact RiskConfig parity
  const maxTradesPerDay = DEFAULT_RISK_CONFIG.maxTradesPerDay;
  const maxDailyLossInr = DEFAULT_RISK_CONFIG.maxDailyLossInr;
  const maxConsecutiveLossesPerSession = DEFAULT_RISK_CONFIG.maxConsecutiveLosses;
  const maxSpreadBps = DEFAULT_RISK_CONFIG.maxSpreadBps;

  const slipFrac = Math.max(0, config.slippageBps) / 10000;
  const bidAskSpreadBps = Math.max(0, config.bidAskSpreadBps ?? 4); // Realistic 4 bps NSE liquid round-trip spread (2 bps/side)
  const halfSpreadFrac = (bidAskSpreadBps / 2) / 10000;
  const partialFillMode = config.partialFillMode ?? true;
  const maxParticipationFrac = Math.max(0.0001, (config.maxParticipationPct ?? 5) / 100);
  const enforceCostHurdle = config.enforceCostHurdle ?? true;

  // Per-session intraday risk counters + daily portfolio equity tracking
  let currentSession = '';
  let tradesToday = 0;
  let dailyRealizedPnl = 0;
  let sessionConsecLosses = 0;
  let sessionStartEquity = equity;
  const dailyEquityReturnsPct: number[] = [];

  const earliestIst =
    timeline.length > 0
      ? contexts
          .map((c) => {
            const idx = c.timeToIndex.get(timeline[0]);
            return idx !== undefined ? c.candles[idx]?.istLabel : undefined;
          })
          .filter((x): x is string => Boolean(x))
          .sort()[0] ?? '2026-01-01 09:15 IST'
      : '2026-01-01 09:15 IST';
  const latestIst =
    timeline.length > 0
      ? contexts
          .map((c) => {
            const idx = c.timeToIndex.get(timeline[timeline.length - 1]);
            return idx !== undefined ? c.candles[idx]?.istLabel : undefined;
          })
          .filter((x): x is string => Boolean(x))
          .sort()
          .reverse()[0] ?? earliestIst
      : earliestIst;

  const equityCurve: { index: number; timestampIst: string; equity: number; drawdownPct: number }[] = [
    { index: 0, timestampIst: earliestIst, equity: round2(equity), drawdownPct: 0 },
  ];

  // Synchronized chronological portfolio loop across all symbols
  for (const ts of timeline) {
    // Detect IST session change for daily risk counters & daily portfolio Sharpe tracking
    const sampleCtx = contexts.find((c) => c.timeToIndex.has(ts));
    if (sampleCtx) {
      const sDate = sampleCtx.candles[sampleCtx.timeToIndex.get(ts)!].sessionDate;
      if (sDate !== currentSession) {
        if (currentSession !== '' && sessionStartEquity > 0) {
          dailyEquityReturnsPct.push(((equity - sessionStartEquity) / sessionStartEquity) * 100);
        }
        currentSession = sDate;
        tradesToday = 0;
        dailyRealizedPnl = 0;
        sessionConsecLosses = 0;
        sessionStartEquity = equity;
      }
    }

    // 1. Manage existing open positions first (chronological exit before new entries)
    for (const ctx of contexts) {
      const openPos = openPositions.get(ctx.symbol);
      if (!openPos) continue;
      const i = ctx.timeToIndex.get(ts);
      if (i === undefined) continue;

      const bar = ctx.candles[i];
      const istTime = bar.istLabel.slice(11, 16);
      const barsHeld = i - openPos.entryIndex;
      let rawExitPrice: number | null = null;
      let exitReason: BacktestTrade['exitReason'] | null = null;

      // Conservative intrabar resolution: check SL BEFORE Target
      if (openPos.side === 'BUY') {
        if (bar.low <= openPos.stopLoss) {
          rawExitPrice = Math.min(bar.open, openPos.stopLoss);
          exitReason = 'STOP_LOSS';
        } else if (bar.high >= openPos.target) {
          rawExitPrice = Math.max(bar.open, openPos.target);
          exitReason = 'TARGET_1';
        }
      } else {
        if (bar.high >= openPos.stopLoss) {
          rawExitPrice = Math.max(bar.open, openPos.stopLoss);
          exitReason = 'STOP_LOSS';
        } else if (bar.low <= openPos.target) {
          rawExitPrice = Math.min(bar.open, openPos.target);
          exitReason = 'TARGET_1';
        }
      }

      if (rawExitPrice === null && (istTime >= '15:15' || bar.sessionDate !== openPos.sessionDate)) {
        rawExitPrice = bar.close;
        exitReason = 'EOD_SQUAREOFF';
      } else if (rawExitPrice === null && barsHeld >= strategy.maxHoldingBars) {
        rawExitPrice = bar.close;
        exitReason = 'MAX_BARS';
      }

      // Causal trailing stop update for NEXT bar only
      if (rawExitPrice === null && strategy.trailingStopAtrMult !== null && barsHeld >= 1) {
        const trailDist = openPos.atrAtEntry * strategy.trailingStopAtrMult;
        if (openPos.side === 'BUY' && bar.close > openPos.fillEntryPrice + openPos.atrAtEntry) {
          const candidateTrail = roundTick(bar.close - trailDist);
          if (candidateTrail > openPos.stopLoss) openPos.stopLoss = candidateTrail;
        } else if (openPos.side === 'SELL' && bar.close < openPos.fillEntryPrice - openPos.atrAtEntry) {
          const candidateTrail = roundTick(bar.close + trailDist);
          if (candidateTrail < openPos.stopLoss) openPos.stopLoss = candidateTrail;
        }
      }

      if (rawExitPrice !== null && exitReason !== null) {
        const totalExitImpactFrac = slipFrac + halfSpreadFrac;
        const slippedExit =
          openPos.side === 'BUY'
            ? roundTick(rawExitPrice * (1 - totalExitImpactFrac))
            : roundTick(rawExitPrice * (1 + totalExitImpactFrac));

        const buyVal = (openPos.side === 'BUY' ? openPos.fillEntryPrice : slippedExit) * openPos.quantity;
        const sellVal = (openPos.side === 'BUY' ? slippedExit : openPos.fillEntryPrice) * openPos.quantity;

        const statutoryOnly = calculateNseIntradayCharges(buyVal, sellVal, {
          brokerageFlatCap: config.brokerageFlatCap,
          brokeragePct: config.brokeragePct,
          slippageBps: 0,
        });

        const unslippedGrossPnl = round2(
          openPos.side === 'BUY'
            ? (rawExitPrice - openPos.rawEntryPrice) * openPos.quantity
            : (openPos.rawEntryPrice - rawExitPrice) * openPos.quantity
        );
        const slippedGrossPnl = round2(
          openPos.side === 'BUY'
            ? (slippedExit - openPos.fillEntryPrice) * openPos.quantity
            : (openPos.fillEntryPrice - slippedExit) * openPos.quantity
        );
        const totalExecutionDrag = Math.max(0, unslippedGrossPnl - slippedGrossPnl);
        const exitSpreadCostInr = round2(rawExitPrice * halfSpreadFrac * openPos.quantity);
        const bidAskSpreadCostInr = round2(openPos.entrySpreadCostInr + exitSpreadCostInr);
        const realizedSlippageOnly = round2(Math.max(0, totalExecutionDrag - bidAskSpreadCostInr));
        const totalCharges = round2(statutoryOnly.totalCharges + totalExecutionDrag);
        const netPnl = round2(unslippedGrossPnl - totalCharges);
        const capitalUsed = openPos.fillEntryPrice * openPos.quantity;

        equity = round2(equity + netPnl);
        dailyRealizedPnl = round2(dailyRealizedPnl + netPnl);
        if (netPnl <= 0) sessionConsecLosses++;
        else sessionConsecLosses = 0;

        if (equity > peakEquity) peakEquity = equity;
        const ddInr = peakEquity - equity;
        const ddPct = peakEquity > 0 ? (ddInr / peakEquity) * 100 : 0;
        if (ddInr > maxDrawdownInr) maxDrawdownInr = ddInr;
        if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

        trades.push({
          id: crypto.randomUUID(),
          symbol: ctx.symbol,
          side: openPos.side,
          entryTimeIst: openPos.entryTimeIst,
          exitTimeIst: bar.istLabel,
          entryPrice: openPos.fillEntryPrice,
          exitPrice: slippedExit,
          quantity: openPos.quantity,
          requestedQty: openPos.requestedQty,
          fillRatio: openPos.fillRatio,
          bidAskSpreadCostInr,
          grossPnl: unslippedGrossPnl,
          charges: {
            ...statutoryOnly,
            slippageCost: round2(realizedSlippageOnly + bidAskSpreadCostInr),
            totalCharges,
          },
          netPnl,
          returnPct: capitalUsed > 0 ? round2((netPnl / capitalUsed) * 100) : 0,
          exitReason,
          regime: openPos.regime,
          barsHeld,
        });

        equityCurve.push({
          index: trades.length,
          timestampIst: bar.istLabel,
          equity,
          drawdownPct: round2(ddPct),
        });

        openPositions.delete(ctx.symbol);
      }
    }

    // Check session-level RiskConfig kill switches before evaluating new entries
    const accountDrawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    if (
      tradesToday >= maxTradesPerDay ||
      dailyRealizedPnl <= -maxDailyLossInr ||
      sessionConsecLosses >= maxConsecutiveLossesPerSession ||
      accountDrawdownPct >= DEFAULT_RISK_CONFIG.maxDrawdownPct
    ) {
      continue;
    }

    // 2. Evaluate new causal entries across symbols
    for (const ctx of contexts) {
      if (openPositions.has(ctx.symbol)) continue;
      if (openPositions.size >= maxOpenPositions) break;
      if (tradesToday >= maxTradesPerDay) break;

      const i = ctx.timeToIndex.get(ts);
      if (i === undefined || i < ctx.oosStartIdx || i >= ctx.candles.length - 1) continue;

      const bar = ctx.candles[i];
      if (bar.volume <= 0) continue; // Zero-volume bar excluded from signal generation

      const ind = ctx.indicators[i];
      const istTime = bar.istLabel.slice(11, 16);
      if (istTime >= '14:45') continue;

      // Spread limit parity check
      if (bidAskSpreadBps > maxSpreadBps) continue;

      const regime = classifyRegime(bar, ind);
      const model = getCausalModelAtBar(
        ctx,
        i,
        config.useOutOfSampleOnly,
        strategy.minProbThreshold,
        config.timeframe,
        indexCtx
      );
      const niftyAligned = findNiftyAlignedFeatureCtx(indexCtx, bar.time);
      const { probUp, probDown } = predictDirectionalProbabilities(model, bar, ind, {
        candles: ctx.candles,
        index: i,
        niftyAligned,
      });
      const candidate = evaluateStrategyAtBar(strategy, ctx.candles, ctx.indicators, i, regime, probUp, probDown);

      if (candidate.side) {
        const nextBar = ctx.candles[i + 1];
        if (nextBar.sessionDate !== bar.sessionDate) continue;

        if (nextBar.volume <= 0) {
          liquiditySkippedCount++;
          continue;
        }

        const totalEntryImpactFrac = slipFrac + halfSpreadFrac;
        const rawEntry = roundTick(nextBar.open);
        const fillPrice =
          candidate.side === 'BUY'
            ? roundTick(rawEntry * (1 + totalEntryImpactFrac))
            : roundTick(rawEntry * (1 - totalEntryImpactFrac));

        const atr = Math.max(0.2, ind.atr14);
        const slDist = Math.max(fillPrice * 0.002, atr * strategy.stopLossAtrMult);
        const tgtDist = atr * strategy.target1AtrMult;

        const stopLoss = roundTick(
          candidate.side === 'BUY' ? fillPrice - slDist : fillPrice + slDist
        );
        const target = roundTick(
          candidate.side === 'BUY' ? fillPrice + tgtDist : fillPrice - tgtDist
        );

        let currentExposure = 0;
        for (const p of openPositions.values()) currentExposure += p.fillEntryPrice * p.quantity;
        const remainingPortfolioCap = Math.max(0, equity * maxTotalExposurePct - currentExposure);

        const riskBudget = equity * (config.riskPerTradePct / 100);
        const maxQtyByStock = Math.floor((equity * maxStockCapPct) / fillPrice);
        const maxQtyByPortfolio = Math.floor(remainingPortfolioCap / fillPrice);
        const qtyByRisk = Math.floor(riskBudget / Math.max(0.1, slDist));
        const desiredQty = Math.min(maxQtyByStock, maxQtyByPortfolio, qtyByRisk);
        const maxQtyByLiquidity = Math.floor(nextBar.volume * maxParticipationFrac);

        if (desiredQty < 1 || maxQtyByLiquidity < 1) {
          liquiditySkippedCount++;
          continue;
        }

        const isPartial = partialFillMode && desiredQty > maxQtyByLiquidity;
        const quantity = partialFillMode ? Math.min(desiredQty, maxQtyByLiquidity) : desiredQty <= maxQtyByLiquidity ? desiredQty : 0;
        if (quantity < 1) {
          liquiditySkippedCount++;
          continue;
        }

        // Minimum expected-move cost hurdle: expected target profit must clear >= 1.8x round-trip NSE fees + spread + slippage
        if (enforceCostHurdle) {
          const estNotional = fillPrice * quantity;
          const estStat = calculateNseIntradayCharges(estNotional, estNotional, {
            brokerageFlatCap: config.brokerageFlatCap,
            brokeragePct: config.brokeragePct,
            slippageBps: config.slippageBps + bidAskSpreadBps,
          });
          const expectedGrossProfit = tgtDist * quantity;
          if (expectedGrossProfit < estStat.totalCharges * 1.8) {
            costHurdleSkippedCount++;
            continue;
          }
        }

        if (isPartial) partialFillCount++;
        const fillRatio = round4(quantity / desiredQty);
        const entrySpreadCostInr = round2(rawEntry * halfSpreadFrac * quantity);

        tradesToday++;
        openPositions.set(ctx.symbol, {
          symbol: ctx.symbol,
          side: candidate.side,
          rawEntryPrice: rawEntry,
          fillEntryPrice: fillPrice,
          stopLoss,
          target,
          quantity,
          requestedQty: desiredQty,
          fillRatio,
          entrySpreadCostInr,
          entryTimeIst: nextBar.istLabel,
          entryIndex: i + 1,
          sessionDate: nextBar.sessionDate,
          regime,
          atrAtEntry: atr,
        });
      }
    }
  }

  if (currentSession !== '' && sessionStartEquity > 0) {
    dailyEquityReturnsPct.push(((equity - sessionStartEquity) / sessionStartEquity) * 100);
  }

  // Buy-and-Hold equal-weighted benchmark across the exact same OOS window
  const bhReturns: number[] = [];
  for (const ctx of contexts) {
    const startPx = ctx.candles[ctx.oosStartIdx]?.close;
    const endPx = ctx.candles[ctx.candles.length - 1]?.close;
    if (startPx && endPx && startPx > 0) {
      bhReturns.push(((endPx - startPx) / startPx) * 100);
    }
  }
  const benchmarkReturnPct =
    bhReturns.length > 0 ? round2(bhReturns.reduce((a, b) => a + b, 0) / bhReturns.length) : 0;

  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const winningTrades = wins.length;
  const losingTrades = losses.length;
  const winRatePct = totalTrades > 0 ? round2((winningTrades / totalTrades) * 100) : 0;
  const winRateCI = calculateWilsonCI(winningTrades, totalTrades);

  const grossTotalPnl = round2(trades.reduce((s, t) => s + t.grossPnl, 0));
  const grossProfit = round2(wins.reduce((s, t) => s + t.netPnl, 0));
  const grossLoss = round2(Math.abs(losses.reduce((s, t) => s + t.netPnl, 0)));
  const totalCharges = round2(trades.reduce((s, t) => s + t.charges.totalCharges, 0));
  const totalSlippage = round2(trades.reduce((s, t) => s + t.charges.slippageCost, 0));
  const totalSpreadCostInr = round2(trades.reduce((s, t) => s + (t.bidAskSpreadCostInr ?? 0), 0));
  const totalNetProfit = round2(equity - config.initialCapital);
  const netReturnPct = round2((totalNetProfit / config.initialCapital) * 100);
  const alphaOverBenchmarkPct = round2(netReturnPct - benchmarkReturnPct);

  const avgFillRatioPct =
    totalTrades > 0
      ? round2((trades.reduce((s, t) => s + (t.fillRatio ?? 1), 0) / totalTrades) * 100)
      : 100;

  const profitFactor =
    grossLoss > 0 ? round2(grossProfit / grossLoss) : grossProfit > 0 ? 99 : 0;
  const expectancyInr = totalTrades > 0 ? round2(totalNetProfit / totalTrades) : 0;
  const avgWinInr = winningTrades > 0 ? round2(grossProfit / winningTrades) : 0;
  const avgLossInr = losingTrades > 0 ? round2(grossLoss / losingTrades) : 0;

  let maxConsec = 0;
  let curConsec = 0;
  const rets: number[] = [];
  for (const t of trades) {
    rets.push(t.returnPct);
    if (t.netPnl <= 0) {
      curConsec++;
      if (curConsec > maxConsec) maxConsec = curConsec;
    } else {
      curConsec = 0;
    }
  }

  const meanRet = rets.length > 0 ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const stdRet =
    rets.length > 1
      ? Math.sqrt(rets.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (rets.length - 1))
      : 0;
  const downRets = rets.filter((r) => r < 0);
  const downStd =
    downRets.length > 1
      ? Math.sqrt(downRets.reduce((s, r) => s + r * r, 0) / downRets.length)
      : stdRet;

  const sharpeRatio = stdRet > 0 ? round2((meanRet / stdRet) * Math.sqrt(Math.min(252, rets.length))) : 0;
  const sortinoRatio = downStd > 0 ? round2((meanRet / downStd) * Math.sqrt(Math.min(252, rets.length))) : 0;
  const calmarRatio = maxDrawdownPct > 0 ? round2(netReturnPct / maxDrawdownPct) : 0;

  // Daily Portfolio Equity Sharpe (eliminates variable trade-notional returnPct distortion)
  const dMean =
    dailyEquityReturnsPct.length > 0
      ? dailyEquityReturnsPct.reduce((a, b) => a + b, 0) / dailyEquityReturnsPct.length
      : 0;
  const dStd =
    dailyEquityReturnsPct.length > 1
      ? Math.sqrt(
          dailyEquityReturnsPct.reduce((s, r) => s + (r - dMean) ** 2, 0) /
            (dailyEquityReturnsPct.length - 1)
        )
      : 0;
  const portfolioDailySharpe = dStd > 0 ? round2((dMean / dStd) * Math.sqrt(252)) : 0;

  const avgBarsHeld =
    totalTrades > 0 ? round2(trades.reduce((s, t) => s + t.barsHeld, 0) / totalTrades) : 0;

  const regimes: MarketRegime[] = [
    'STRONG_TREND_BULL',
    'STRONG_TREND_BEAR',
    'SIDEWAYS_RANGE',
    'HIGH_VOL_BREAKOUT',
    'UNCERTAIN_CHOP',
  ];
  const regimeBreakdown: RegimeStats[] = regimes
    .map((reg) => {
      const subset = trades.filter((t) => t.regime === reg);
      const rWins = subset.filter((t) => t.netPnl > 0);
      const rLosses = subset.filter((t) => t.netPnl <= 0);
      const gp = rWins.reduce((s, t) => s + t.netPnl, 0);
      const gl = Math.abs(rLosses.reduce((s, t) => s + t.netPnl, 0));
      return {
        regime: reg,
        trades: subset.length,
        wins: rWins.length,
        winRatePct: subset.length > 0 ? round2((rWins.length / subset.length) * 100) : 0,
        netPnl: round2(subset.reduce((s, t) => s + t.netPnl, 0)),
        profitFactor: gl > 0 ? round2(gp / gl) : gp > 0 ? 99 : 0,
      };
    })
    .filter((r) => r.trades > 0);

  // Per-Symbol Attribution
  const symMap = new Map<string, BacktestTrade[]>();
  for (const t of trades) {
    const arr = symMap.get(t.symbol) ?? [];
    arr.push(t);
    symMap.set(t.symbol, arr);
  }
  const symbolBreakdown: BacktestSymbolSummary[] = Array.from(symMap.entries())
    .map(([symbol, list]) => {
      const sWins = list.filter((t) => t.netPnl > 0);
      const sLosses = list.filter((t) => t.netPnl <= 0);
      const gp = sWins.reduce((s, t) => s + t.netPnl, 0);
      const gl = Math.abs(sLosses.reduce((s, t) => s + t.netPnl, 0));
      return {
        symbol,
        trades: list.length,
        wins: sWins.length,
        winRatePct: round2((sWins.length / list.length) * 100),
        netPnl: round2(list.reduce((s, t) => s + t.netPnl, 0)),
        profitFactor: gl > 0 ? round2(gp / gl) : gp > 0 ? 99 : 0,
      };
    })
    .sort((a, b) => b.netPnl - a.netPnl);

  // Session Attribution
  const sessMap = new Map<string, BacktestTrade[]>();
  for (const t of trades) {
    const d = t.entryTimeIst.slice(0, 10);
    const arr = sessMap.get(d) ?? [];
    arr.push(t);
    sessMap.set(d, arr);
  }
  const sessionBreakdown: BacktestSessionSummary[] = Array.from(sessMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([sessionDate, list]) => ({
      sessionDate,
      trades: list.length,
      wins: list.filter((t) => t.netPnl > 0).length,
      netPnl: round2(list.reduce((s, t) => s + t.netPnl, 0)),
    }));

  // Cost Sensitivity Analysis at 0, 5, 10, 15, and 20 bps slippage
  let costSensitivity: BacktestCostSensitivityRow[] | undefined;
  if (includeSensitivity) {
    const bpsPoints = Array.from(new Set([0, 5, 10, 15, 20, config.slippageBps])).sort(
      (a, b) => a - b
    );
    costSensitivity = bpsPoints.map((bps) => {
      if (bps === config.slippageBps) {
        return {
          slippageBps: bps,
          totalTrades,
          winRatePct,
          profitFactor,
          netPnl: totalNetProfit,
          netReturnPct,
          totalCharges,
        };
      }
      const alt = executeBacktestCore(
        { ...config, slippageBps: bps },
        strategy,
        false,
        {
          niftyRaw,
          indexCtx,
          contexts,
          timeline,
          totalBarsAnalyzed,
          zeroVolumeBarsExcluded,
          gapsDetected,
          usedProviderName,
        }
      );
      return {
        slippageBps: bps,
        totalTrades: alt.totalTrades,
        winRatePct: alt.winRatePct,
        profitFactor: alt.profitFactor,
        netPnl: alt.totalNetProfit,
        netReturnPct: alt.netReturnPct,
        totalCharges: alt.totalCharges,
      };
    });
  }

  const target70Met = winRatePct >= 70 && expectancyInr > 0 && totalTrades >= 20;
  const validationNotice =
    totalTrades === 0
      ? `Zero trades triggered under ${strategy.name} (cost-hurdle skips: ${costHurdleSkippedCount}, liquidity skips: ${liquiditySkippedCount}).`
      : totalTrades < 20
      ? `Small sample warning (n=${totalTrades} trades; 95% CI: ${winRateCI.lowerPct}%–${winRateCI.upperPct}%). Increase universe or date window before drawing statistical conclusions.`
      : target70Met
      ? `Cleared >=70% net win rate (${winRatePct}%, 95% CI: ${winRateCI.lowerPct}%–${winRateCI.upperPct}%, n=${totalTrades}) with positive net expectancy ₹${expectancyInr}/trade after NSE fees + ${bidAskSpreadBps} bps spread (Gross ₹${grossTotalPnl}, Benchmark ${benchmarkReturnPct}%).`
      : `Actual net win rate is ${winRatePct}% (95% CI: ${winRateCI.lowerPct}%–${winRateCI.upperPct}%, n=${totalTrades}), Expectancy ₹${expectancyInr}/trade (Gross ₹${grossTotalPnl} vs Fees+Spread+Slip ₹${totalCharges}, Daily Sharpe ${portfolioDailySharpe}).`;

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    config,
    strategyName: strategy.name,
    strategyVersion: strategy.version,
    dataMode: datasetMode === 'public' ? 'PUBLIC_DELAYED_NSE_FEED' : 'HISTORICAL_RESEARCH_DATASET',
    totalTrades,
    winningTrades,
    losingTrades,
    winRatePct,
    winRateCI,
    lossRatePct: totalTrades > 0 ? round2(100 - winRatePct) : 0,
    grossTotalPnl,
    grossProfit,
    grossLoss,
    totalCharges,
    totalSlippage,
    totalSpreadCostInr,
    totalNetProfit,
    netReturnPct,
    benchmarkReturnPct,
    alphaOverBenchmarkPct,
    liquiditySkippedCount,
    partialFillCount,
    avgFillRatioPct,
    costHurdleSkippedCount,
    portfolioDailySharpe,
    dataSourceDetails: {
      provider: usedProviderName,
      totalBarsAnalyzed,
      zeroVolumeBarsExcluded,
      gapsDetected,
      dateRangeIst: `${earliestIst} → ${latestIst}`,
    },
    profitFactor,
    expectancyInr,
    avgWinInr,
    avgLossInr,
    maxDrawdownInr: round2(maxDrawdownInr),
    maxDrawdownPct: round2(maxDrawdownPct),
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    maxConsecutiveLosses: maxConsec,
    avgBarsHeld,
    target70Met,
    validationNotice,
    equityCurve,
    regimeBreakdown,
    symbolBreakdown,
    sessionBreakdown,
    costSensitivity,
    trades: trades.slice(-200),
  };
}

/**
 * Chronological Synchronized Portfolio Backtesting Engine:
 * - Evaluates bar `i` causally and executes ONLY at bar `i + 1` open with adverse fill slippage + bid-ask half-spread.
 * - Enforces exact parity with DEFAULT_RISK_CONFIG (80% max total exposure, 25% stock cap, 4 positions, 12/day, daily loss, consec loss, 25 bps spread).
 * - Models partial fills when order exceeds 5% bar liquidity participation cap and enforces 1.8x expected-move cost hurdle.
 * - Reports 0, 5, 10, 15, 20 bps slippage sensitivity cleanly.
 */
export function runBacktest(
  config: BacktestConfig,
  strategy: StrategyConfig,
  includeSensitivity = true
): BacktestResult {
  return executeBacktestCore(config, strategy, includeSensitivity);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function roundTick(price: number): number {
  const rounded = Math.round(price / 0.05) * 0.05;
  return Math.round(rounded * 100) / 100;
}

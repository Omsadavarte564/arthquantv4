import {
  Candle,
  IndicatorPoint,
  MarketRegime,
  StrategyConfig,
  StrategyRuleCondition,
} from '../../src/types/trading.ts';

export const BUILTIN_STRATEGIES: StrategyConfig[] = [
  {
    id: 'orb-15-breakout',
    name: 'Opening Range Breakout (ORB-15)',
    version: '1.2.0',
    category: 'BREAKOUT',
    description: 'Trades directional breakouts above/below the 09:15–09:30 IST opening range confirmed by Relative Volume >= 1.35 and Session VWAP.',
    allowedRegimes: ['HIGH_VOL_BREAKOUT', 'STRONG_TREND_BULL', 'STRONG_TREND_BEAR'],
    entryConditions: [
      { indicator: 'REL_VOL', operator: '>=', value: 1.35 },
      { indicator: 'ADX', operator: '>=', value: 18 },
    ],
    stopLossAtrMult: 1.1,
    target1AtrMult: 1.8,
    target2AtrMult: 2.8,
    trailingStopAtrMult: 1.0,
    maxHoldingBars: 24,
    minProbThreshold: 0.54,
    isCustom: false,
    enabled: true,
    createdAt: '2026-11-01T09:15:00+05:30',
  },
  {
    id: 'vwap-momentum-pullback',
    name: 'VWAP Momentum Pullback',
    version: '1.1.0',
    category: 'MOMENTUM',
    description: 'Captures institutional trend continuation when price pulls back near Session VWAP with EMA(9) > EMA(21) and healthy ADX.',
    allowedRegimes: ['STRONG_TREND_BULL', 'STRONG_TREND_BEAR'],
    entryConditions: [
      { indicator: 'ADX', operator: '>=', value: 21 },
      { indicator: 'RSI', operator: '>', value: 48 },
    ],
    stopLossAtrMult: 1.0,
    target1AtrMult: 1.7,
    target2AtrMult: 2.6,
    trailingStopAtrMult: 0.9,
    maxHoldingBars: 20,
    minProbThreshold: 0.55,
    isCustom: false,
    enabled: true,
    createdAt: '2026-11-01T09:15:00+05:30',
  },
  {
    id: 'supertrend-adx-trend',
    name: 'Supertrend + ADX Trend Following',
    version: '1.0.4',
    category: 'TREND',
    description: 'Follows Supertrend(14, 2.8) directional flips filtered by ADX >= 22 to avoid sideways whipsaws.',
    allowedRegimes: ['STRONG_TREND_BULL', 'STRONG_TREND_BEAR', 'HIGH_VOL_BREAKOUT'],
    entryConditions: [
      { indicator: 'ADX', operator: '>=', value: 22 },
      { indicator: 'SUPERTREND', operator: 'ABOVE', value: 1 },
    ],
    stopLossAtrMult: 1.25,
    target1AtrMult: 2.0,
    target2AtrMult: 3.2,
    trailingStopAtrMult: 1.1,
    maxHoldingBars: 30,
    minProbThreshold: 0.54,
    isCustom: false,
    enabled: true,
    createdAt: '2026-11-01T09:15:00+05:30',
  },
  {
    id: 'bollinger-mean-reversion',
    name: 'Bollinger Mean Reversion (Sideways)',
    version: '1.2.1',
    category: 'MEAN_REVERSION',
    description: 'Fades 2-sigma Bollinger extremes back toward Session VWAP strictly during low-ADX sideways range sessions.',
    allowedRegimes: ['SIDEWAYS_RANGE'],
    entryConditions: [
      { indicator: 'ADX', operator: '<', value: 20 },
    ],
    stopLossAtrMult: 1.0,
    target1AtrMult: 1.4,
    target2AtrMult: 2.0,
    trailingStopAtrMult: null,
    maxHoldingBars: 14,
    minProbThreshold: 0.56,
    isCustom: false,
    enabled: true,
    createdAt: '2026-11-01T09:15:00+05:30',
  },
  {
    id: 'ema-9-21-volume-cross',
    name: 'EMA 9/21 Volume Crossover',
    version: '1.0.2',
    category: 'TREND',
    description: 'Enters fresh EMA(9)/EMA(21) momentum crossovers backed by above-average bar volume.',
    allowedRegimes: ['STRONG_TREND_BULL', 'STRONG_TREND_BEAR', 'HIGH_VOL_BREAKOUT'],
    entryConditions: [
      { indicator: 'REL_VOL', operator: '>=', value: 1.1 },
    ],
    stopLossAtrMult: 1.05,
    target1AtrMult: 1.75,
    target2AtrMult: 2.5,
    trailingStopAtrMult: 1.0,
    maxHoldingBars: 22,
    minProbThreshold: 0.53,
    isCustom: false,
    enabled: true,
    createdAt: '2026-11-01T09:15:00+05:30',
  },
  {
    id: 'rsi-exhaustion-reversal',
    name: 'RSI Exhaustion Reversal',
    version: '1.1.0',
    category: 'MEAN_REVERSION',
    description: 'Captures intraday snapbacks when Wilder RSI(14) recovers from < 30 oversold or rejects from > 70 overbought.',
    allowedRegimes: ['SIDEWAYS_RANGE', 'STRONG_TREND_BULL', 'STRONG_TREND_BEAR'],
    entryConditions: [],
    stopLossAtrMult: 1.0,
    target1AtrMult: 1.6,
    target2AtrMult: 2.2,
    trailingStopAtrMult: null,
    maxHoldingBars: 15,
    minProbThreshold: 0.55,
    isCustom: false,
    enabled: true,
    createdAt: '2026-11-01T09:15:00+05:30',
  },
  {
    id: 'macd-histogram-breakout',
    name: 'MACD Histogram Zero Breakout',
    version: '1.0.1',
    category: 'MOMENTUM',
    description: 'Trades MACD histogram expansion across zero aligned with Session VWAP.',
    allowedRegimes: ['STRONG_TREND_BULL', 'STRONG_TREND_BEAR'],
    entryConditions: [],
    stopLossAtrMult: 1.1,
    target1AtrMult: 1.8,
    target2AtrMult: 2.6,
    trailingStopAtrMult: 1.0,
    maxHoldingBars: 20,
    minProbThreshold: 0.54,
    isCustom: false,
    enabled: true,
    createdAt: '2026-11-01T09:15:00+05:30',
  },
  {
    id: 'volume-shock-breakout',
    name: 'High Relative Volume Breakout',
    version: '1.1.2',
    category: 'BREAKOUT',
    description: 'Triggers on >= 1.8x Relative Volume surges breaking 20-bar structural support/resistance.',
    allowedRegimes: ['HIGH_VOL_BREAKOUT', 'STRONG_TREND_BULL', 'STRONG_TREND_BEAR'],
    entryConditions: [{ indicator: 'REL_VOL', operator: '>=', value: 1.8 }],
    stopLossAtrMult: 1.2,
    target1AtrMult: 2.1,
    target2AtrMult: 3.1,
    trailingStopAtrMult: 1.1,
    maxHoldingBars: 24,
    minProbThreshold: 0.55,
    isCustom: false,
    enabled: true,
    createdAt: '2026-11-01T09:15:00+05:30',
  },
  {
    id: 'mtf-vwap-trend',
    name: 'Multi-Timeframe VWAP Alignment',
    version: '1.0.3',
    category: 'TREND',
    description: 'Requires price above/below both SMA(50) macro anchor and intraday Session VWAP with rising ADX.',
    allowedRegimes: ['STRONG_TREND_BULL', 'STRONG_TREND_BEAR'],
    entryConditions: [{ indicator: 'ADX', operator: '>=', value: 20 }],
    stopLossAtrMult: 1.1,
    target1AtrMult: 1.9,
    target2AtrMult: 2.8,
    trailingStopAtrMult: 0.95,
    maxHoldingBars: 25,
    minProbThreshold: 0.56,
    isCustom: false,
    enabled: true,
    createdAt: '2026-11-01T09:15:00+05:30',
  },
  {
    id: 'volatility-squeeze-release',
    name: 'Volatility Squeeze Release',
    version: '1.0.0',
    category: 'BREAKOUT',
    description: 'Detects compressed Bollinger Bands followed by a wide-range directional expansion candle.',
    allowedRegimes: ['HIGH_VOL_BREAKOUT', 'STRONG_TREND_BULL', 'STRONG_TREND_BEAR'],
    entryConditions: [{ indicator: 'REL_VOL', operator: '>=', value: 1.25 }],
    stopLossAtrMult: 1.0,
    target1AtrMult: 1.85,
    target2AtrMult: 2.75,
    trailingStopAtrMult: 0.9,
    maxHoldingBars: 18,
    minProbThreshold: 0.55,
    isCustom: false,
    enabled: true,
    createdAt: '2026-11-01T09:15:00+05:30',
  },
  {
    id: 'price-action-hh-hl',
    name: 'Price Action Structure Break',
    version: '1.0.1',
    category: 'TREND',
    description: 'Identifies clean higher-high / lower-low structural breakouts with ATR-buffered stops.',
    allowedRegimes: ['STRONG_TREND_BULL', 'STRONG_TREND_BEAR', 'HIGH_VOL_BREAKOUT'],
    entryConditions: [],
    stopLossAtrMult: 1.15,
    target1AtrMult: 1.8,
    target2AtrMult: 2.7,
    trailingStopAtrMult: 1.0,
    maxHoldingBars: 20,
    minProbThreshold: 0.54,
    isCustom: false,
    enabled: true,
    createdAt: '2026-11-01T09:15:00+05:30',
  },
  {
    id: 'opening-gap-reversal',
    name: 'Opening Gap Mean Reversion',
    version: '1.0.0',
    category: 'MEAN_REVERSION',
    description: 'Fades overextended morning gaps back toward Session VWAP once opening momentum exhausts.',
    allowedRegimes: ['SIDEWAYS_RANGE', 'STRONG_TREND_BULL', 'STRONG_TREND_BEAR'],
    entryConditions: [],
    stopLossAtrMult: 1.0,
    target1AtrMult: 1.5,
    target2AtrMult: 2.1,
    trailingStopAtrMult: null,
    maxHoldingBars: 16,
    minProbThreshold: 0.55,
    isCustom: false,
    enabled: true,
    createdAt: '2026-11-01T09:15:00+05:30',
  },
  {
    id: 'regime-adaptive-ensemble',
    name: 'Regime-Adaptive Strategy Switcher',
    version: '1.3.0',
    category: 'ENSEMBLE',
    description: 'Routes Trend regimes to VWAP Momentum, Sideways regimes to Bollinger Reversion, Breakout regimes to ORB, and blocks Uncertain Chop.',
    allowedRegimes: ['STRONG_TREND_BULL', 'STRONG_TREND_BEAR', 'SIDEWAYS_RANGE', 'HIGH_VOL_BREAKOUT'],
    entryConditions: [],
    stopLossAtrMult: 1.05,
    target1AtrMult: 1.75,
    target2AtrMult: 2.5,
    trailingStopAtrMult: 0.95,
    maxHoldingBars: 20,
    minProbThreshold: 0.56,
    isCustom: false,
    enabled: true,
    createdAt: '2026-11-01T09:15:00+05:30',
  },
  {
    id: 'institutional-vwap-reversion',
    name: 'Institutional VWAP ±2 ATR Reversion',
    version: '1.0.2',
    category: 'MEAN_REVERSION',
    description: 'Targets reversion toward Session VWAP when price stretches > 1.9 ATR away from VWAP with declining momentum.',
    allowedRegimes: ['SIDEWAYS_RANGE'],
    entryConditions: [{ indicator: 'ADX', operator: '<', value: 21 }],
    stopLossAtrMult: 0.95,
    target1AtrMult: 1.5,
    target2AtrMult: 2.1,
    trailingStopAtrMult: null,
    maxHoldingBars: 14,
    minProbThreshold: 0.57,
    isCustom: false,
    enabled: true,
    createdAt: '2026-11-01T09:15:00+05:30',
  },
  {
    id: 'high-conviction-ai-ensemble',
    name: 'High-Conviction AI Calibrated Filter (70% Research)',
    version: '1.4.0',
    category: 'ENSEMBLE',
    description: 'Selective filter requiring aligned market regime, Session VWAP confluence, R/R >= 1.5, and calibrated ML probability >= 0.62.',
    allowedRegimes: ['STRONG_TREND_BULL', 'STRONG_TREND_BEAR', 'HIGH_VOL_BREAKOUT'],
    entryConditions: [
      { indicator: 'ADX', operator: '>=', value: 20 },
      { indicator: 'REL_VOL', operator: '>=', value: 1.15 },
    ],
    stopLossAtrMult: 1.1,
    target1AtrMult: 1.65,
    target2AtrMult: 2.4,
    trailingStopAtrMult: 0.85,
    maxHoldingBars: 18,
    minProbThreshold: 0.62,
    isCustom: false,
    enabled: true,
    createdAt: '2026-11-01T09:15:00+05:30',
  },
];

export interface StrategySignalCandidate {
  side: 'BUY' | 'SELL' | null;
  reason: string;
}

/**
 * Evaluates a strategy causally at bar index i using ONLY data up to bar i.
 */
export function evaluateStrategyAtBar(
  strategy: StrategyConfig,
  candles: Candle[],
  indicators: IndicatorPoint[],
  i: number,
  regime: MarketRegime,
  mlProbUp: number,
  mlProbDown = 1 - mlProbUp
): StrategySignalCandidate {
  if (i < 28 || i >= candles.length - 1) {
    return { side: null, reason: 'Insufficient warmup bars' };
  }

  // Block entries near EOD square-off (after 14:45 IST)
  const istHhMm = candles[i].istLabel.slice(11, 16);
  if (istHhMm >= '14:45') {
    return { side: null, reason: 'Intraday entry cutoff (14:45 IST)' };
  }

  if (!strategy.allowedRegimes.includes(regime)) {
    return { side: null, reason: `Regime ${regime} excluded by strategy rules` };
  }

  const c = candles[i];
  const prev = candles[i - 1];
  const ind = indicators[i];
  const prevInd = indicators[i - 1];

  // Cost-viability guard: target1 expected move must comfortably exceed NSE round-trip statutory fees + spread + slippage (~0.18%)
  if (c.volume <= 0 || ind.atr14 * strategy.target1AtrMult < c.close * 0.0018) {
    return { side: null, reason: 'Expected ATR move too small relative to NSE execution costs or zero volume' };
  }

  // Custom no-code visual strategy evaluation
  if (strategy.isCustom) {
    const bullPass = evaluateCustomConditions(strategy.entryConditions, c, prev, ind, prevInd, 'BUY');
    if (bullPass && mlProbUp >= strategy.minProbThreshold) {
      return { side: 'BUY', reason: `Custom rules matched (${strategy.entryConditions.length} conditions) with ML P(Up)=${(mlProbUp * 100).toFixed(1)}%` };
    }
    const bearPass = evaluateCustomConditions(strategy.entryConditions, c, prev, ind, prevInd, 'SELL');
    if (bearPass && mlProbDown >= strategy.minProbThreshold) {
      return { side: 'SELL', reason: `Custom short rules matched with ML P(Down)=${(mlProbDown * 100).toFixed(1)}%` };
    }
    return { side: null, reason: 'Custom rule conditions not met' };
  }

  switch (strategy.id) {
    case 'orb-15-breakout': {
      if (c.close > ind.orbHigh && prev.close <= prevInd.orbHigh && c.close > ind.vwap && ind.relVolume >= 1.35) {
        return { side: 'BUY', reason: `Broke 15m Opening Range High (${ind.orbHigh}) above VWAP (${ind.vwap}) on ${ind.relVolume}x RelVol` };
      }
      if (c.close < ind.orbLow && prev.close >= prevInd.orbLow && c.close < ind.vwap && ind.relVolume >= 1.35) {
        return { side: 'SELL', reason: `Broke 15m Opening Range Low (${ind.orbLow}) below VWAP (${ind.vwap}) on ${ind.relVolume}x RelVol` };
      }
      return { side: null, reason: 'Price inside opening range or lacking 1.35x volume confirmation' };
    }

    case 'vwap-momentum-pullback': {
      const nearVwap = Math.abs(c.low - ind.vwap) <= ind.atr14 * 0.45;
      if (regime === 'STRONG_TREND_BULL' && nearVwap && c.close > ind.vwap && ind.ema9 > ind.ema21 && ind.rsi14 > 50 && ind.rsi14 < 68) {
        return { side: 'BUY', reason: `Bullish pullback bounce off Session VWAP (${ind.vwap}) with EMA9>EMA21 and ADX ${ind.adx14}` };
      }
      const nearVwapShort = Math.abs(c.high - ind.vwap) <= ind.atr14 * 0.45;
      if (regime === 'STRONG_TREND_BEAR' && nearVwapShort && c.close < ind.vwap && ind.ema9 < ind.ema21 && ind.rsi14 < 50 && ind.rsi14 > 32) {
        return { side: 'SELL', reason: `Bearish rejection at Session VWAP (${ind.vwap}) with EMA9<EMA21 and ADX ${ind.adx14}` };
      }
      return { side: null, reason: 'Awaiting VWAP pullback setup' };
    }

    case 'supertrend-adx-trend': {
      if (ind.supertrendDir === 1 && prevInd.supertrendDir === -1 && ind.adx14 >= 20) {
        return { side: 'BUY', reason: `Supertrend flipped Bullish at ${ind.supertrend} with ADX ${ind.adx14}` };
      }
      if (ind.supertrendDir === -1 && prevInd.supertrendDir === 1 && ind.adx14 >= 20) {
        return { side: 'SELL', reason: `Supertrend flipped Bearish at ${ind.supertrend} with ADX ${ind.adx14}` };
      }
      return { side: null, reason: 'No fresh Supertrend directional flip' };
    }

    case 'bollinger-mean-reversion': {
      if (c.low <= ind.bbLower && c.close > ind.bbLower && ind.rsi14 <= 38) {
        return { side: 'BUY', reason: `Rebounded off Lower Bollinger Band (${ind.bbLower}) in sideways range (RSI ${ind.rsi14})` };
      }
      if (c.high >= ind.bbUpper && c.close < ind.bbUpper && ind.rsi14 >= 62) {
        return { side: 'SELL', reason: `Rejected Upper Bollinger Band (${ind.bbUpper}) in sideways range (RSI ${ind.rsi14})` };
      }
      return { side: null, reason: 'Price within Bollinger Bands' };
    }

    case 'ema-9-21-volume-cross': {
      if (ind.ema9 > ind.ema21 && prevInd.ema9 <= prevInd.ema21 && ind.relVolume >= 1.1) {
        return { side: 'BUY', reason: `EMA(9) crossed above EMA(21) on ${ind.relVolume}x RelVol` };
      }
      if (ind.ema9 < ind.ema21 && prevInd.ema9 >= prevInd.ema21 && ind.relVolume >= 1.1) {
        return { side: 'SELL', reason: `EMA(9) crossed below EMA(21) on ${ind.relVolume}x RelVol` };
      }
      return { side: null, reason: 'No EMA 9/21 crossover on current bar' };
    }

    case 'rsi-exhaustion-reversal': {
      if (prevInd.rsi14 < 31 && ind.rsi14 >= 31 && c.close > c.open) {
        return { side: 'BUY', reason: `RSI(14) recovered from oversold (${prevInd.rsi14} -> ${ind.rsi14}) with bullish candle` };
      }
      if (prevInd.rsi14 > 69 && ind.rsi14 <= 69 && c.close < c.open) {
        return { side: 'SELL', reason: `RSI(14) rolled over from overbought (${prevInd.rsi14} -> ${ind.rsi14}) with bearish candle` };
      }
      return { side: null, reason: 'RSI not in exhaustion zone' };
    }

    case 'macd-histogram-breakout': {
      if (ind.macdHist > 0 && prevInd.macdHist <= 0 && c.close > ind.vwap) {
        return { side: 'BUY', reason: `MACD histogram crossed positive above VWAP (${ind.vwap})` };
      }
      if (ind.macdHist < 0 && prevInd.macdHist >= 0 && c.close < ind.vwap) {
        return { side: 'SELL', reason: `MACD histogram crossed negative below VWAP (${ind.vwap})` };
      }
      return { side: null, reason: 'No MACD histogram zero cross' };
    }

    case 'volume-shock-breakout': {
      if (ind.relVolume >= 1.8 && c.close > prevInd.resistance) {
        return { side: 'BUY', reason: `Volume shock (${ind.relVolume}x) broke 20-bar resistance ${prevInd.resistance}` };
      }
      if (ind.relVolume >= 1.8 && c.close < prevInd.support) {
        return { side: 'SELL', reason: `Volume shock (${ind.relVolume}x) broke 20-bar support ${prevInd.support}` };
      }
      return { side: null, reason: 'No 1.8x volume breakout' };
    }

    case 'mtf-vwap-trend': {
      if (c.close > ind.sma50 && c.close > ind.vwap && ind.ema9 > ind.ema21 && ind.adx14 >= 20 && prev.close <= prevInd.vwap) {
        return { side: 'BUY', reason: `Reclaimed Session VWAP (${ind.vwap}) above SMA50 (${ind.sma50}) with ADX ${ind.adx14}` };
      }
      if (c.close < ind.sma50 && c.close < ind.vwap && ind.ema9 < ind.ema21 && ind.adx14 >= 20 && prev.close >= prevInd.vwap) {
        return { side: 'SELL', reason: `Lost Session VWAP (${ind.vwap}) below SMA50 (${ind.sma50}) with ADX ${ind.adx14}` };
      }
      return { side: null, reason: 'Multi-timeframe VWAP alignment inactive' };
    }

    case 'volatility-squeeze-release': {
      const prevWidth = prevInd.bbUpper - prevInd.bbLower;
      const curWidth = ind.bbUpper - ind.bbLower;
      if (curWidth > prevWidth * 1.12 && ind.relVolume >= 1.25) {
        if (c.close > ind.bbUpper) return { side: 'BUY', reason: `Volatility squeeze expanded upward above BB Upper (${ind.bbUpper})` };
        if (c.close < ind.bbLower) return { side: 'SELL', reason: `Volatility squeeze expanded downward below BB Lower (${ind.bbLower})` };
      }
      return { side: null, reason: 'No volatility squeeze expansion' };
    }

    case 'price-action-hh-hl': {
      if (c.high > prev.high && prev.low > candles[i - 2].low && c.close > ind.vwap && ind.ema9 > ind.ema21) {
        return { side: 'BUY', reason: `Higher-High / Higher-Low structure break above VWAP` };
      }
      if (c.low < prev.low && prev.high < candles[i - 2].high && c.close < ind.vwap && ind.ema9 < ind.ema21) {
        return { side: 'SELL', reason: `Lower-Low / Lower-High structure break below VWAP` };
      }
      return { side: null, reason: 'No clean price-action swing break' };
    }

    case 'opening-gap-reversal': {
      const distAtr = (c.close - ind.vwap) / Math.max(0.05, ind.atr14);
      if (distAtr < -1.5 && c.close > c.open && ind.rsi14 < 40) {
        return { side: 'BUY', reason: `Extended ${Math.abs(distAtr).toFixed(1)} ATR below VWAP with bullish reversal bar` };
      }
      if (distAtr > 1.5 && c.close < c.open && ind.rsi14 > 60) {
        return { side: 'SELL', reason: `Extended ${distAtr.toFixed(1)} ATR above VWAP with bearish rejection bar` };
      }
      return { side: null, reason: 'Gap extension insufficient for reversal' };
    }

    case 'regime-adaptive-ensemble': {
      if (regime === 'SIDEWAYS_RANGE') {
        if (c.low <= ind.bbLower && c.close > ind.bbLower) {
          return { side: 'BUY', reason: `Regime=SIDEWAYS_RANGE -> Lower BB reversion trigger` };
        }
        if (c.high >= ind.bbUpper && c.close < ind.bbUpper) {
          return { side: 'SELL', reason: `Regime=SIDEWAYS_RANGE -> Upper BB reversion trigger` };
        }
      } else if (regime === 'HIGH_VOL_BREAKOUT') {
        if (c.close > ind.orbHigh && ind.relVolume >= 1.35) {
          return { side: 'BUY', reason: `Regime=HIGH_VOL_BREAKOUT -> ORB-15 upside breakout` };
        }
        if (c.close < ind.orbLow && ind.relVolume >= 1.35) {
          return { side: 'SELL', reason: `Regime=HIGH_VOL_BREAKOUT -> ORB-15 downside breakdown` };
        }
      } else if (regime === 'STRONG_TREND_BULL' && c.close > ind.vwap && ind.ema9 > ind.ema21 && ind.rsi14 > 52 && ind.rsi14 < 70) {
        return { side: 'BUY', reason: `Regime=STRONG_TREND_BULL -> Momentum continuation above VWAP` };
      } else if (regime === 'STRONG_TREND_BEAR' && c.close < ind.vwap && ind.ema9 < ind.ema21 && ind.rsi14 < 48 && ind.rsi14 > 30) {
        return { side: 'SELL', reason: `Regime=STRONG_TREND_BEAR -> Momentum continuation below VWAP` };
      }
      return { side: null, reason: `Regime ${regime} conditions not triggered` };
    }

    case 'institutional-vwap-reversion': {
      const z = (c.close - ind.vwap) / Math.max(0.05, ind.atr14);
      if (z <= -1.85 && c.close > c.open) {
        return { side: 'BUY', reason: `Stretched ${z.toFixed(2)} ATR below Session VWAP — reversion toward ${ind.vwap}` };
      }
      if (z >= 1.85 && c.close < c.open) {
        return { side: 'SELL', reason: `Stretched +${z.toFixed(2)} ATR above Session VWAP — reversion toward ${ind.vwap}` };
      }
      return { side: null, reason: 'Within normal ±1.85 ATR VWAP band' };
    }

    case 'high-conviction-ai-ensemble': {
      if (
        mlProbUp >= strategy.minProbThreshold &&
        mlProbUp > mlProbDown &&
        c.close > ind.vwap &&
        ind.ema9 > ind.ema21 &&
        ind.supertrendDir === 1 &&
        ind.adx14 >= 20 &&
        ind.relVolume >= 1.1
      ) {
        return {
          side: 'BUY',
          reason: `Calibrated ML P(Up)=${(mlProbUp * 100).toFixed(1)}% + VWAP + Supertrend + ADX ${ind.adx14} confluence`,
        };
      }
      if (
        mlProbDown >= strategy.minProbThreshold &&
        mlProbDown > mlProbUp &&
        c.close < ind.vwap &&
        ind.ema9 < ind.ema21 &&
        ind.supertrendDir === -1 &&
        ind.adx14 >= 20 &&
        ind.relVolume >= 1.1
      ) {
        return {
          side: 'SELL',
          reason: `Calibrated ML P(Down)=${(mlProbDown * 100).toFixed(1)}% + VWAP + Supertrend + ADX ${ind.adx14} confluence`,
        };
      }
      return { side: null, reason: `ML calibrated probabilities (Up ${(mlProbUp * 100).toFixed(1)}%, Down ${(mlProbDown * 100).toFixed(1)}%) below ${Math.round(strategy.minProbThreshold * 100)}% conviction floor` };
    }

    default:
      return { side: null, reason: 'Unknown strategy ID' };
  }
}

function evaluateCustomConditions(
  conditions: StrategyRuleCondition[],
  c: Candle,
  _prev: Candle,
  ind: IndicatorPoint,
  prevInd: IndicatorPoint,
  side: 'BUY' | 'SELL'
): boolean {
  if (conditions.length === 0) return false;
  for (const cond of conditions) {
    switch (cond.indicator) {
      case 'RSI': {
        if (side === 'BUY') {
          if (cond.operator === '>' && !(ind.rsi14 > cond.value)) return false;
          if (cond.operator === '<' && !(ind.rsi14 < cond.value)) return false;
          if (cond.operator === '>=' && !(ind.rsi14 >= cond.value)) return false;
          if (cond.operator === '<=' && !(ind.rsi14 <= cond.value)) return false;
        } else {
          // Symmetric short mirror around 100 - value
          const mirror = 100 - cond.value;
          if (cond.operator === '>' && !(ind.rsi14 < mirror)) return false;
          if (cond.operator === '<' && !(ind.rsi14 > mirror)) return false;
          if (cond.operator === '>=' && !(ind.rsi14 <= mirror)) return false;
          if (cond.operator === '<=' && !(ind.rsi14 >= mirror)) return false;
        }
        break;
      }
      case 'ADX': {
        if (cond.operator === '>=' && !(ind.adx14 >= cond.value)) return false;
        if (cond.operator === '>' && !(ind.adx14 > cond.value)) return false;
        if (cond.operator === '<' && !(ind.adx14 < cond.value)) return false;
        if (cond.operator === '<=' && !(ind.adx14 <= cond.value)) return false;
        break;
      }
      case 'REL_VOL': {
        if (cond.operator === '>=' && !(ind.relVolume >= cond.value)) return false;
        if (cond.operator === '>' && !(ind.relVolume > cond.value)) return false;
        if (cond.operator === '<=' && !(ind.relVolume <= cond.value)) return false;
        if (cond.operator === '<' && !(ind.relVolume < cond.value)) return false;
        break;
      }
      case 'PRICE_VS_VWAP': {
        if (side === 'BUY' && cond.operator === 'ABOVE' && !(c.close > ind.vwap)) return false;
        if (side === 'BUY' && cond.operator === 'BELOW' && !(c.close < ind.vwap)) return false;
        if (side === 'SELL' && cond.operator === 'ABOVE' && !(c.close < ind.vwap)) return false;
        if (side === 'SELL' && cond.operator === 'BELOW' && !(c.close > ind.vwap)) return false;
        break;
      }
      case 'EMA_CROSS': {
        if (side === 'BUY' && !(ind.ema9 > ind.ema21 && prevInd.ema9 <= prevInd.ema21)) return false;
        if (side === 'SELL' && !(ind.ema9 < ind.ema21 && prevInd.ema9 >= prevInd.ema21)) return false;
        break;
      }
      case 'SUPERTREND': {
        if (side === 'BUY' && ind.supertrendDir !== 1) return false;
        if (side === 'SELL' && ind.supertrendDir !== -1) return false;
        break;
      }
      case 'BB_POS': {
        if (side === 'BUY' && !(c.close <= ind.bbLower)) return false;
        if (side === 'SELL' && !(c.close >= ind.bbUpper)) return false;
        break;
      }
    }
  }
  return true;
}

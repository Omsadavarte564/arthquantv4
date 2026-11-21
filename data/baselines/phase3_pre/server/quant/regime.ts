import { Candle, IndicatorPoint, MarketRegime } from '../../src/types/trading.ts';

/**
 * Classifies market regime causally using ADX, DI spread, Bollinger bandwidth,
 * Relative Volume, and Session VWAP positioning.
 */
export function classifyRegime(candle: Candle, ind: IndicatorPoint): MarketRegime {
  const bbWidthPct = ind.bbMiddle > 0 ? ((ind.bbUpper - ind.bbLower) / ind.bbMiddle) * 100 : 0;
  const atrPct = candle.close > 0 ? (ind.atr14 / candle.close) * 100 : 0;

  if (
    ind.relVolume >= 1.65 &&
    (candle.close > ind.orbHigh || candle.close < ind.orbLow) &&
    atrPct > 0.14
  ) {
    return 'HIGH_VOL_BREAKOUT';
  }

  if (ind.adx14 >= 22) {
    if (ind.plusDi > ind.minusDi && ind.ema9 >= ind.ema21 && candle.close >= ind.vwap * 0.999) {
      return 'STRONG_TREND_BULL';
    }
    if (ind.minusDi > ind.plusDi && ind.ema9 <= ind.ema21 && candle.close <= ind.vwap * 1.001) {
      return 'STRONG_TREND_BEAR';
    }
  }

  if (ind.adx14 < 19 && bbWidthPct < 1.35) {
    return 'SIDEWAYS_RANGE';
  }

  if (ind.adx14 < 16 && ind.relVolume < 0.75) {
    return 'UNCERTAIN_CHOP';
  }

  // Moderate trend or range boundary
  if (candle.close > ind.vwap && ind.ema9 > ind.ema21 && ind.adx14 >= 18) {
    return 'STRONG_TREND_BULL';
  }
  if (candle.close < ind.vwap && ind.ema9 < ind.ema21 && ind.adx14 >= 18) {
    return 'STRONG_TREND_BEAR';
  }

  return 'UNCERTAIN_CHOP';
}

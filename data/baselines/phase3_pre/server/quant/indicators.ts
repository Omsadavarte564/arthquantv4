import { Candle, IndicatorPoint } from '../../src/types/trading.ts';

function computeEmaArray(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = new Array(values.length);
  let ema = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      ema = values[0];
    } else if (i < period) {
      const slice = values.slice(0, i + 1);
      ema = slice.reduce((a, b) => a + b, 0) / slice.length;
    } else {
      ema = values[i] * k + ema * (1 - k);
    }
    out[i] = ema;
  }
  return out;
}

/**
 * Strictly causal indicator computation: bar i uses ONLY bars <= i.
 * Session VWAP and Opening Range reset at the start of every IST sessionDate.
 */
export function computeIndicators(candles: Candle[]): IndicatorPoint[] {
  const n = candles.length;
  if (n === 0) return [];

  const closes = candles.map((c) => c.close);
  const ema9 = computeEmaArray(closes, 9);
  const ema21 = computeEmaArray(closes, 21);
  const ema12 = computeEmaArray(closes, 12);
  const ema26 = computeEmaArray(closes, 26);

  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const macdSignal = computeEmaArray(macdLine, 9);

  const out: IndicatorPoint[] = new Array(n);

  // Wilder RSI(14) state
  let gainSum = 0;
  let lossSum = 0;
  let avgGain = 0;
  let avgLoss = 0;

  // Wilder ATR(14) & ADX(14) state
  let trSum = 0;
  let plusDmSum = 0;
  let minusDmSum = 0;
  let atr = 0;
  let smoothPlusDm = 0;
  let smoothMinusDm = 0;
  let smoothTr = 0;
  let dxSum = 0;
  let adx = 18;

  // Supertrend(10, 3.0) state
  let stUpperBand = 0;
  let stLowerBand = 0;
  let stDir: 1 | -1 = 1;
  let supertrend = closes[0];

  // Session VWAP & Opening Range state
  let currentSession = '';
  let cumPv = 0;
  let cumVol = 0;
  let sessionBarCount = 0;
  let orbHigh = candles[0].high;
  let orbLow = candles[0].low;

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const prev = i > 0 ? candles[i - 1] : c;

    // Reset intraday session accumulators
    if (c.sessionDate !== currentSession) {
      currentSession = c.sessionDate;
      cumPv = 0;
      cumVol = 0;
      sessionBarCount = 0;
      orbHigh = c.high;
      orbLow = c.low;
    }
    sessionBarCount++;
    // Opening Range = first 15 minutes (3 bars on 5m, 1 bar on 15m, 15 bars on 1m)
    const stepSec = i > 0 && c.sessionDate === prev.sessionDate ? Math.max(60, c.time - prev.time) : 300;
    const orbBars = Math.max(1, Math.round(900 / stepSec));
    if (sessionBarCount <= orbBars) {
      orbHigh = Math.max(orbHigh, c.high);
      orbLow = Math.min(orbLow, c.low);
    }

    const typicalPrice = (c.high + c.low + c.close) / 3;
    if (c.volume > 0) {
      cumPv += typicalPrice * c.volume;
      cumVol += c.volume;
    }
    const vwap = cumVol > 0 ? cumPv / cumVol : c.close;

    // SMA 50
    const smaStart = Math.max(0, i - 49);
    let smaSum = 0;
    for (let j = smaStart; j <= i; j++) smaSum += candles[j].close;
    const sma50 = smaSum / (i - smaStart + 1);

    // Bollinger Bands (20, 2)
    const bbStart = Math.max(0, i - 19);
    const bbLen = i - bbStart + 1;
    let bbSum = 0;
    for (let j = bbStart; j <= i; j++) bbSum += candles[j].close;
    const bbMiddle = bbSum / bbLen;
    let bbVar = 0;
    for (let j = bbStart; j <= i; j++) {
      const diff = candles[j].close - bbMiddle;
      bbVar += diff * diff;
    }
    const bbStd = Math.sqrt(bbVar / bbLen);
    const bbUpper = bbMiddle + 2 * bbStd;
    const bbLower = bbMiddle - 2 * bbStd;

    // Relative Volume (20 bars) — exclude zero-volume auction/halt bars from denominator
    const volStart = Math.max(0, i - 19);
    let volSum = 0;
    let nonZeroVolCount = 0;
    for (let j = volStart; j < i; j++) {
      if (candles[j].volume > 0) {
        volSum += candles[j].volume;
        nonZeroVolCount++;
      }
    }
    const avgVol = nonZeroVolCount > 0 ? volSum / nonZeroVolCount : c.volume;
    const relVolume = c.volume <= 0 ? 0 : avgVol > 0 ? c.volume / avgVol : 1;

    // True Range & Directional Movement (Wilder 14-bar SMA seed at bar 14)
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    const upMove = c.high - prev.high;
    const downMove = prev.low - c.low;
    const plusDm = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDm = downMove > upMove && downMove > 0 ? downMove : 0;

    if (i === 0) {
      trSum = tr;
      atr = tr;
      smoothTr = tr;
      smoothPlusDm = 0;
      smoothMinusDm = 0;
    } else if (i < 14) {
      trSum += tr;
      plusDmSum += plusDm;
      minusDmSum += minusDm;
      atr = trSum / (i + 1);
      smoothTr = trSum;
      smoothPlusDm = plusDmSum;
      smoothMinusDm = minusDmSum;
    } else if (i === 14) {
      trSum += tr;
      plusDmSum += plusDm;
      minusDmSum += minusDm;
      atr = trSum / 14;
      smoothTr = trSum;
      smoothPlusDm = plusDmSum;
      smoothMinusDm = minusDmSum;
    } else {
      atr = (atr * 13 + tr) / 14;
      smoothTr = smoothTr - smoothTr / 14 + tr;
      smoothPlusDm = smoothPlusDm - smoothPlusDm / 14 + plusDm;
      smoothMinusDm = smoothMinusDm - smoothMinusDm / 14 + minusDm;
    }

    const plusDi = smoothTr > 0 ? (100 * smoothPlusDm) / smoothTr : 0;
    const minusDi = smoothTr > 0 ? (100 * smoothMinusDm) / smoothTr : 0;
    const dx = plusDi + minusDi > 0 ? (100 * Math.abs(plusDi - minusDi)) / (plusDi + minusDi) : 0;
    if (i >= 14 && i < 27) {
      dxSum += dx;
      adx = dxSum / (i - 13);
    } else if (i === 27) {
      dxSum += dx;
      adx = dxSum / 14;
    } else if (i > 27) {
      adx = (adx * 13 + dx) / 14;
    } else {
      adx = dx;
    }

    // Wilder RSI(14) with clean 14-bar SMA seed
    const change = i > 0 ? c.close - prev.close : 0;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    if (i === 0) {
      avgGain = 0;
      avgLoss = 0;
    } else if (i < 14) {
      gainSum += gain;
      lossSum += loss;
      avgGain = gainSum / i;
      avgLoss = lossSum / i;
    } else if (i === 14) {
      gainSum += gain;
      lossSum += loss;
      avgGain = gainSum / 14;
      avgLoss = lossSum / 14;
    } else {
      avgGain = (avgGain * 13 + gain) / 14;
      avgLoss = (avgLoss * 13 + loss) / 14;
    }
    const rs = avgLoss === 0 ? (avgGain === 0 ? 1 : 100) : avgGain / avgLoss;
    const rsi14 = 100 - 100 / (1 + rs);

    // Supertrend (ATR 14, multiplier 2.8)
    const hl2 = (c.high + c.low) / 2;
    const basicUpper = hl2 + 2.8 * atr;
    const basicLower = hl2 - 2.8 * atr;
    if (i === 0) {
      stUpperBand = basicUpper;
      stLowerBand = basicLower;
      stDir = 1;
      supertrend = stLowerBand;
    } else {
      stUpperBand = basicUpper < stUpperBand || prev.close > stUpperBand ? basicUpper : stUpperBand;
      stLowerBand = basicLower > stLowerBand || prev.close < stLowerBand ? basicLower : stLowerBand;
      if (stDir === 1 && c.close < stLowerBand) {
        stDir = -1;
      } else if (stDir === -1 && c.close > stUpperBand) {
        stDir = 1;
      }
      supertrend = stDir === 1 ? stLowerBand : stUpperBand;
    }

    // Rolling 20-bar Support & Resistance
    let rollLow = c.low;
    let rollHigh = c.high;
    for (let j = bbStart; j <= i; j++) {
      if (candles[j].low < rollLow) rollLow = candles[j].low;
      if (candles[j].high > rollHigh) rollHigh = candles[j].high;
    }

    out[i] = {
      time: c.time,
      ema9: round4(ema9[i]),
      ema21: round4(ema21[i]),
      sma50: round4(sma50),
      rsi14: round2(rsi14),
      macd: round4(macdLine[i]),
      macdSignal: round4(macdSignal[i]),
      macdHist: round4(macdLine[i] - macdSignal[i]),
      vwap: round2(vwap),
      atr14: round2(atr),
      adx14: round2(adx),
      plusDi: round2(plusDi),
      minusDi: round2(minusDi),
      supertrend: round2(supertrend),
      supertrendDir: stDir,
      bbUpper: round2(bbUpper),
      bbMiddle: round2(bbMiddle),
      bbLower: round2(bbLower),
      relVolume: round2(relVolume),
      orbHigh: round2(orbHigh),
      orbLow: round2(orbLow),
      support: round2(rollLow),
      resistance: round2(rollHigh),
    };
  }

  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

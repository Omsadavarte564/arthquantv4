import {
  CalibrationBin,
  Candle,
  FeatureImportance,
  IndicatorPoint,
  MarketRegime,
  MlBaselineComparison,
  MlClassificationMetrics,
  MlEvaluationResult,
  MlRegimePerformance,
  MlWalkForwardFold,
  ModelFamily,
  MultiModelBenchmarkEntry,
  Timeframe,
} from '../../src/types/trading.ts';
import { calculateWilsonCI } from './costs.ts';
import { computeIndicators } from './indicators.ts';
import { classifyRegime } from './regime.ts';

export const ML_PREDICTION_HORIZON_BARS = 10;

const FEATURE_NAMES = [
  'VWAP Z-Deviation',
  'EMA 9/21 Spread / ATR',
  'Wilder RSI(14) Centered',
  'ADX(14) Trend Intensity',
  'DI Directional Bias',
  'Log Relative Volume',
  'Bollinger %B Position',
  'Supertrend Alignment',
  '3-Bar Momentum / ATR',
  'ORB Range Position',
  'Session Time Progress',
  'ATR Volatility Regime',
  'NIFTY50 VWAP Align',
  'Rel Strength vs NIFTY50',
];

export interface IndexMarketContext {
  candles: Candle[];
  indicators: IndicatorPoint[];
}

export function buildIndexContextMap(
  indexCandles?: Candle[]
): IndexMarketContext | undefined {
  if (!indexCandles || indexCandles.length < 30) return undefined;
  return {
    candles: indexCandles,
    indicators: computeIndicators(indexCandles),
  };
}

/**
 * Strictly causal lookup of the latest NIFTY50 bar whose timestamp <= stockBarTime.
 */
function findCausalIndexBar(
  idxCtx: IndexMarketContext | undefined,
  stockBarTime: number,
  cursorHint: { idx: number }
): { close: number; vwap: number; atr14: number; ret6: number } | undefined {
  if (!idxCtx || idxCtx.candles.length < 10) return undefined;
  const cands = idxCtx.candles;
  let j = cursorHint.idx;
  if (j >= cands.length || cands[j].time > stockBarTime) {
    // Binary search fallback when cursor resets
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
    j = ans;
  } else {
    while (j + 1 < cands.length && cands[j + 1].time <= stockBarTime) {
      j++;
    }
  }
  cursorHint.idx = Math.max(0, j);
  if (j < 6 || cands[j].time > stockBarTime) return undefined;
  const cur = cands[j];
  const prev6 = cands[j - 6];
  const ind = idxCtx.indicators[j];
  const ret6 = prev6.close > 0 ? (cur.close - prev6.close) / prev6.close : 0;
  return {
    close: cur.close,
    vwap: ind.vwap,
    atr14: ind.atr14,
    ret6,
  };
}

/**
 * Single causal alignment helper shared across mlEngine, signals, and backtester
 * to prevent training-serving skew on NIFTY50 context features.
 */
export function getCausalIndexAlignment(
  idxCtx: IndexMarketContext | undefined,
  stockBarTime: number
): { close: number; vwap: number; atr14: number; ret6: number } | undefined {
  return findCausalIndexBar(idxCtx, stockBarTime, { idx: 0 });
}

interface SingleBinaryHead {
  weights: number[];
  bias: number;
  plattA: number;
  plattB: number;
}

interface MultinomialSoftmaxHead {
  // 3 classes: 0 = UP, 1 = DOWN, 2 = TIMEOUT
  weights: number[][]; // [3][dims]
  bias: number[];      // [3]
  temperature: number;
}

interface DecisionTreeNode {
  leafProbs?: [number, number, number]; // [P_UP, P_DOWN, P_TIMEOUT]
  featureIdx?: number;
  threshold?: number;
  left?: DecisionTreeNode;
  right?: DecisionTreeNode;
}

interface RegressionTreeNode {
  leafVal?: number;
  featureIdx?: number;
  threshold?: number;
  left?: RegressionTreeNode;
  right?: RegressionTreeNode;
}

export interface TrainedLogisticModel {
  // Primary Dual Logistic + Platt fields preserved cleanly for backward compatibility
  weights: number[];
  bias: number;
  plattA: number;
  plattB: number;
  downHead: SingleBinaryHead;
  // Optional promoted/alternative model heads
  modelFamily?: ModelFamily;
  softmaxHead?: MultinomialSoftmaxHead;
  rfTrees?: DecisionTreeNode[];
  rfTemperature?: number;
  gbdt?: {
    classTrees: [RegressionTreeNode[], RegressionTreeNode[], RegressionTreeNode[]];
    baseLogits: [number, number, number];
    learningRate: number;
    temperature: number;
    featureGains: number[];
  };
  means: number[];
  stds: number[];
  modelVersion: string;
}

/**
 * Extracts strictly causal feature vector at bar index i using only <= i data.
 */
export function extractCausalFeatures(
  candle: Candle,
  ind: IndicatorPoint,
  history?: {
    candles: Candle[];
    index: number;
    niftyAligned?: { close: number; vwap: number; atr14: number; ret6: number };
  }
): number[] {
  const atr = Math.max(0.05, ind.atr14);
  const vwapZ = clamp((candle.close - ind.vwap) / atr, -4, 4);
  const emaSpread = clamp((ind.ema9 - ind.ema21) / atr, -3, 3);
  const rsiNorm = clamp((ind.rsi14 - 50) / 25, -2, 2);
  const adxNorm = clamp((ind.adx14 - 20) / 15, -1.5, 2.5);
  const diBias = clamp((ind.plusDi - ind.minusDi) / 40, -2, 2);
  const logRelVol = clamp(Math.log1p(Math.max(0, ind.relVolume)) - 0.7, -1.5, 2.0);
  const bbDenom = Math.max(0.05, ind.bbUpper - ind.bbLower);
  const bbPos = clamp((candle.close - ind.bbLower) / bbDenom - 0.5, -1.5, 1.5);
  const stAlign = ind.supertrendDir;

  let mom3Atr = 0;
  let orbPos = clamp((candle.close - 0.5 * (ind.orbHigh + ind.orbLow)) / Math.max(atr, ind.orbHigh - ind.orbLow), -3, 3);
  const hh = Number(candle.istLabel.slice(11, 13)) || 9;
  const mm = Number(candle.istLabel.slice(14, 16)) || 15;
  const minsFromOpen = Math.max(0, Math.min(375, (hh * 60 + mm) - (9 * 60 + 15)));
  const sessionProgress = clamp(minsFromOpen / 375 - 0.5, -0.5, 0.5);
  const atrPctNorm = clamp(((atr / Math.max(1, candle.close)) * 100 - 0.22) / 0.15, -2, 3);
  let niftyAlign = 0;
  let relStrengthNifty = 0;

  if (history && history.candles.length > history.index && history.index >= 6) {
    const c3 = history.candles[history.index - 3];
    const c6 = history.candles[history.index - 6];
    mom3Atr = clamp((candle.close - c3.close) / atr, -3, 3);
    const stockRet6 = c6.close > 0 ? (candle.close - c6.close) / c6.close : 0;
    if (history.niftyAligned) {
      niftyAlign = clamp(
        (history.niftyAligned.close - history.niftyAligned.vwap) / Math.max(1, history.niftyAligned.atr14),
        -3,
        3
      );
      relStrengthNifty = clamp((stockRet6 - history.niftyAligned.ret6) * 100, -3, 3);
    }
  } else {
    // Keep orbPos deterministic across simple 2-arg calls too
    orbPos = clamp((candle.close - 0.5 * (ind.orbHigh + ind.orbLow)) / Math.max(atr, ind.orbHigh - ind.orbLow), -3, 3);
  }

  return [
    vwapZ,
    emaSpread,
    rsiNorm,
    adxNorm,
    diBias,
    logRelVol,
    bbPos,
    stAlign,
    mom3Atr,
    orbPos,
    sessionProgress,
    atrPctNorm,
    niftyAlign,
    relStrengthNifty,
  ];
}

function sigmoid(z: number): number {
  if (z > 20) return 1 - 1e-9;
  if (z < -20) return 1e-9;
  return 1 / (1 + Math.exp(-z));
}

function softmax3(logits: [number, number, number]): [number, number, number] {
  const m = Math.max(logits[0], logits[1], logits[2]);
  const e0 = Math.exp(clamp(logits[0] - m, -20, 20));
  const e1 = Math.exp(clamp(logits[1] - m, -20, 20));
  const e2 = Math.exp(clamp(logits[2] - m, -20, 20));
  const sum = e0 + e1 + e2;
  return [e0 / sum, e1 / sum, e2 / sum];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface LabeledDatasetItem {
  index: number;
  maxLabelBar: number;
  istLabel: string;
  regime: MarketRegime;
  candle: Candle;
  prevCandle: Candle;
  ind: IndicatorPoint;
  sample: {
    features: number[];
    labelUp: number;
    labelDown: number;
    class3: 0 | 1 | 2; // 0=UP, 1=DOWN, 2=TIMEOUT
  };
}

/**
 * Builds forward-looking triple-barrier labels strictly for offline training/validation.
 * Excludes zero-volume starting bars cleanly from execution entry reference where next bar has volume===0.
 */
export function buildLabeledDataset(
  candles: Candle[],
  indicators: IndicatorPoint[],
  horizon = ML_PREDICTION_HORIZON_BARS,
  indexContext?: IndexMarketContext
): LabeledDatasetItem[] {
  const out: LabeledDatasetItem[] = [];
  const startWarmup = Math.min(28, Math.max(25, candles.length - horizon - 15));
  const idxCursor = { idx: 0 };

  for (let i = startWarmup; i < candles.length - horizon - 1; i++) {
    const c = candles[i];
    const ind = indicators[i];
    const nextBar = candles[i + 1];

    // A trade can only be entered on the next bar of the SAME session. Samples whose
    // next bar is an overnight gap cannot be executed intraday and must be skipped
    // rather than labelled with next-session prices.
    if (nextBar.sessionDate !== c.sessionDate || nextBar.volume <= 0) continue;

    const entry = nextBar.open;
    const atr = Math.max(0.1, ind.atr14);

    const targetUp = entry + 1.35 * atr;
    const stopDown = entry - 1.0 * atr;
    const targetShort = entry - 1.35 * atr;
    const stopShort = entry + 1.0 * atr;

    // Single-pass first-touch evaluation. Stop is checked before target on the same bar
    // (conservative assumption). Evaluation never crosses into the next IST session.
    let labelUp = 0;
    let labelDown = 0;
    let maxBar = i + 1;
    let lastSameSessionClose = entry;
    let upResolved = false;
    let downResolved = false;

    for (let k = i + 1; k <= i + horizon; k++) {
      const bar = candles[k];
      if (bar.sessionDate !== c.sessionDate) break;
      maxBar = k;
      lastSameSessionClose = bar.close;

      // Long path: -1.0 ATR stop has priority over +1.35 ATR target.
      if (!upResolved) {
        if (bar.low <= stopDown) {
          upResolved = true;
        } else if (bar.high >= targetUp) {
          labelUp = 1;
          upResolved = true;
        }
      }

      // Short path: +1.0 ATR stop has priority over -1.35 ATR target.
      if (!downResolved) {
        if (bar.high >= stopShort) {
          downResolved = true;
        } else if (bar.low <= targetShort) {
          labelDown = 1;
          downResolved = true;
        }
      }

      if (upResolved && downResolved) break;
    }

    // Horizon / session-end fallback uses the last close observed within the same session.
    if (!upResolved) labelUp = lastSameSessionClose > entry * 1.0012 ? 1 : 0;
    if (!downResolved) labelDown = lastSameSessionClose < entry * 0.9988 ? 1 : 0;
    if (labelUp === 1 && labelDown === 1) {
      // A bar that spans both barriers is ambiguous; treat conservatively as no edge.
      labelUp = 0;
      labelDown = 0;
    }

    const class3: 0 | 1 | 2 = labelUp === 1 ? 0 : labelDown === 1 ? 1 : 2;

    const niftyAligned = findCausalIndexBar(indexContext, c.time, idxCursor);

    out.push({
      index: i,
      maxLabelBar: maxBar,
      istLabel: c.istLabel,
      regime: classifyRegime(c, ind),
      candle: c,
      prevCandle: candles[i - 1],
      ind,
      sample: {
        features: extractCausalFeatures(c, ind, { candles, index: i, niftyAligned }),
        labelUp,
        labelDown,
        class3,
      },
    });
  }
  return out;
}

function fitStandardizer(rows: number[][]): { means: number[]; stds: number[] } {
  const dims = rows[0]?.length ?? FEATURE_NAMES.length;
  const means = new Array(dims).fill(0);
  const stds = new Array(dims).fill(1);
  if (rows.length === 0) return { means, stds };

  for (const r of rows) {
    for (let d = 0; d < dims; d++) means[d] += r[d];
  }
  for (let d = 0; d < dims; d++) means[d] /= rows.length;

  for (const r of rows) {
    for (let d = 0; d < dims; d++) {
      const diff = r[d] - means[d];
      stds[d] += diff * diff;
    }
  }
  for (let d = 0; d < dims; d++) {
    stds[d] = Math.max(1e-5, Math.sqrt(stds[d] / rows.length));
  }
  return { means, stds };
}

function transformFeatures(x: number[], means: number[], stds: number[]): number[] {
  const out = new Array(means.length);
  for (let d = 0; d < means.length; d++) {
    out[d] = ((x[d] ?? 0) - means[d]) / stds[d];
  }
  return out;
}

function fitBinaryHead(
  trainItems: LabeledDatasetItem[],
  valItems: LabeledDatasetItem[],
  means: number[],
  stds: number[],
  getTarget: (item: LabeledDatasetItem) => number
): SingleBinaryHead {
  const dims = means.length;
  const weights = new Array(dims).fill(0);
  let bias = 0;

  const lr = 0.14;
  const l2 = 0.05;
  const epochs = 140;

  for (let ep = 0; ep < epochs; ep++) {
    const gradW = new Array(dims).fill(0);
    let gradB = 0;
    for (const item of trainItems) {
      const xs = transformFeatures(item.sample.features, means, stds);
      let z = bias;
      for (let d = 0; d < dims; d++) z += weights[d] * xs[d];
      const pred = sigmoid(z);
      const err = pred - getTarget(item);
      gradB += err;
      for (let d = 0; d < dims; d++) gradW[d] += err * xs[d];
    }
    const invN = 1 / Math.max(1, trainItems.length);
    bias -= lr * gradB * invN;
    for (let d = 0; d < dims; d++) {
      weights[d] -= lr * (gradW[d] * invN + l2 * weights[d]);
    }
  }

  let plattA = 1.0;
  let plattB = 0.0;
  if (valItems.length >= 15) {
    for (let ep = 0; ep < 90; ep++) {
      let gA = 0;
      let gB = 0;
      for (const item of valItems) {
        const xs = transformFeatures(item.sample.features, means, stds);
        let z = bias;
        for (let d = 0; d < dims; d++) z += weights[d] * xs[d];
        const p = sigmoid(plattA * z + plattB);
        const err = p - getTarget(item);
        gA += err * z;
        gB += err;
      }
      plattA -= 0.07 * (gA / valItems.length + 0.08 * (plattA - 1));
      plattB -= 0.07 * (gB / valItems.length + 0.04 * plattB);
      plattA = clamp(plattA, 0.25, 2.2);
      plattB = clamp(plattB, -1.2, 1.2);
    }
  }

  return { weights, bias, plattA, plattB };
}

function evalHeadProb(head: SingleBinaryHead, features: number[], means: number[], stds: number[]): number {
  const xs = transformFeatures(features, means, stds);
  let z = head.bias;
  for (let d = 0; d < head.weights.length; d++) z += head.weights[d] * xs[d];
  return sigmoid(head.plattA * z + head.plattB);
}

/**
 * Fits an explicit 3-Class L2-Regularized Multinomial Softmax classifier (UP / DOWN / TIMEOUT)
 * with validation temperature scaling so probabilities strictly sum to 1.0 cleanly.
 */
function fitMultinomial3ClassSoftmax(
  trainItems: LabeledDatasetItem[],
  valItems: LabeledDatasetItem[],
  means: number[],
  stds: number[]
): MultinomialSoftmaxHead {
  const dims = means.length;
  const weights = [new Array(dims).fill(0), new Array(dims).fill(0), new Array(dims).fill(0)];
  const bias = [0, 0, 0];

  const lr = 0.16;
  const l2 = 0.06;
  const epochs = 150;

  for (let ep = 0; ep < epochs; ep++) {
    const gradW = [new Array(dims).fill(0), new Array(dims).fill(0), new Array(dims).fill(0)];
    const gradB = [0, 0, 0];

    for (const item of trainItems) {
      const xs = transformFeatures(item.sample.features, means, stds);
      const logits: [number, number, number] = [bias[0], bias[1], bias[2]];
      for (let c = 0; c < 3; c++) {
        for (let d = 0; d < dims; d++) logits[c] += weights[c][d] * xs[d];
      }
      const probs = softmax3(logits);
      for (let c = 0; c < 3; c++) {
        const y = item.sample.class3 === c ? 1 : 0;
        const err = probs[c] - y;
        gradB[c] += err;
        for (let d = 0; d < dims; d++) gradW[c][d] += err * xs[d];
      }
    }

    const invN = 1 / Math.max(1, trainItems.length);
    for (let c = 0; c < 3; c++) {
      bias[c] -= lr * gradB[c] * invN;
      for (let d = 0; d < dims; d++) {
        weights[c][d] -= lr * (gradW[c][d] * invN + l2 * weights[c][d]);
      }
    }
  }

  // Validation temperature scaling (keeps probability ranking intact while minimizing NLL / ECE)
  let bestTemp = 1.0;
  if (valItems.length >= 20) {
    let bestLoss = Infinity;
    for (const candT of [0.75, 0.9, 1.0, 1.15, 1.35, 1.6, 2.0]) {
      let nll = 0;
      for (const item of valItems) {
        const xs = transformFeatures(item.sample.features, means, stds);
        const logits: [number, number, number] = [bias[0], bias[1], bias[2]];
        for (let c = 0; c < 3; c++) {
          for (let d = 0; d < dims; d++) logits[c] += weights[c][d] * xs[d];
          logits[c] /= candT;
        }
        const probs = softmax3(logits);
        nll -= Math.log(Math.max(1e-6, probs[item.sample.class3]));
      }
      if (nll < bestLoss) {
        bestLoss = nll;
        bestTemp = candT;
      }
    }
  }

  return { weights, bias, temperature: bestTemp };
}

function evalSoftmax3(head: MultinomialSoftmaxHead, features: number[], means: number[], stds: number[]): [number, number, number] {
  const xs = transformFeatures(features, means, stds);
  const logits: [number, number, number] = [head.bias[0], head.bias[1], head.bias[2]];
  for (let c = 0; c < 3; c++) {
    for (let d = 0; d < head.weights[c].length; d++) {
      logits[c] += head.weights[c][d] * xs[d];
    }
    logits[c] /= head.temperature;
  }
  return softmax3(logits);
}

// Deterministic PRNG for Random Forest feature subsampling / bagging
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gini3(c0: number, c1: number, c2: number): number {
  const tot = c0 + c1 + c2;
  if (tot <= 0) return 0;
  const p0 = c0 / tot;
  const p1 = c1 / tot;
  const p2 = c2 / tot;
  return 1 - (p0 * p0 + p1 * p1 + p2 * p2);
}

function buildRfTree(
  indices: number[],
  featuresMat: number[][],
  labels: (0 | 1 | 2)[],
  priors: [number, number, number],
  depth: number,
  maxDepth: number,
  minLeaf: number,
  rng: () => number
): DecisionTreeNode {
  let c0 = 0;
  let c1 = 0;
  let c2 = 0;
  for (const idx of indices) {
    const y = labels[idx];
    if (y === 0) c0++;
    else if (y === 1) c1++;
    else c2++;
  }
  const tot = indices.length;
  // Dirichlet-smoothed leaf probabilities toward training class priors
  const alpha = 6;
  const leafProbs: [number, number, number] = [
    (c0 + alpha * priors[0]) / (tot + alpha),
    (c1 + alpha * priors[1]) / (tot + alpha),
    (c2 + alpha * priors[2]) / (tot + alpha),
  ];

  if (depth >= maxDepth || tot < minLeaf * 2 || c0 === tot || c1 === tot || c2 === tot) {
    return { leafProbs };
  }

  const dims = featuresMat[0].length;
  const mtry = Math.max(3, Math.floor(Math.sqrt(dims)));
  const featPool = Array.from({ length: dims }, (_, i) => i);
  for (let i = featPool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = featPool[i];
    featPool[i] = featPool[j];
    featPool[j] = tmp;
  }
  const chosenFeats = featPool.slice(0, mtry);

  const parentImpurity = gini3(c0, c1, c2);
  let bestGain = 0.002;
  let bestFeat = -1;
  let bestThresh = 0;
  let bestLeft: number[] = [];
  let bestRight: number[] = [];

  for (const fIdx of chosenFeats) {
    // 5 quantile-ish candidate splits sampled deterministically from indices
    const vals = indices.map((idx) => featuresMat[idx][fIdx]).sort((a, b) => a - b);
    const thresholds: number[] = [];
    for (const q of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      thresholds.push(vals[Math.min(vals.length - 1, Math.floor(vals.length * q))]);
    }
    for (const th of thresholds) {
      let l0 = 0, l1 = 0, l2 = 0;
      let r0 = 0, r1 = 0, r2 = 0;
      for (const idx of indices) {
        const y = labels[idx];
        if (featuresMat[idx][fIdx] <= th) {
          if (y === 0) l0++;
          else if (y === 1) l1++;
          else l2++;
        } else {
          if (y === 0) r0++;
          else if (y === 1) r1++;
          else r2++;
        }
      }
      const nL = l0 + l1 + l2;
      const nR = r0 + r1 + r2;
      if (nL < minLeaf || nR < minLeaf) continue;
      const gain =
        parentImpurity -
        (nL / tot) * gini3(l0, l1, l2) -
        (nR / tot) * gini3(r0, r1, r2);
      if (gain > bestGain) {
        bestGain = gain;
        bestFeat = fIdx;
        bestThresh = th;
      }
    }
  }

  if (bestFeat < 0) return { leafProbs };

  bestLeft = indices.filter((idx) => featuresMat[idx][bestFeat] <= bestThresh);
  bestRight = indices.filter((idx) => featuresMat[idx][bestFeat] > bestThresh);

  return {
    featureIdx: bestFeat,
    threshold: bestThresh,
    left: buildRfTree(bestLeft, featuresMat, labels, priors, depth + 1, maxDepth, minLeaf, rng),
    right: buildRfTree(bestRight, featuresMat, labels, priors, depth + 1, maxDepth, minLeaf, rng),
  };
}

function predictRfTree(node: DecisionTreeNode, x: number[]): [number, number, number] {
  let cur: DecisionTreeNode | undefined = node;
  while (cur && !cur.leafProbs) {
    cur = (x[cur.featureIdx!] ?? 0) <= cur.threshold! ? cur.left : cur.right;
  }
  return cur?.leafProbs ?? [0.34, 0.33, 0.33];
}

function fitRandomForest3Class(
  trainItems: LabeledDatasetItem[],
  valItems: LabeledDatasetItem[]
): { trees: DecisionTreeNode[]; temperature: number } {
  const feats = trainItems.map((it) => it.sample.features);
  const labels = trainItems.map((it) => it.sample.class3);
  const n = Math.max(1, trainItems.length);
  const priors: [number, number, number] = [
    labels.filter((y) => y === 0).length / n,
    labels.filter((y) => y === 1).length / n,
    labels.filter((y) => y === 2).length / n,
  ];
  const rng = mulberry32(4202026 + trainItems.length);
  const trees: DecisionTreeNode[] = [];
  const numTrees = 20;
  const minLeaf = Math.max(12, Math.floor(n * 0.03));

  for (let t = 0; t < numTrees; t++) {
    const bag: number[] = [];
    for (let k = 0; k < n; k++) {
      bag.push(Math.floor(rng() * n));
    }
    trees.push(buildRfTree(bag, feats, labels, priors, 0, 3, minLeaf, rng));
  }

  // Validation temperature scaling on log-mean probabilities
  let bestTemp = 1.0;
  if (valItems.length >= 20) {
    let bestLoss = Infinity;
    for (const candT of [0.85, 1.0, 1.2, 1.5, 1.8]) {
      let nll = 0;
      for (const item of valItems) {
        const raw = evalRfProbs(trees, item.sample.features, 1.0);
        const logits: [number, number, number] = [
          Math.log(Math.max(1e-6, raw[0])) / candT,
          Math.log(Math.max(1e-6, raw[1])) / candT,
          Math.log(Math.max(1e-6, raw[2])) / candT,
        ];
        const cal = softmax3(logits);
        nll -= Math.log(Math.max(1e-6, cal[item.sample.class3]));
      }
      if (nll < bestLoss) {
        bestLoss = nll;
        bestTemp = candT;
      }
    }
  }

  return { trees, temperature: bestTemp };
}

function evalRfProbs(
  trees: DecisionTreeNode[],
  features: number[],
  temperature: number
): [number, number, number] {
  if (trees.length === 0) return [0.34, 0.33, 0.33];
  let s0 = 0, s1 = 0, s2 = 0;
  for (const t of trees) {
    const p = predictRfTree(t, features);
    s0 += p[0];
    s1 += p[1];
    s2 += p[2];
  }
  const m = trees.length;
  const avg: [number, number, number] = [s0 / m, s1 / m, s2 / m];
  if (Math.abs(temperature - 1.0) < 1e-4) return avg;
  return softmax3([
    Math.log(Math.max(1e-6, avg[0])) / temperature,
    Math.log(Math.max(1e-6, avg[1])) / temperature,
    Math.log(Math.max(1e-6, avg[2])) / temperature,
  ]);
}

function buildRegTree(
  indices: number[],
  featuresMat: number[][],
  gradients: number[],
  hessians: number[],
  depth: number,
  maxDepth: number,
  minLeaf: number,
  lambdaL2: number,
  gainsOut: number[]
): RegressionTreeNode {
  let gSum = 0;
  let hSum = 0;
  for (const idx of indices) {
    gSum += gradients[idx];
    hSum += hessians[idx];
  }
  const leafVal = -gSum / (hSum + lambdaL2);

  if (depth >= maxDepth || indices.length < minLeaf * 2) {
    return { leafVal };
  }

  const parentScore = (gSum * gSum) / (hSum + lambdaL2);
  let bestGain = 0.05;
  let bestFeat = -1;
  let bestThresh = 0;

  const dims = featuresMat[0].length;
  for (let fIdx = 0; fIdx < dims; fIdx++) {
    const vals = indices.map((idx) => featuresMat[idx][fIdx]).sort((a, b) => a - b);
    for (const q of [0.2, 0.4, 0.5, 0.6, 0.8]) {
      const th = vals[Math.min(vals.length - 1, Math.floor(vals.length * q))];
      let gL = 0, hL = 0, nL = 0;
      for (const idx of indices) {
        if (featuresMat[idx][fIdx] <= th) {
          gL += gradients[idx];
          hL += hessians[idx];
          nL++;
        }
      }
      const nR = indices.length - nL;
      if (nL < minLeaf || nR < minLeaf) continue;
      const gR = gSum - gL;
      const hR = hSum - hL;
      const gain = 0.5 * ((gL * gL) / (hL + lambdaL2) + (gR * gR) / (hR + lambdaL2) - parentScore);
      if (gain > bestGain) {
        bestGain = gain;
        bestFeat = fIdx;
        bestThresh = th;
      }
    }
  }

  if (bestFeat < 0) return { leafVal };
  gainsOut[bestFeat] = (gainsOut[bestFeat] ?? 0) + bestGain;

  const leftIdx = indices.filter((idx) => featuresMat[idx][bestFeat] <= bestThresh);
  const rightIdx = indices.filter((idx) => featuresMat[idx][bestFeat] > bestThresh);

  return {
    featureIdx: bestFeat,
    threshold: bestThresh,
    left: buildRegTree(leftIdx, featuresMat, gradients, hessians, depth + 1, maxDepth, minLeaf, lambdaL2, gainsOut),
    right: buildRegTree(rightIdx, featuresMat, gradients, hessians, depth + 1, maxDepth, minLeaf, lambdaL2, gainsOut),
  };
}

function predictRegTree(node: RegressionTreeNode, x: number[]): number {
  let cur: RegressionTreeNode | undefined = node;
  while (cur && cur.leafVal === undefined) {
    cur = (x[cur.featureIdx!] ?? 0) <= cur.threshold! ? cur.left : cur.right;
  }
  return cur?.leafVal ?? 0;
}

function fitGbdt3Class(
  trainItems: LabeledDatasetItem[],
  valItems: LabeledDatasetItem[]
) {
  const n = Math.max(1, trainItems.length);
  const feats = trainItems.map((it) => it.sample.features);
  const labels = trainItems.map((it) => it.sample.class3);
  const dims = feats[0]?.length ?? FEATURE_NAMES.length;
  const counts = [0, 0, 0];
  for (const y of labels) counts[y]++;
  const baseLogits: [number, number, number] = [
    Math.log(Math.max(1, counts[0]) / n),
    Math.log(Math.max(1, counts[1]) / n),
    Math.log(Math.max(1, counts[2]) / n),
  ];

  const classTrees: [RegressionTreeNode[], RegressionTreeNode[], RegressionTreeNode[]] = [[], [], []];
  const lr = 0.08;
  const lambdaL2 = 12.0;
  const maxRounds = 24;
  const minLeaf = Math.max(12, Math.floor(n * 0.025));
  const featureGains = new Array(dims).fill(0);
  const allIndices = Array.from({ length: n }, (_, i) => i);

  const trainLogits: [number, number, number][] = trainItems.map(() => [
    baseLogits[0],
    baseLogits[1],
    baseLogits[2],
  ]);
  const valLogits: [number, number, number][] = valItems.map(() => [
    baseLogits[0],
    baseLogits[1],
    baseLogits[2],
  ]);

  let bestRound = 0;
  let bestValLoss = Infinity;

  for (let r = 0; r < maxRounds; r++) {
    const trainProbs = trainLogits.map((l) => softmax3(l));
    for (let c = 0; c < 3; c++) {
      const grad = new Array(n);
      const hess = new Array(n);
      for (let i = 0; i < n; i++) {
        const y = labels[i] === c ? 1 : 0;
        const p = trainProbs[i][c];
        grad[i] = p - y;
        hess[i] = Math.max(1e-4, 2 * p * (1 - p));
      }
      const tree = buildRegTree(allIndices, feats, grad, hess, 0, 2, minLeaf, lambdaL2, featureGains);
      classTrees[c].push(tree);
      for (let i = 0; i < n; i++) {
        trainLogits[i][c] += lr * predictRegTree(tree, feats[i]);
      }
      for (let j = 0; j < valItems.length; j++) {
        valLogits[j][c] += lr * predictRegTree(tree, valItems[j].sample.features);
      }
    }

    if (valItems.length >= 15) {
      let vLoss = 0;
      for (let j = 0; j < valItems.length; j++) {
        const vp = softmax3(valLogits[j]);
        vLoss -= Math.log(Math.max(1e-6, vp[valItems[j].sample.class3]));
      }
      if (vLoss < bestValLoss - 1e-4) {
        bestValLoss = vLoss;
        bestRound = r + 1;
      } else if (r + 1 - bestRound >= 5) {
        // Early stopping on validation log-loss to prevent overfitting noise
        break;
      }
    } else {
      bestRound = r + 1;
    }
  }

  if (bestRound > 0 && bestRound < classTrees[0].length) {
    classTrees[0].length = bestRound;
    classTrees[1].length = bestRound;
    classTrees[2].length = bestRound;
  }

  return {
    classTrees,
    baseLogits,
    learningRate: lr,
    temperature: 1.0,
    featureGains,
  };
}

function evalGbdtProbs(
  gbdt: NonNullable<TrainedLogisticModel['gbdt']>,
  features: number[]
): [number, number, number] {
  const logits: [number, number, number] = [
    gbdt.baseLogits[0],
    gbdt.baseLogits[1],
    gbdt.baseLogits[2],
  ];
  for (let c = 0; c < 3; c++) {
    for (const t of gbdt.classTrees[c]) {
      logits[c] += gbdt.learningRate * predictRegTree(t, features);
    }
    logits[c] /= gbdt.temperature;
  }
  return softmax3(logits);
}

/**
 * Fits dual calibrated Logistic+Platt estimators (Long labelUp and Short labelDown)
 * or alternative 3-class model families using strictly purged Train + Validation slices.
 */
export function fitDualPurgedModel(
  trainItems: LabeledDatasetItem[],
  valItems: LabeledDatasetItem[],
  modelVersion = 'ArthQuant-DualLogitPlatt-v2.0',
  modelFamily: ModelFamily = 'DUAL_LOGIT_PLATT'
): TrainedLogisticModel {
  const { means, stds } = fitStandardizer(trainItems.map((s) => s.sample.features));
  const upHead = fitBinaryHead(trainItems, valItems, means, stds, (it) => it.sample.labelUp);
  const downHead = fitBinaryHead(trainItems, valItems, means, stds, (it) => it.sample.labelDown);

  const model: TrainedLogisticModel = {
    weights: upHead.weights,
    bias: upHead.bias,
    plattA: upHead.plattA,
    plattB: upHead.plattB,
    downHead,
    means,
    stds,
    modelFamily,
    modelVersion,
  };

  if (modelFamily === 'MULTINOMIAL_3CLASS_SOFTMAX') {
    model.softmaxHead = fitMultinomial3ClassSoftmax(trainItems, valItems, means, stds);
  } else if (modelFamily === 'RANDOM_FOREST') {
    const rf = fitRandomForest3Class(trainItems, valItems);
    model.rfTrees = rf.trees;
    model.rfTemperature = rf.temperature;
  } else if (modelFamily === 'GBDT_ENSEMBLE') {
    model.gbdt = fitGbdt3Class(trainItems, valItems);
  }

  return model;
}

function computeBinaryClassificationMetrics(
  pairs: { p: number; y: number }[],
  threshold = 0.5
): MlClassificationMetrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const { p, y } of pairs) {
    const pred = p >= threshold ? 1 : 0;
    if (pred === 1 && y === 1) tp++;
    else if (pred === 1 && y === 0) fp++;
    else if (pred === 0 && y === 0) tn++;
    else fn++;
  }
  const n = Math.max(1, pairs.length);
  const accuracyPct = round2(((tp + tn) / n) * 100);
  const precisionPct = tp + fp > 0 ? round2((tp / (tp + fp)) * 100) : 0;
  const recallPct = tp + fn > 0 ? round2((tp / (tp + fn)) * 100) : 0;
  const f1Pct =
    precisionPct + recallPct > 0
      ? round2((2 * precisionPct * recallPct) / (precisionPct + recallPct))
      : 0;
  const tpr = tp + fn > 0 ? tp / (tp + fn) : 0;
  const tnr = tn + fp > 0 ? tn / (tn + fp) : 0;
  const balancedAccPct = round2(0.5 * (tpr + tnr) * 100);

  return { accuracyPct, precisionPct, recallPct, f1Pct, balancedAccPct, tp, fp, tn, fn };
}

function computeRocAuc(pairs: { p: number; y: number }[]): number {
  const pos = pairs.filter((d) => d.y === 1);
  const neg = pairs.filter((d) => d.y === 0);
  const totalPairs = pos.length * neg.length;
  if (totalPairs === 0) return 0.5;
  let concordant = 0;
  for (const pp of pos) {
    for (const nn of neg) {
      if (pp.p > nn.p) concordant += 1;
      else if (pp.p === nn.p) concordant += 0.5;
    }
  }
  return round4(concordant / totalPairs);
}

function computeBrierAndLogLoss(pairs: { p: number; y: number }[]): { brier: number; logLoss: number } {
  if (pairs.length === 0) return { brier: 0.25, logLoss: 0.6931 };
  let brierSum = 0;
  let llSum = 0;
  for (const { p, y } of pairs) {
    brierSum += (p - y) * (p - y);
    llSum += -(y * Math.log(Math.max(1e-6, p)) + (1 - y) * Math.log(Math.max(1e-6, 1 - p)));
  }
  return {
    brier: round4(brierSum / pairs.length),
    logLoss: round4(llSum / pairs.length),
  };
}

function splitChronologicalPurged(
  dataset: LabeledDatasetItem[],
  horizon: number,
  trainFrac = 0.58,
  valFrac = 0.18
): {
  trainSet: LabeledDatasetItem[];
  valSet: LabeledDatasetItem[];
  testSet: LabeledDatasetItem[];
  embargoBarsPerBoundary: number;
} {
  const total = dataset.length;
  const embargo = Math.max(horizon + 1, Math.floor(total * 0.03));

  const rawTrainEnd = Math.min(
    Math.max(12, Math.floor(total * trainFrac)),
    Math.max(12, total - embargo * 2 - 16)
  );

  const firstValCandidate = Math.min(total - 2, rawTrainEnd + embargo);
  const valStartBarIndex = dataset[firstValCandidate]?.index ?? Number.MAX_SAFE_INTEGER;
  const trainSet = dataset
    .slice(0, rawTrainEnd)
    .filter((d) => d.index + horizon < valStartBarIndex);

  const valLen = Math.max(8, Math.floor(total * valFrac));
  const rawValEnd = Math.min(total - embargo - 2, firstValCandidate + valLen);
  const testStart = Math.min(total, rawValEnd + embargo);
  const testStartBarIndex = dataset[testStart]?.index ?? Number.MAX_SAFE_INTEGER;

  const valSet = dataset
    .slice(firstValCandidate, rawValEnd)
    .filter((d) => d.index + horizon < testStartBarIndex);

  const testSet = dataset.slice(testStart);

  return {
    trainSet,
    valSet,
    testSet,
    embargoBarsPerBoundary: embargo,
  };
}

function evaluateCandidateModelOnTest(
  model: TrainedLogisticModel,
  modelFamily: ModelFamily,
  testSet: LabeledDatasetItem[],
  highConvictionThreshold: number
) {
  const upPairs: { p: number; y: number; item: LabeledDatasetItem }[] = [];
  const downPairs: { p: number; y: number }[] = [];
  let threeClassCorrect = 0;
  let threeClassLogLossSum = 0;
  let timeoutProbSum = 0;
  let filteredSamples = 0;
  let filteredWins = 0;
  let longExpectancySum = 0;
  let longTradeN = 0;
  let shortExpectancySum = 0;
  let shortTradeN = 0;

  for (const item of testSet) {
    const { probUp, probDown, probNeutral } = predictDirectionalProbabilitiesFromFeatures(
      model,
      item.sample.features
    );
    upPairs.push({ p: probUp, y: item.sample.labelUp, item });
    downPairs.push({ p: probDown, y: item.sample.labelDown });
    timeoutProbSum += probNeutral;

    const predClass =
      probUp >= probDown && probUp >= probNeutral
        ? 0
        : probDown > probUp && probDown >= probNeutral
        ? 1
        : 2;
    if (predClass === item.sample.class3) threeClassCorrect++;
    const trueP = predClass === 0 ? probUp : predClass === 1 ? probDown : probNeutral;
    const pForTrue =
      item.sample.class3 === 0 ? probUp : item.sample.class3 === 1 ? probDown : probNeutral;
    threeClassLogLossSum -= Math.log(Math.max(1e-6, pForTrue));

    if (probUp >= highConvictionThreshold && probUp >= probDown) {
      filteredSamples++;
      if (item.sample.labelUp === 1) filteredWins++;
      longTradeN++;
      longExpectancySum += item.sample.labelUp === 1 ? 1.35 : -1.0;
    } else if (probDown >= highConvictionThreshold && probDown > probUp) {
      filteredSamples++;
      if (item.sample.labelDown === 1) filteredWins++;
      shortTradeN++;
      shortExpectancySum += item.sample.labelDown === 1 ? 1.35 : -1.0;
    }
    void trueP;
  }

  const oosCount = Math.max(1, testSet.length);
  const { brier: brierScore, logLoss } = computeBrierAndLogLoss(upPairs);
  const rocAucUp = computeRocAuc(upPairs);
  const rocAucDown = computeRocAuc(downPairs);
  const cls = computeBinaryClassificationMetrics(upPairs, 0.5);

  const binEdges: [number, number][] = [
    [0.0, 0.35],
    [0.35, 0.5],
    [0.5, 0.62],
    [0.62, 0.75],
    [0.75, 1.01],
  ];
  let eceSum = 0;
  let mceMax = 0;
  for (const [lo, hi] of binEdges) {
    const items = upPairs.filter((d) => d.p >= lo && d.p < hi);
    if (items.length === 0) continue;
    const pm = items.reduce((a, b) => a + b.p, 0) / items.length;
    const er = items.reduce((a, b) => a + b.y, 0) / items.length;
    const gap = Math.abs(pm - er);
    eceSum += (items.length / oosCount) * gap;
    if (gap > mceMax) mceMax = gap;
  }

  const entry: MultiModelBenchmarkEntry = {
    modelFamily,
    modelVersion: model.modelVersion,
    accuracyPct: cls.accuracyPct,
    balancedAccPct: cls.balancedAccPct,
    precisionPct: cls.precisionPct,
    recallPct: cls.recallPct,
    f1Pct: cls.f1Pct,
    brierScore,
    logLoss,
    rocAucUp,
    rocAucDown,
    ecePct: round2(eceSum * 100),
    mcePct: round2(mceMax * 100),
    selectiveCount: filteredSamples,
    selectiveWinRatePct: filteredSamples > 0 ? round2((filteredWins / filteredSamples) * 100) : 0,
    threeClassAccuracyPct: round2((threeClassCorrect / oosCount) * 100),
    threeClassLogLoss: round4(threeClassLogLossSum / oosCount),
    longTradeExpectancyR: longTradeN > 0 ? round4(longExpectancySum / longTradeN) : 0,
    shortTradeExpectancyR: shortTradeN > 0 ? round4(shortExpectancySum / shortTradeN) : 0,
  };

  return {
    entry,
    threeClassMetrics: {
      accuracyPct: entry.threeClassAccuracyPct ?? 0,
      logLoss: entry.threeClassLogLoss ?? 1.0986,
      meanTimeoutProbPct: round2((timeoutProbSum / oosCount) * 100),
    },
  };
}

export interface WalkForwardEvalOptions {
  modelFamily?: ModelFamily;
  includeModelComparison?: boolean;
  indexCandles?: Candle[];
}

export function trainAndEvaluateWalkForward(
  symbol: string,
  timeframe: Timeframe,
  candles: Candle[],
  indicators: IndicatorPoint[],
  highConvictionThreshold = 0.62,
  sourceDataset: 'RESEARCH_REPLAY' | 'PUBLIC_DELAYED_NSE_FEED' | 'AUTHORIZED_HISTORICAL_ARCHIVE' = 'RESEARCH_REPLAY',
  options: WalkForwardEvalOptions = {}
): { model: TrainedLogisticModel; evaluation: MlEvaluationResult } {
  const horizon = ML_PREDICTION_HORIZON_BARS;
  const indexContext = buildIndexContextMap(options.indexCandles);
  const dataset = buildLabeledDataset(candles, indicators, horizon, indexContext);
  const { trainSet, valSet, testSet, embargoBarsPerBoundary } = splitChronologicalPurged(dataset, horizon);

  const selectedFamily: ModelFamily = options.modelFamily ?? 'DUAL_LOGIT_PLATT';
  const versionMap: Record<ModelFamily, string> = {
    DUAL_LOGIT_PLATT: 'ArthQuant-DualLogitPlatt-v2.0',
    MULTINOMIAL_3CLASS_SOFTMAX: 'ArthQuant-3ClassSoftmax-v3.0',
    RANDOM_FOREST: 'ArthQuant-CausalRF-v3.0',
    GBDT_ENSEMBLE: 'ArthQuant-GBDT-v3.0',
  };

  const model = fitDualPurgedModel(
    trainSet,
    valSet,
    versionMap[selectedFamily],
    selectedFamily
  );

  const upPairs: { p: number; y: number; item: LabeledDatasetItem }[] = [];
  const downPairs: { p: number; y: number }[] = [];
  let rawDirectionalHits = 0;
  let filteredSamples = 0;
  let filteredWins = 0;
  let threeClassCorrect = 0;
  let threeClassLogLossSum = 0;
  let timeoutProbSum = 0;

  for (const item of testSet) {
    const { probUp, probDown, probNeutral } = predictDirectionalProbabilitiesFromFeatures(
      model,
      item.sample.features
    );
    upPairs.push({ p: probUp, y: item.sample.labelUp, item });
    downPairs.push({ p: probDown, y: item.sample.labelDown });
    timeoutProbSum += probNeutral;

    const predClass =
      probUp >= probDown && probUp >= probNeutral
        ? 0
        : probDown > probUp && probDown >= probNeutral
        ? 1
        : 2;
    if (predClass === item.sample.class3) threeClassCorrect++;
    const pForTrue =
      item.sample.class3 === 0 ? probUp : item.sample.class3 === 1 ? probDown : probNeutral;
    threeClassLogLossSum -= Math.log(Math.max(1e-6, pForTrue));

    if (probUp >= probDown && probUp >= 0.5 && item.sample.labelUp === 1) {
      rawDirectionalHits++;
    } else if (probDown > probUp && probDown >= 0.5 && item.sample.labelDown === 1) {
      rawDirectionalHits++;
    } else if (probUp < 0.5 && probDown < 0.5 && item.sample.labelUp === 0 && item.sample.labelDown === 0) {
      rawDirectionalHits++;
    }

    if (probUp >= highConvictionThreshold && probUp >= probDown) {
      filteredSamples++;
      if (item.sample.labelUp === 1) filteredWins++;
    } else if (probDown >= highConvictionThreshold && probDown > probUp) {
      filteredSamples++;
      if (item.sample.labelDown === 1) filteredWins++;
    }
  }

  const oosCount = Math.max(1, testSet.length);
  const { brier: brierScore, logLoss } = computeBrierAndLogLoss(upPairs);
  const { brier: shortBrierScore } = computeBrierAndLogLoss(downPairs);
  const rocAucApprox = computeRocAuc(upPairs);
  const shortRocAuc = computeRocAuc(downPairs);

  const classification = computeBinaryClassificationMetrics(upPairs, 0.5);
  const shortClassification = computeBinaryClassificationMetrics(downPairs, 0.5);

  const oosRawWinRatePct = round2((rawDirectionalHits / oosCount) * 100);
  const oosFilteredWinRatePct =
    filteredSamples > 0 ? round2((filteredWins / filteredSamples) * 100) : 0;
  const oosFilteredCI = calculateWilsonCI(filteredWins, filteredSamples);

  const classPrevalence = {
    upPct: round2((testSet.filter((d) => d.sample.class3 === 0).length / oosCount) * 100),
    downPct: round2((testSet.filter((d) => d.sample.class3 === 1).length / oosCount) * 100),
    timeoutPct: round2((testSet.filter((d) => d.sample.class3 === 2).length / oosCount) * 100),
  };

  const binEdges: [number, number, string][] = [
    [0.0, 0.35, '0.00–0.35'],
    [0.35, 0.5, '0.35–0.50'],
    [0.5, 0.62, '0.50–0.62'],
    [0.62, 0.75, '0.62–0.75'],
    [0.75, 1.01, '0.75–1.00'],
  ];
  let eceSum = 0;
  let mceMax = 0;

  const calibrationBins: CalibrationBin[] = binEdges.map(([lo, hi, label]) => {
    const items = upPairs.filter((d) => d.p >= lo && d.p < hi);
    if (items.length === 0) {
      return {
        binLabel: label,
        predictedMean: round2(((lo + Math.min(1, hi)) / 2) * 100),
        empiricalWinRate: 0,
        count: 0,
      };
    }
    const predMean = items.reduce((a, b) => a + b.p, 0) / items.length;
    const empRate = items.reduce((a, b) => a + b.y, 0) / items.length;
    const gap = Math.abs(predMean - empRate);
    eceSum += (items.length / oosCount) * gap;
    if (gap > mceMax) mceMax = gap;

    return {
      binLabel: label,
      predictedMean: round2(predMean * 100),
      empiricalWinRate: round2(empRate * 100),
      count: items.length,
    };
  });

  const ecePct = round2(eceSum * 100);
  const mcePct = round2(mceMax * 100);

  // Baseline Comparisons on exact same OOS testSet
  const trainUpRate =
    trainSet.length > 0 ? trainSet.filter((d) => d.sample.labelUp === 1).length / trainSet.length : 0.5;
  const priorMatchedClassification = {
    ...computeBinaryClassificationMetrics(upPairs, clamp(trainUpRate, 0.25, 0.75)),
    thresholdUsedPct: round2(clamp(trainUpRate, 0.25, 0.75) * 100),
  };
  const majPred = trainUpRate >= 0.5 ? 1 : 0;

  const buildBaseline = (name: string, predFn: (it: LabeledDatasetItem) => number): MlBaselineComparison => {
    const pairs = testSet.map((it) => ({ p: predFn(it), y: it.sample.labelUp }));
    const m = computeBinaryClassificationMetrics(pairs, 0.5);
    return {
      name,
      accuracyPct: m.accuracyPct,
      balancedAccPct: m.balancedAccPct,
      samples: testSet.length,
    };
  };

  const baselines: MlBaselineComparison[] = [
    buildBaseline('Majority Class (Train Prior)', () => majPred),
    buildBaseline('Prev Candle Direction (Close > Open)', (it) => (it.candle.close > it.candle.open ? 1 : 0)),
    buildBaseline('Session VWAP Momentum (Close > VWAP)', (it) => (it.candle.close > it.ind.vwap ? 1 : 0)),
    buildBaseline('EMA 9/21 Crossover (EMA9 > EMA21)', (it) => (it.ind.ema9 > it.ind.ema21 ? 1 : 0)),
  ];

  // Multi-model head-to-head comparison (enabled on ML Validation lab & research scripts)
  let modelComparison: MultiModelBenchmarkEntry[] | undefined;
  if (options.includeModelComparison) {
    const families: ModelFamily[] = [
      'DUAL_LOGIT_PLATT',
      'MULTINOMIAL_3CLASS_SOFTMAX',
      'RANDOM_FOREST',
      'GBDT_ENSEMBLE',
    ];
    modelComparison = families.map((fam) => {
      const m =
        fam === selectedFamily
          ? model
          : fitDualPurgedModel(trainSet, valSet, versionMap[fam], fam);
      return evaluateCandidateModelOnTest(m, fam, testSet, highConvictionThreshold).entry;
    });
  }

  // Multi-Fold Expanding Chronological Walk-Forward Validation (3 folds)
  const walkForwardFolds: MlWalkForwardFold[] = [];
  if (dataset.length >= 160) {
    const foldFracs = [
      { trainEndF: 0.42, valEndF: 0.55, testEndF: 0.7 },
      { trainEndF: 0.55, valEndF: 0.69, testEndF: 0.85 },
      { trainEndF: 0.65, valEndF: 0.79, testEndF: 1.0 },
    ];
    foldFracs.forEach((ff, idx) => {
      const fTrainEnd = Math.floor(dataset.length * ff.trainEndF);
      const fValStart = Math.min(dataset.length - 10, fTrainEnd + embargoBarsPerBoundary);
      const fValEnd = Math.min(dataset.length - 6, Math.floor(dataset.length * ff.valEndF));
      const fTestStart = Math.min(dataset.length - 2, fValEnd + embargoBarsPerBoundary);
      const fTestEnd = Math.min(dataset.length, Math.floor(dataset.length * ff.testEndF));

      const fValStartBar = dataset[fValStart]?.index ?? Number.MAX_SAFE_INTEGER;
      const fTestStartBar = dataset[fTestStart]?.index ?? Number.MAX_SAFE_INTEGER;
      const fTrain = dataset.slice(0, fTrainEnd).filter((d) => d.index + horizon < fValStartBar);
      const fVal = dataset.slice(fValStart, fValEnd).filter((d) => d.index + horizon < fTestStartBar);
      const fTest = dataset.slice(fTestStart, fTestEnd);

      if (fTrain.length >= 25 && fTest.length >= 12) {
        const foldModel = fitDualPurgedModel(fTrain, fVal, versionMap[selectedFamily], selectedFamily);
        const foldPairs = fTest.map((it) => ({
          p: predictDirectionalProbabilitiesFromFeatures(foldModel, it.sample.features).probUp,
          y: it.sample.labelUp,
        }));
        const fCls = computeBinaryClassificationMetrics(foldPairs, 0.5);
        const { brier } = computeBrierAndLogLoss(foldPairs);
        const fAuc = computeRocAuc(foldPairs);

        const regCounts = new Map<MarketRegime, number>();
        for (const it of fTest) regCounts.set(it.regime, (regCounts.get(it.regime) ?? 0) + 1);
        let dominantRegime: MarketRegime = 'SIDEWAYS_RANGE';
        let topRegCount = -1;
        for (const [reg, cnt] of regCounts.entries()) {
          if (cnt > topRegCount) {
            topRegCount = cnt;
            dominantRegime = reg;
          }
        }

        walkForwardFolds.push({
          foldIndex: idx + 1,
          trainRangeIst: `${fTrain[0].istLabel.slice(5, 16)} → ${fTrain[fTrain.length - 1].istLabel.slice(5, 16)}`,
          testRangeIst: `${fTest[0].istLabel.slice(5, 16)} → ${fTest[fTest.length - 1].istLabel.slice(5, 16)}`,
          trainBars: fTrain.length,
          testBars: fTest.length,
          accuracyPct: fCls.accuracyPct,
          brierScore: brier,
          rocAuc: fAuc,
          dominantRegime,
        });
      }
    });
  }

  // Per-Regime OOS accuracy breakdown
  const regOrder: MarketRegime[] = [
    'STRONG_TREND_BULL',
    'STRONG_TREND_BEAR',
    'SIDEWAYS_RANGE',
    'HIGH_VOL_BREAKOUT',
    'UNCERTAIN_CHOP',
  ];
  const regimePerformance: MlRegimePerformance[] = regOrder
    .map((reg) => {
      const sub = upPairs.filter((x) => x.item.regime === reg);
      if (sub.length === 0) return null;
      const cls = computeBinaryClassificationMetrics(sub, 0.5);
      const { brier } = computeBrierAndLogLoss(sub);
      return {
        regime: reg,
        samples: sub.length,
        accuracyPct: cls.accuracyPct,
        brierScore: brier,
      };
    })
    .filter((x): x is MlRegimePerformance => x !== null);

  const bestBaselineAcc = Math.max(...baselines.map((b) => b.accuracyPct));
  let overfittingWarning: string | null = null;
  if (rocAucApprox < 0.55 || brierScore >= 0.245) {
    overfittingWarning = `NO GENERALIZATION EDGE DETECTED: OOS ROC-AUC (${rocAucApprox}) or Brier (${brierScore}) is near or worse than random chance (0.50 AUC / 0.25 Brier). AI signals must abstain (NO_TRADE).`;
  } else if (classification.accuracyPct <= bestBaselineAcc && classification.balancedAccPct < 54) {
    overfittingWarning = `BASELINE PARITY WARNING: ML Accuracy (${classification.accuracyPct}%, BalAcc ${classification.balancedAccPct}%) does not outperform best simple baseline (${bestBaselineAcc}%). Prefer rule-based / regime confirmation.`;
  } else if (ecePct > 8.0) {
    overfittingWarning = `CALIBRATION DRIFT WARNING: OOS Expected Calibration Error is elevated (${ecePct}% > 8%). Confidence scores may be miscalibrated.`;
  }

  const featureImportances: FeatureImportance[] =
    model.gbdt
      ? model.gbdt.featureGains
          .map((g, idx) => ({
            feature: FEATURE_NAMES[idx] ?? `F${idx}`,
            weight: round4(g),
            absImportance: round4(Math.abs(g)),
          }))
          .sort((a, b) => b.absImportance - a.absImportance)
      : model.softmaxHead
      ? model.softmaxHead.weights[0]
          .map((w, idx) => ({
            feature: FEATURE_NAMES[idx] ?? `F${idx}`,
            weight: round4(w),
            absImportance: round4(Math.abs(w)),
          }))
          .sort((a, b) => b.absImportance - a.absImportance)
      : model.weights
          .map((w, idx) => ({
            feature: FEATURE_NAMES[idx] ?? `F${idx}`,
            weight: round4(w),
            absImportance: round4(Math.abs(w)),
          }))
          .sort((a, b) => b.absImportance - a.absImportance);

  const imbalanceNote =
    classification.accuracyPct - classification.balancedAccPct > 10
      ? ` Note: High ordinary accuracy (${classification.accuracyPct}%) vs Balanced Acc (${classification.balancedAccPct}%) reflects ${classPrevalence.upPct}% UP class minority prevalence.`
      : '';

  const honestAssessment =
    overfittingWarning
      ? `${overfittingWarning} Selective OOS win rate: ${oosFilteredWinRatePct}% (n=${filteredSamples}, 95% CI ${oosFilteredCI.lowerPct}%–${oosFilteredCI.upperPct}%).${imbalanceNote}`
      : filteredSamples < 15
      ? `Insufficient high-conviction OOS samples (n=${filteredSamples} at >=${Math.round(highConvictionThreshold * 100)}% threshold). Accuracy=${classification.accuracyPct}%, BalAcc=${classification.balancedAccPct}%, ECE=${ecePct}%, Brier=${brierScore}.${imbalanceNote}`
      : oosFilteredWinRatePct >= 70 && oosFilteredCI.lowerPct >= 55
      ? `Selective OOS accuracy reached ${oosFilteredWinRatePct}% (95% CI: ${oosFilteredCI.lowerPct}%–${oosFilteredCI.upperPct}%, n=${filteredSamples}) with Brier ${brierScore}, ECE ${ecePct}%, AUC ${rocAucApprox}. Must still pass net-expectancy backtest after NSE fees.${imbalanceNote}`
      : `Actual OOS selective win rate is ${oosFilteredWinRatePct}% (95% CI: ${oosFilteredCI.lowerPct}%–${oosFilteredCI.upperPct}%, n=${filteredSamples}, Brier ${brierScore}, ECE ${ecePct}%). Below 70% target on this symbol/timeframe — keep strict risk sizing.${imbalanceNote}`;

  return {
    model,
    evaluation: {
      symbol,
      timeframe,
      modelVersion: model.modelVersion,
      modelFamily: selectedFamily,
      sourceDataset,
      horizonBars: horizon,
      splitSummary: {
        trainBars: trainSet.length,
        embargoBars: embargoBarsPerBoundary * 2,
        valBars: valSet.length,
        oosTestBars: testSet.length,
      },
      classPrevalence,
      oosSamples: testSet.length,
      oosRawWinRatePct,
      oosFilteredWinRatePct,
      oosFilteredSamples: filteredSamples,
      oosFilteredCI,
      brierScore,
      logLoss,
      rocAucApprox,
      ecePct,
      mcePct,
      threeClassMetrics: {
        accuracyPct: round2((threeClassCorrect / oosCount) * 100),
        logLoss: round4(threeClassLogLossSum / oosCount),
        meanTimeoutProbPct: round2((timeoutProbSum / oosCount) * 100),
      },
      classification,
      priorMatchedClassification,
      shortClassification,
      shortBrierScore,
      shortRocAuc,
      baselines,
      modelComparison,
      walkForwardFolds,
      regimePerformance,
      overfittingWarning,
      calibrationBins,
      featureImportances,
      honestAssessment,
      dataMode:
        sourceDataset === 'PUBLIC_DELAYED_NSE_FEED' || sourceDataset === 'AUTHORIZED_HISTORICAL_ARCHIVE'
          ? 'PUBLIC_DELAYED_NSE_FEED'
          : 'HISTORICAL_RESEARCH_DATASET',
    },
  };
}

export function predictDirectionalProbabilitiesFromFeatures(
  model: TrainedLogisticModel,
  features: number[]
): { probUp: number; probDown: number; probNeutral: number } {
  if (model.modelFamily === 'MULTINOMIAL_3CLASS_SOFTMAX' && model.softmaxHead) {
    const [p0, p1, p2] = evalSoftmax3(model.softmaxHead, features, model.means, model.stds);
    return { probUp: p0, probDown: p1, probNeutral: p2 };
  }
  if (model.modelFamily === 'RANDOM_FOREST' && model.rfTrees) {
    const [p0, p1, p2] = evalRfProbs(model.rfTrees, features, model.rfTemperature ?? 1.0);
    return { probUp: p0, probDown: p1, probNeutral: p2 };
  }
  if (model.modelFamily === 'GBDT_ENSEMBLE' && model.gbdt) {
    const [p0, p1, p2] = evalGbdtProbs(model.gbdt, features);
    return { probUp: p0, probDown: p1, probNeutral: p2 };
  }

  let probUp = evalHeadProb(
    { weights: model.weights, bias: model.bias, plattA: model.plattA, plattB: model.plattB },
    features,
    model.means,
    model.stds
  );
  let probDown = evalHeadProb(model.downHead, features, model.means, model.stds);

  const totalDir = probUp + probDown;
  if (totalDir > 0.99) {
    const scale = 0.99 / totalDir;
    probUp *= scale;
    probDown *= scale;
  }
  const probNeutral = Math.max(0, 1 - probUp - probDown);
  return { probUp, probDown, probNeutral };
}

export function predictDirectionalProbabilities(
  model: TrainedLogisticModel,
  candle: Candle,
  ind: IndicatorPoint,
  history?: {
    candles: Candle[];
    index: number;
    niftyAligned?: { close: number; vwap: number; atr14: number; ret6: number };
  }
): { probUp: number; probDown: number; probNeutral: number } {
  const f = extractCausalFeatures(candle, ind, history);
  return predictDirectionalProbabilitiesFromFeatures(model, f);
}

export function predictProbability(
  model: TrainedLogisticModel,
  candle: Candle,
  ind: IndicatorPoint
): number {
  return predictDirectionalProbabilities(model, candle, ind).probUp;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

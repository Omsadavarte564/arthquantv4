import { NseChargeBreakdown, WilsonCI } from '../../src/types/trading.ts';

export interface FeeScheduleParams {
  brokerageFlatCap?: number; // Default ₹20 per order
  brokeragePct?: number;     // Default 0.03% (0.0003)
  slippageBps?: number;      // Default 5 bps (0.05%) per side
}

/**
 * Computes exact NSE Cash Equity Intraday statutory & brokerage charges:
 * - Brokerage: min(₹20, 0.03%) per executed order (buy & sell)
 * - STT: 0.025% on sell side only
 * - Stamp Duty: 0.003% on buy side only
 * - NSE Exchange Txn Charge: 0.00297% on both sides
 * - SEBI Turnover Fee: 0.0001% (₹10/Cr) on both sides
 * - NSE IPFT Charge: 0.0001% (₹10/Cr) on both sides
 * - GST: 18% on (Brokerage + Exchange Txn + SEBI Fee)
 */
export function calculateNseIntradayCharges(
  buyValue: number,
  sellValue: number,
  params: FeeScheduleParams = {}
): NseChargeBreakdown {
  const flatCap = params.brokerageFlatCap ?? 20;
  const pct = params.brokeragePct ?? 0.0003;
  const slippageBps = params.slippageBps ?? 5;

  const turnover = buyValue + sellValue;
  const buyBrokerage = Math.min(flatCap, buyValue * pct);
  const sellBrokerage = Math.min(flatCap, sellValue * pct);
  const brokerage = round2(buyBrokerage + sellBrokerage);

  const stt = round2(sellValue * 0.00025);
  const stampDuty = round2(buyValue * 0.00003);
  const exchangeTxnCharge = round2(turnover * 0.0000297);
  const sebiTurnoverFee = round2(turnover * 0.000001);
  const ipftCharge = round2(turnover * 0.000001);
  const gst = round2((brokerage + exchangeTxnCharge + sebiTurnoverFee) * 0.18);
  const slippageCost = round2(turnover * (slippageBps / 10000));

  const totalCharges = round2(
    brokerage + stt + stampDuty + exchangeTxnCharge + sebiTurnoverFee + ipftCharge + gst + slippageCost
  );

  return {
    turnover: round2(turnover),
    brokerage,
    stt,
    exchangeTxnCharge,
    sebiTurnoverFee,
    ipftCharge,
    stampDuty,
    gst,
    slippageCost,
    totalCharges,
  };
}

/**
 * 95% Wilson Score Confidence Interval for binomial proportion (Win Rate).
 * Prevents small-sample illusions from pretending statistical certainty.
 */
export function calculateWilsonCI(wins: number, total: number, z = 1.96): WilsonCI {
  if (total <= 0) {
    return { lowerPct: 0, upperPct: 0, sampleSize: 0 };
  }
  const p = wins / total;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  const lower = Math.max(0, (center - margin) / denom);
  const upper = Math.min(1, (center + margin) / denom);
  return {
    lowerPct: round2(lower * 100),
    upperPct: round2(upper * 100),
    sampleSize: total,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

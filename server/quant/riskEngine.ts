import crypto from 'node:crypto';
import {
  PaperAccountState,
  RiskConfig,
  RiskDecision,
} from '../../src/types/trading.ts';
import { STOCK_MAP } from '../data/nseUniverse.ts';

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  killSwitchActive: false,
  maxLossPerTradePct: 1.0,
  maxDailyLossInr: 25000,
  maxDrawdownPct: 6.0,
  maxTotalExposurePct: 80,
  maxStockExposurePct: 25,
  maxOpenPositions: 4,
  maxTradesPerDay: 12,
  maxConsecutiveLosses: 3,
  minRiskRewardRatio: 1.4,
  maxSpreadBps: 25,
  minDailyVolume: 500000,
  enforceMarketHoursCutoff: false, // False by default in research replay mode; true in live broker mode
  paperSlippageBps: 5,
  paperSpreadBps: 4,
};

export interface OrderProposal {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  target: number;
  requestedQty?: number;
  istTimeHhMm?: string;
  estimatedSpreadBps?: number;
  dataQualityPassed?: boolean;
  modelValidated?: boolean;
  calibrationReliable?: boolean;
  expectedMovePct?: number;
  roundTripCostPct?: number;
}

/**
 * Independent Deterministic Risk Gatekeeper:
 * Evaluates mandatory pre-trade safety, liquidity, spread, validation, and cost-hurdle checks
 * and computes risk-based position sizing.
 * AI models & strategies have ZERO permission to bypass this module.
 */
export function evaluateOrderRisk(
  proposal: OrderProposal,
  riskConfig: RiskConfig,
  account: PaperAccountState
): RiskDecision {
  const reasons: string[] = [];
  const symbol = proposal.symbol.toUpperCase();
  const stockMeta = STOCK_MAP.get(symbol);

  const slDist = Math.abs(proposal.entryPrice - proposal.stopLoss);
  const tgtDist = Math.abs(proposal.target - proposal.entryPrice);
  const riskRewardRatio = slDist > 0 ? round2(tgtDist / slDist) : 0;

  // 1. Emergency Kill Switch
  if (riskConfig.killSwitchActive) {
    reasons.push('KILL SWITCH ACTIVE: All new orders are halted.');
  }

  // 2. Daily Loss Limit
  if (account.realizedPnlToday <= -Math.abs(riskConfig.maxDailyLossInr)) {
    reasons.push(
      `Daily loss limit breached (₹${account.realizedPnlToday.toFixed(0)} <= -₹${riskConfig.maxDailyLossInr}).`
    );
  }

  // 3. Max Drawdown Lockout
  const drawdownPct =
    account.initialCapital > 0
      ? ((account.initialCapital - account.totalEquity) / account.initialCapital) * 100
      : 0;
  if (drawdownPct >= riskConfig.maxDrawdownPct) {
    reasons.push(
      `Account drawdown ${drawdownPct.toFixed(2)}% exceeds max ${riskConfig.maxDrawdownPct}%.`
    );
  }

  // 4. Max Consecutive Losses
  if (account.consecutiveLosses >= riskConfig.maxConsecutiveLosses) {
    reasons.push(
      `Consecutive loss lockout (${account.consecutiveLosses} >= ${riskConfig.maxConsecutiveLosses}).`
    );
  }

  // 5. Max Open Positions
  const existingPos = account.positions.find((p) => p.symbol === symbol);
  if (!existingPos && account.positions.length >= riskConfig.maxOpenPositions) {
    reasons.push(
      `Max concurrent open positions reached (${account.positions.length}/${riskConfig.maxOpenPositions}).`
    );
  }

  // 6. Max Trades Per Day
  if (account.tradesToday >= riskConfig.maxTradesPerDay) {
    reasons.push(`Daily trade count limit reached (${account.tradesToday}/${riskConfig.maxTradesPerDay}).`);
  }

  // 7. Minimum Risk/Reward & Valid SL Geometry
  if (slDist <= 0.05) {
    reasons.push('Stop-loss distance too tight or invalid (<= ₹0.05).');
  } else if (
    (proposal.side === 'BUY' && proposal.stopLoss >= proposal.entryPrice) ||
    (proposal.side === 'SELL' && proposal.stopLoss <= proposal.entryPrice)
  ) {
    reasons.push('Stop-loss sits on wrong side of entry price.');
  } else if (riskRewardRatio < riskConfig.minRiskRewardRatio) {
    reasons.push(
      `Risk/Reward ${riskRewardRatio}:1 below minimum threshold ${riskConfig.minRiskRewardRatio}:1.`
    );
  }

  // 8. Liquidity Check
  if (stockMeta && stockMeta.avgDailyVolume < riskConfig.minDailyVolume) {
    reasons.push(
      `Liquidity below minimum (${stockMeta.avgDailyVolume.toLocaleString('en-IN')} < ${riskConfig.minDailyVolume.toLocaleString('en-IN')}).`
    );
  }

  // 9. Bid-Ask Spread Check (maxSpreadBps)
  if (
    proposal.estimatedSpreadBps !== undefined &&
    proposal.estimatedSpreadBps > riskConfig.maxSpreadBps
  ) {
    reasons.push(
      `Bid-ask spread ${proposal.estimatedSpreadBps.toFixed(1)} bps exceeds maxSpreadBps (${riskConfig.maxSpreadBps} bps).`
    );
  }

  // 10. Intraday Market Cutoff
  if (riskConfig.enforceMarketHoursCutoff && proposal.istTimeHhMm && proposal.istTimeHhMm >= '15:00') {
    reasons.push(`Intraday new-order cutoff enforced after 15:00 IST (bar: ${proposal.istTimeHhMm}).`);
  }

  // 11. Data Quality, Model Validation, Calibration & Cost-Hurdle Abstention Gates
  if (proposal.dataQualityPassed === false) {
    reasons.push('Data quality / feed freshness gate failed — NO_TRADE safety abstention enforced.');
  }
  if (proposal.modelValidated === false) {
    reasons.push('Model out-of-sample validation failed — AI trade admission halted.');
  }
  if (proposal.calibrationReliable === false) {
    reasons.push('Probability calibration error above tolerance — order blocked.');
  }
  if (
    proposal.expectedMovePct !== undefined &&
    proposal.roundTripCostPct !== undefined &&
    proposal.roundTripCostPct > 0 &&
    proposal.expectedMovePct < proposal.roundTripCostPct * 1.8
  ) {
    reasons.push(
      `Expected target move (${proposal.expectedMovePct.toFixed(3)}%) fails 1.8x round-trip cost hurdle (${(proposal.roundTripCostPct * 1.8).toFixed(3)}%).`
    );
  }

  // Deterministic Risk-Based Position Sizing
  const riskBudgetInr = account.totalEquity * (riskConfig.maxLossPerTradePct / 100);
  const qtyByRisk = slDist > 0 ? Math.floor(riskBudgetInr / slDist) : 0;
  const maxStockNotional = account.totalEquity * (riskConfig.maxStockExposurePct / 100);
  const qtyByStockCap = proposal.entryPrice > 0 ? Math.floor(maxStockNotional / proposal.entryPrice) : 0;

  const currentExposure = account.positions.reduce(
    (s, p) => s + p.currentPrice * p.quantity,
    0
  );
  const maxTotalNotional = account.totalEquity * (riskConfig.maxTotalExposurePct / 100);
  const remainingNotional = Math.max(0, maxTotalNotional - currentExposure);
  const qtyByTotalCap = proposal.entryPrice > 0 ? Math.floor(remainingNotional / proposal.entryPrice) : 0;

  const isOpposite = Boolean(existingPos && existingPos.side !== proposal.side);
  const reduceQtyAllowed = isOpposite && existingPos ? existingPos.quantity : 0;
  const newPositionCap = Math.min(qtyByRisk, qtyByStockCap, qtyByTotalCap);
  const maxAllowedQty = isOpposite ? reduceQtyAllowed + newPositionCap : newPositionCap;

  const requestedQty = proposal.requestedQty && proposal.requestedQty > 0 ? Math.floor(proposal.requestedQty) : maxAllowedQty;
  const approvedQty = reasons.length === 0 ? Math.min(requestedQty, maxAllowedQty) : 0;

  if (reasons.length === 0 && approvedQty < 1) {
    reasons.push(
      `Insufficient available exposure or risk budget for 1 share (remaining exposure ₹${remainingNotional.toFixed(0)}).`
    );
  }

  const verdict: 'APPROVED' | 'REJECTED' = reasons.length === 0 && approvedQty >= 1 ? 'APPROVED' : 'REJECTED';

  return {
    id: crypto.randomUUID(),
    timestampIst: formatNowIst(),
    symbol,
    side: proposal.side,
    requestedQty,
    approvedQty,
    verdict,
    reasons: verdict === 'APPROVED' ? ['All pre-trade deterministic risk, spread & cost checks passed'] : reasons,
    estimatedRiskInr: round2(approvedQty * slDist),
    riskRewardRatio,
  };
}

export function formatNowIst(): string {
  const ist = new Date(Date.now() + 19800 * 1000);
  return `${ist.toISOString().slice(0, 10)} ${ist.toISOString().slice(11, 19)} IST`;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

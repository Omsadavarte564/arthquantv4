import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  AlertItem,
  BacktestResult,
  JournalEntry,
  MarketRegime,
  PaperAccountState,
  PaperOrder,
  PaperPosition,
  RiskConfig,
  RiskDecision,
  StrategyConfig,
} from '../../src/types/trading.ts';
import { getResearchCandles } from '../data/nseUniverse.ts';
import { calculateNseIntradayCharges } from '../quant/costs.ts';
import {
  createInitialMonitoringState,
  ensureRegisteredModelVersions,
  MonitoringStateSlice,
  resolvePendingPredictions,
} from '../quant/monitoringEngine.ts';
import { DEFAULT_RISK_CONFIG, evaluateOrderRisk, formatNowIst } from '../quant/riskEngine.ts';
import { BUILTIN_STRATEGIES } from '../quant/strategies.ts';

export const CURRENT_SCHEMA_VERSION = 2;

export interface PersistedAppState {
  schemaVersion: number;
  watchlist: string[];
  customStrategies: StrategyConfig[];
  disabledBuiltinIds: string[];
  riskConfig: RiskConfig;
  riskAuditLog: RiskDecision[];
  paperAccount: PaperAccountState;
  backtestHistory: BacktestResult[];
  monitoring: MonitoringStateSlice;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'arthquant-state.json');

function createInitialPaperAccount(initialCapital = 1000000): PaperAccountState {
  return {
    executionMode: 'SIMULATED_PAPER_TRADING',
    initialCapital,
    availableCapital: initialCapital,
    usedMargin: 0,
    realizedPnlToday: 0,
    unrealizedPnl: 0,
    totalEquity: initialCapital,
    tradesToday: 0,
    consecutiveLosses: 0,
    simulationBarOffset: 0,
    positions: [],
    orders: [],
    closedTrades: [],
    journal: [
      {
        id: crypto.randomUUID(),
        timestampIst: formatNowIst(),
        type: 'RISK_CHECK',
        symbol: 'SYSTEM',
        strategyName: 'Deterministic Risk Gatekeeper',
        modelVersion: 'v1.0',
        regime: 'STRONG_TREND_BULL',
        summary: 'Paper trading ledger initialized with ₹10,00,000 virtual capital. Live execution locked.',
        verdict: 'INFO',
      },
    ],
    alerts: [
      {
        id: crypto.randomUUID(),
        timestampIst: formatNowIst(),
        severity: 'INFO',
        category: 'DATA_FEED',
        title: 'Research Dataset Active',
        message: 'Running on deterministic NSE Historical Research Dataset. Connect a SEBI-compliant broker feed for live quotes.',
        read: false,
      },
    ],
  };
}

function createDefaultState(): PersistedAppState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    watchlist: ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'TCS', 'TATAMOTORS', 'SBIN'],
    customStrategies: [],
    disabledBuiltinIds: [],
    riskConfig: { ...DEFAULT_RISK_CONFIG },
    riskAuditLog: [],
    paperAccount: createInitialPaperAccount(1000000),
    backtestHistory: [],
    monitoring: createInitialMonitoringState(),
  };
}

/**
 * Non-destructive migration from legacy unversioned / v1 state to schemaVersion v2.
 * Preserves all watchlist, custom strategies, risk audit log, closed paper trades, and prediction ledger items.
 */
export function migratePersistedState(
  parsed: Partial<PersistedAppState>,
  defaults: PersistedAppState = createDefaultState()
): PersistedAppState {
  const migratedMonitoring: MonitoringStateSlice = {
    ...defaults.monitoring,
    ...(parsed.monitoring ?? {}),
    modelVersions:
      Array.isArray(parsed.monitoring?.modelVersions) && parsed.monitoring.modelVersions.length > 0
        ? parsed.monitoring.modelVersions.map((m) => ({ ...m }))
        : defaults.monitoring.modelVersions,
    predictionLedger: Array.isArray(parsed.monitoring?.predictionLedger)
      ? parsed.monitoring.predictionLedger.map((p) => ({
          ...p,
          probTimeout:
            p.probTimeout ??
            Math.max(0, Math.round((1 - (p.probUp ?? 0) - (p.probDown ?? 0)) * 10000) / 10000),
          simulatedExecution: p.simulatedExecution ?? { executed: false },
        }))
      : [],
    baselineFeatureMean: Array.isArray(parsed.monitoring?.baselineFeatureMean)
      ? parsed.monitoring.baselineFeatureMean
      : defaults.monitoring.baselineFeatureMean,
    baselineFeatureStd: Array.isArray(parsed.monitoring?.baselineFeatureStd)
      ? parsed.monitoring.baselineFeatureStd
      : defaults.monitoring.baselineFeatureStd,
  };
  ensureRegisteredModelVersions(migratedMonitoring);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : defaults.watchlist,
    customStrategies: Array.isArray(parsed.customStrategies) ? parsed.customStrategies : defaults.customStrategies,
    disabledBuiltinIds: Array.isArray(parsed.disabledBuiltinIds) ? parsed.disabledBuiltinIds : defaults.disabledBuiltinIds,
    riskConfig: {
      ...defaults.riskConfig,
      ...(parsed.riskConfig ?? {}),
      maxSpreadBps: parsed.riskConfig?.maxSpreadBps ?? defaults.riskConfig.maxSpreadBps,
    },
    riskAuditLog: Array.isArray(parsed.riskAuditLog) ? parsed.riskAuditLog : defaults.riskAuditLog,
    paperAccount: {
      ...defaults.paperAccount,
      ...(parsed.paperAccount ?? {}),
      positions: Array.isArray(parsed.paperAccount?.positions) ? parsed.paperAccount.positions : [],
      orders: Array.isArray(parsed.paperAccount?.orders) ? parsed.paperAccount.orders : [],
      closedTrades: Array.isArray(parsed.paperAccount?.closedTrades) ? parsed.paperAccount.closedTrades : [],
      journal: Array.isArray(parsed.paperAccount?.journal) ? parsed.paperAccount.journal : defaults.paperAccount.journal,
      alerts: Array.isArray(parsed.paperAccount?.alerts) ? parsed.paperAccount.alerts : defaults.paperAccount.alerts,
    },
    backtestHistory: Array.isArray(parsed.backtestHistory) ? parsed.backtestHistory : defaults.backtestHistory,
    monitoring: migratedMonitoring,
  };
}

let memoryState: PersistedAppState | null = null;

export function loadState(): PersistedAppState {
  if (memoryState) return memoryState;
  const defaults = createDefaultState();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedAppState>;
      const needsMigrationPersist = parsed.schemaVersion !== CURRENT_SCHEMA_VERSION;
      memoryState = migratePersistedState(parsed, defaults);
      if (needsMigrationPersist) {
        saveState(memoryState);
      }
      return memoryState;
    }
  } catch (err) {
    console.error('Failed to read persisted state, initializing fresh state:', err);
  }
  memoryState = defaults;
  saveState(memoryState);
  return memoryState;
}

export function saveState(state: PersistedAppState): void {
  memoryState = state;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpPath = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, STATE_FILE);
  } catch (err) {
    console.error('Failed to persist state atomically:', err);
  }
}

export function getAllStrategies(state: PersistedAppState): StrategyConfig[] {
  const disabled = new Set(state.disabledBuiltinIds);
  const builtins = BUILTIN_STRATEGIES.map((s) => ({
    ...s,
    enabled: !disabled.has(s.id),
  }));
  return [...builtins, ...state.customStrategies];
}

export function getLatestSimPrice(symbol: string, barOffset: number): { price: number; high: number; low: number; istLabel: string } {
  const candles = getResearchCandles(symbol.toUpperCase(), '5m');
  const idx = Math.max(40, candles.length - 12 + (barOffset % 11));
  const c = candles[idx];
  return { price: c.close, high: c.high, low: c.low, istLabel: c.istLabel };
}

export function recalculateAccountTotals(account: PaperAccountState): void {
  let usedMargin = 0;
  let unrealized = 0;
  for (const pos of account.positions) {
    const sim = getLatestSimPrice(pos.symbol, account.simulationBarOffset);
    pos.currentPrice = sim.price;
    pos.unrealizedPnl = round2(
      pos.side === 'BUY'
        ? (pos.currentPrice - pos.avgEntryPrice) * pos.quantity
        : (pos.avgEntryPrice - pos.currentPrice) * pos.quantity
    );
    usedMargin += pos.avgEntryPrice * pos.quantity * 0.2; // 5x intraday MIS margin factor (20% margin)
    unrealized += pos.unrealizedPnl;
  }
  account.usedMargin = round2(usedMargin);
  account.unrealizedPnl = round2(unrealized);
  account.totalEquity = round2(account.initialCapital + account.realizedPnlToday + account.unrealizedPnl);
  account.availableCapital = round2(Math.max(0, account.totalEquity - account.usedMargin));
}

export function submitPaperOrder(
  state: PersistedAppState,
  input: {
    clientOrderId?: string;
    predictionId?: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT';
    quantity?: number;
    limitPrice?: number;
    stopLoss: number;
    target: number;
    strategyName: string;
    regime: MarketRegime;
    dataQualityPassed?: boolean;
    modelValidated?: boolean;
    calibrationReliable?: boolean;
    expectedMovePct?: number;
    roundTripCostPct?: number;
    estimatedSpreadBps?: number;
    slippageBps?: number;
    bidAskSpreadBps?: number;
  }
): { decision: RiskDecision; order: PaperOrder; account: PaperAccountState } {
  const account = state.paperAccount;
  recalculateAccountTotals(account);

  const symbol = input.symbol.toUpperCase();
  const clientOrderId = input.clientOrderId || crypto.randomUUID();

  // Idempotency / duplicate order protection
  const duplicate = account.orders.find((o) => o.clientOrderId === clientOrderId);
  if (duplicate) {
    const dummyDecision: RiskDecision = {
      id: crypto.randomUUID(),
      timestampIst: formatNowIst(),
      symbol,
      side: input.side,
      requestedQty: duplicate.quantity,
      approvedQty: 0,
      verdict: 'REJECTED',
      reasons: ['Duplicate clientOrderId detected — idempotency guard blocked re-submission.'],
      estimatedRiskInr: 0,
      riskRewardRatio: 0,
    };
    return { decision: dummyDecision, order: duplicate, account };
  }

  const sim = getLatestSimPrice(symbol, account.simulationBarOffset);
  const entryPrice = input.orderType === 'LIMIT' && input.limitPrice ? input.limitPrice : sim.price;
  const estimatedSpreadBps = input.estimatedSpreadBps ?? state.riskConfig.paperSpreadBps ?? 4;
  const notionalForCost = Math.max(entryPrice * Math.max(1, input.quantity ?? 1), 100000);
  const estimatedRoundTripCharges = calculateNseIntradayCharges(notionalForCost, notionalForCost, {
    brokerageFlatCap: 20,
    brokeragePct: 0.0003,
    slippageBps:
      (input.slippageBps ?? state.riskConfig.paperSlippageBps ?? 5) +
      estimatedSpreadBps / 2,
  });
  const expectedMovePct =
    input.expectedMovePct ?? (entryPrice > 0 ? (Math.abs(input.target - entryPrice) / entryPrice) * 100 : 0);
  const roundTripCostPct =
    input.roundTripCostPct ??
    (notionalForCost > 0 ? (estimatedRoundTripCharges.totalCharges / notionalForCost) * 100 : 0);

  const decision = evaluateOrderRisk(
    {
      symbol,
      side: input.side,
      entryPrice,
      stopLoss: input.stopLoss,
      target: input.target,
      requestedQty: input.quantity,
      istTimeHhMm: sim.istLabel.slice(11, 16),
      estimatedSpreadBps,
      dataQualityPassed: input.dataQualityPassed,
      modelValidated: input.modelValidated,
      calibrationReliable: input.calibrationReliable,
      expectedMovePct,
      roundTripCostPct,
    },
    state.riskConfig,
    account
  );

  state.riskAuditLog.unshift(decision);
  if (state.riskAuditLog.length > 200) state.riskAuditLog.length = 200;

  account.journal.unshift({
    id: crypto.randomUUID(),
    timestampIst: decision.timestampIst,
    type: 'RISK_CHECK',
    symbol,
    strategyName: input.strategyName,
    modelVersion: 'ArthQuant-Risk-v1',
    regime: input.regime,
    summary: decision.reasons.join(' | '),
    riskReward: decision.riskRewardRatio,
    verdict: decision.verdict,
  });

  if (decision.verdict === 'REJECTED') {
    const rejectedOrder: PaperOrder = {
      id: crypto.randomUUID(),
      clientOrderId,
      symbol,
      side: input.side,
      orderType: input.orderType,
      quantity: decision.requestedQty,
      requestedPrice: entryPrice,
      limitPrice: input.limitPrice,
      stopLoss: input.stopLoss,
      target: input.target,
      strategyName: input.strategyName,
      regime: input.regime,
      status: 'REJECTED',
      createdAtIst: formatNowIst(),
      rejectionReason: decision.reasons.join(' '),
    };
    account.orders.unshift(rejectedOrder);
    addAlert(account, 'WARNING', 'RISK', `Order Rejected: ${symbol}`, rejectedOrder.rejectionReason || 'Risk limit breached');
    saveState(state);
    return { decision, order: rejectedOrder, account };
  }

  // Approved: create order & fill if MARKET (or LIMIT already marketable)
  const isMarketableLimit =
    input.orderType === 'LIMIT' &&
    input.limitPrice !== undefined &&
    ((input.side === 'BUY' && sim.price <= input.limitPrice) ||
      (input.side === 'SELL' && sim.price >= input.limitPrice));

  const shouldFillNow = input.orderType === 'MARKET' || isMarketableLimit;
  // Adverse fill: configurable slippage + half the bid-ask spread on market fills.
  const fillSlippageBps = input.slippageBps ?? state.riskConfig.paperSlippageBps ?? 5;
  const fillSpreadBps = input.bidAskSpreadBps ?? estimatedSpreadBps;
  const fillImpactFrac = (Math.max(0, fillSlippageBps) + Math.max(0, fillSpreadBps) / 2) / 10000;
  const fillPrice = roundTick(
    input.side === 'BUY' ? entryPrice * (1 + fillImpactFrac) : entryPrice * (1 - fillImpactFrac)
  );

  const order: PaperOrder = {
    id: crypto.randomUUID(),
    clientOrderId,
    predictionId: input.predictionId,
    symbol,
    side: input.side,
    orderType: input.orderType,
    quantity: decision.approvedQty,
    requestedPrice: entryPrice,
    limitPrice: input.limitPrice,
    stopLoss: roundTick(input.stopLoss),
    target: roundTick(input.target),
    strategyName: input.strategyName,
    regime: input.regime,
    status: shouldFillNow ? 'FILLED' : 'PENDING',
    filledPrice: shouldFillNow ? fillPrice : undefined,
    createdAtIst: formatNowIst(),
    filledAtIst: shouldFillNow ? formatNowIst() : undefined,
  };

  account.orders.unshift(order);

  if (shouldFillNow) {
    openOrUpdatePosition(account, order, state.monitoring);
    if (input.predictionId) {
      const predRec = state.monitoring.predictionLedger.find((p) => p.predictionId === input.predictionId);
      if (predRec) {
        predRec.simulatedExecution = {
          ...(predRec.simulatedExecution ?? {}),
          executed: true,
          orderId: order.id,
          fillPrice,
          slippageInr: round2(Math.abs(fillPrice - entryPrice) * order.quantity),
        };
      }
    }
    account.tradesToday++;
    account.journal.unshift({
      id: crypto.randomUUID(),
      timestampIst: formatNowIst(),
      type: 'ORDER_EXECUTION',
      symbol,
      strategyName: input.strategyName,
      modelVersion: state.monitoring?.activeModelVersion || 'PaperSimulator-v1',
      regime: input.regime,
      summary: `SIMULATED ${order.side} ${order.quantity} ${symbol} @ ₹${fillPrice} (SL ₹${order.stopLoss}, Target ₹${order.target})${input.predictionId ? ` [Pred ${input.predictionId}]` : ''}`,
      riskReward: decision.riskRewardRatio,
      verdict: 'APPROVED',
    });
    addAlert(account, 'INFO', 'EXECUTION', `Paper Fill: ${order.side} ${symbol}`, `${order.quantity} shares @ ₹${fillPrice}`);
  } else {
    addAlert(account, 'INFO', 'EXECUTION', `Pending Limit: ${order.side} ${symbol}`, `${order.quantity} shares @ ₹${input.limitPrice}`);
  }

  recalculateAccountTotals(account);
  saveState(state);
  return { decision, order, account };
}

function openOrUpdatePosition(
  account: PaperAccountState,
  order: PaperOrder,
  monitoring?: MonitoringStateSlice
): void {
  const fillPx = order.filledPrice ?? order.requestedPrice;
  const existing = account.positions.find((p) => p.symbol === order.symbol);
  if (!existing) {
    account.positions.push({
      symbol: order.symbol,
      predictionId: order.predictionId,
      side: order.side,
      quantity: order.quantity,
      avgEntryPrice: fillPx,
      currentPrice: fillPx,
      stopLoss: order.stopLoss,
      target: order.target,
      unrealizedPnl: 0,
      strategyName: order.strategyName,
      regime: order.regime,
      openedAtIst: formatNowIst(),
    });
  } else if (existing.side === order.side) {
    const totalQty = existing.quantity + order.quantity;
    existing.avgEntryPrice = roundTick(
      (existing.avgEntryPrice * existing.quantity + fillPx * order.quantity) / totalQty
    );
    existing.quantity = totalQty;
    existing.stopLoss = order.stopLoss;
    existing.target = order.target;
    if (order.predictionId && !existing.predictionId) {
      existing.predictionId = order.predictionId;
    }
  } else {
    // Opposite order reduces, closes, or flips existing position
    const closeQty = Math.min(existing.quantity, order.quantity);
    recordPositionClose(account, existing, closeQty, fillPx, 'OPPOSITE_ORDER', monitoring);
    const remainder = order.quantity - closeQty;
    if (remainder > 0) {
      account.positions.push({
        symbol: order.symbol,
        predictionId: order.predictionId,
        side: order.side,
        quantity: remainder,
        avgEntryPrice: fillPx,
        currentPrice: fillPx,
        stopLoss: order.stopLoss,
        target: order.target,
        unrealizedPnl: 0,
        strategyName: order.strategyName,
        regime: order.regime,
        openedAtIst: formatNowIst(),
      });
    }
  }
}

export function closePaperPosition(
  state: PersistedAppState,
  symbol: string,
  reason = 'MANUAL_SQUAREOFF'
): PaperAccountState {
  const account = state.paperAccount;
  const upper = symbol.toUpperCase();
  const pos = account.positions.find((p) => p.symbol === upper);
  if (!pos) return account;

  const sim = getLatestSimPrice(upper, account.simulationBarOffset);
  recordPositionClose(
    account,
    pos,
    pos.quantity,
    sim.price,
    reason,
    state.monitoring,
    state.riskConfig
  );
  recalculateAccountTotals(account);
  saveState(state);
  return account;
}

function recordPositionClose(
  account: PaperAccountState,
  pos: PaperPosition,
  qty: number,
  rawExitPrice: number,
  reason: string,
  monitoring?: MonitoringStateSlice,
  riskConfig?: RiskConfig
): void {
  const exitImpactFrac =
    (Math.max(0, riskConfig?.paperSlippageBps ?? 5) +
      Math.max(0, riskConfig?.paperSpreadBps ?? 4) / 2) /
    10000;
  const exitPrice = roundTick(
    pos.side === 'BUY' ? rawExitPrice * (1 - exitImpactFrac) : rawExitPrice * (1 + exitImpactFrac)
  );
  const buyPx = pos.side === 'BUY' ? pos.avgEntryPrice : exitPrice;
  const sellPx = pos.side === 'BUY' ? exitPrice : pos.avgEntryPrice;
  // Entry/exit fill prices already embed slippage + half-spread, so statutory
  // charges must not add a second slippage line.
  const charges = calculateNseIntradayCharges(buyPx * qty, sellPx * qty, { slippageBps: 0 });
  const grossPnl = round2(
    pos.side === 'BUY'
      ? (exitPrice - pos.avgEntryPrice) * qty
      : (pos.avgEntryPrice - exitPrice) * qty
  );
  const netPnl = round2(grossPnl - charges.totalCharges);

  account.realizedPnlToday = round2(account.realizedPnlToday + netPnl);
  if (netPnl <= 0) account.consecutiveLosses++;
  else account.consecutiveLosses = 0;

  account.closedTrades.unshift({
    id: crypto.randomUUID(),
    symbol: pos.symbol,
    side: pos.side,
    quantity: qty,
    entryPrice: pos.avgEntryPrice,
    exitPrice: roundTick(exitPrice),
    grossPnl,
    charges,
    netPnl,
    strategyName: pos.strategyName,
    regime: pos.regime,
    openedAtIst: pos.openedAtIst,
    closedAtIst: formatNowIst(),
    exitReason: reason,
  });

  if (pos.predictionId && monitoring) {
    const predRec = monitoring.predictionLedger.find((p) => p.predictionId === pos.predictionId);
    if (predRec) {
      const exitSlippageInr = round2(Math.abs(exitPrice - rawExitPrice) * qty);
      predRec.simulatedExecution = {
        ...(predRec.simulatedExecution ?? {}),
        executed: true,
        fillPrice: predRec.simulatedExecution?.fillPrice ?? pos.avgEntryPrice,
        exitPrice: roundTick(exitPrice),
        chargesInr: charges.totalCharges,
        slippageInr: round2((predRec.simulatedExecution?.slippageInr ?? 0) + exitSlippageInr),
        netPnlInr: netPnl,
        exitReason: reason,
      };
    }
  }

  account.journal.unshift({
    id: crypto.randomUUID(),
    timestampIst: formatNowIst(),
    type: 'POSITION_CLOSE',
    symbol: pos.symbol,
    strategyName: pos.strategyName,
    modelVersion: 'PaperSimulator-v1',
    regime: pos.regime,
    summary: `Closed ${pos.side} ${qty} ${pos.symbol} @ ₹${exitPrice} (${reason}). Net P&L: ₹${netPnl}`,
    netPnl,
    chargesInr: charges.totalCharges,
    verdict: 'INFO',
  });

  addAlert(
    account,
    netPnl >= 0 ? 'INFO' : 'WARNING',
    'EXECUTION',
    `Closed ${pos.symbol} (${reason})`,
    `Net P&L: ${netPnl >= 0 ? '+' : ''}₹${netPnl.toFixed(2)} after ₹${charges.totalCharges.toFixed(2)} NSE fees`
  );

  if (qty >= pos.quantity) {
    account.positions = account.positions.filter((p) => p.symbol !== pos.symbol);
  } else {
    pos.quantity -= qty;
  }
}

export function stepSimulationBar(state: PersistedAppState): PaperAccountState {
  const account = state.paperAccount;
  account.simulationBarOffset = (account.simulationBarOffset + 1) % 11;

  // Check pending LIMIT orders
  for (const order of account.orders.filter((o) => o.status === 'PENDING')) {
    const sim = getLatestSimPrice(order.symbol, account.simulationBarOffset);
    const hitLimit =
      order.limitPrice !== undefined &&
      ((order.side === 'BUY' && sim.low <= order.limitPrice) ||
        (order.side === 'SELL' && sim.high >= order.limitPrice));
    if (hitLimit && order.limitPrice !== undefined) {
      order.status = 'FILLED';
      order.filledPrice = roundTick(order.limitPrice);
      order.filledAtIst = formatNowIst();
      openOrUpdatePosition(account, order, state.monitoring);
      account.tradesToday++;
      account.journal.unshift({
        id: crypto.randomUUID(),
        timestampIst: order.filledAtIst,
        type: 'ORDER_EXECUTION',
        symbol: order.symbol,
        strategyName: order.strategyName,
        modelVersion: 'PaperSimulator-v1',
        regime: order.regime,
        summary: `SIMULATED LIMIT FILL ${order.side} ${order.quantity} ${order.symbol} @ ₹${order.filledPrice} (SL ₹${order.stopLoss}, Target ₹${order.target})`,
        verdict: 'APPROVED',
      });
      addAlert(
        account,
        'INFO',
        'EXECUTION',
        `Limit Fill: ${order.side} ${order.symbol}`,
        `${order.quantity} shares filled @ ₹${order.filledPrice}`
      );
    }
  }

  // Check SL / Target triggers conservatively (SL first). Stop fills model gap risk:
  // if price has already traded through the stop, the fill is at the worse current price.
  for (const pos of [...account.positions]) {
    const sim = getLatestSimPrice(pos.symbol, account.simulationBarOffset);
    if (pos.side === 'BUY') {
      if (sim.low <= pos.stopLoss) {
        recordPositionClose(
          account,
          pos,
          pos.quantity,
          Math.min(pos.stopLoss, sim.price),
          'STOP_LOSS',
          state.monitoring,
          state.riskConfig
        );
      } else if (sim.high >= pos.target) {
        recordPositionClose(
          account,
          pos,
          pos.quantity,
          pos.target,
          'TARGET_HIT',
          state.monitoring,
          state.riskConfig
        );
      }
    } else {
      if (sim.high >= pos.stopLoss) {
        recordPositionClose(
          account,
          pos,
          pos.quantity,
          Math.max(pos.stopLoss, sim.price),
          'STOP_LOSS',
          state.monitoring,
          state.riskConfig
        );
      } else if (sim.low <= pos.target) {
        recordPositionClose(
          account,
          pos,
          pos.quantity,
          pos.target,
          'TARGET_HIT',
          state.monitoring,
          state.riskConfig
        );
      }
    }
  }

  // Resolve any pending ML predictions whose causal barrier/horizon has elapsed
  resolvePendingPredictions(state.monitoring, account.simulationBarOffset);

  recalculateAccountTotals(account);
  saveState(state);
  return account;
}

export function resetPaperAccount(state: PersistedAppState, initialCapital = 1000000): PaperAccountState {
  state.paperAccount = createInitialPaperAccount(initialCapital);
  saveState(state);
  return state.paperAccount;
}

function addAlert(
  account: PaperAccountState,
  severity: AlertItem['severity'],
  category: AlertItem['category'],
  title: string,
  message: string
): void {
  account.alerts.unshift({
    id: crypto.randomUUID(),
    timestampIst: formatNowIst(),
    severity,
    category,
    title,
    message,
    read: false,
  });
  if (account.alerts.length > 50) account.alerts.length = 50;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function roundTick(price: number): number {
  const rounded = Math.round(price / 0.05) * 0.05;
  return Math.round(rounded * 100) / 100;
}

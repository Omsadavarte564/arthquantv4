import { Download, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, downloadCsv, formatInr } from '../lib/api';
import {
  BacktestResult,
  MarketRegime,
  StockMetadata,
  StrategyConfig,
  StrategyRuleCondition,
  Timeframe,
} from '../types/trading';

interface StrategyBacktestViewProps {
  mode: 'strategies' | 'backtest';
  strategies: StrategyConfig[];
  universe: StockMetadata[];
  backtestHistory: BacktestResult[];
  onRefreshStrategies: () => Promise<void>;
  onRefreshBacktests: () => Promise<void>;
  onOpenBacktestWithStrategy: (strategyId: string) => void;
  selectedBacktestStrategyId: string;
}

export function StrategyBacktestView({
  mode,
  strategies,
  universe,
  backtestHistory,
  onRefreshStrategies,
  onRefreshBacktests,
  onOpenBacktestWithStrategy,
  selectedBacktestStrategyId,
}: StrategyBacktestViewProps) {
  // Strategy Builder State
  const [builderOpen, setBuilderOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [slMult, setSlMult] = useState(1.1);
  const [t1Mult, setT1Mult] = useState(1.8);
  const [minProb, setMinProb] = useState(0.56);
  const [allowedRegimes, setAllowedRegimes] = useState<MarketRegime[]>([
    'STRONG_TREND_BULL',
    'STRONG_TREND_BEAR',
    'HIGH_VOL_BREAKOUT',
  ]);
  const [conditions, setConditions] = useState<StrategyRuleCondition[]>([
    { indicator: 'PRICE_VS_VWAP', operator: 'ABOVE', value: 0 },
    { indicator: 'ADX', operator: '>=', value: 20 },
    { indicator: 'REL_VOL', operator: '>=', value: 1.2 },
  ]);
  const [builderMsg, setBuilderMsg] = useState<string | null>(null);

  // Backtest Runner State
  const [btStrategyId, setBtStrategyId] = useState(selectedBacktestStrategyId || strategies[0]?.id || 'regime-adaptive-ensemble');
  const [btDataset, setBtDataset] = useState<'research' | 'public'>('research');
  const [btSymbols, setBtSymbols] = useState<string[]>(['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'INFY']);
  const [btTimeframe, setBtTimeframe] = useState<Timeframe>('5m');
  const [btCapital, setBtCapital] = useState(1000000);
  const [btRiskPct, setBtRiskPct] = useState(1.0);
  const [btSlippageBps, setBtSlippageBps] = useState(5);
  const [btSpreadBps, setBtSpreadBps] = useState(4);
  const [btPartialFills, setBtPartialFills] = useState(true);
  const [btOosOnly, setBtOosOnly] = useState(true);
  const [btRunning, setBtRunning] = useState(false);
  const [activeResult, setActiveResult] = useState<BacktestResult | null>(backtestHistory[0] ?? null);
  const [btError, setBtError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedBacktestStrategyId) {
      setBtStrategyId(selectedBacktestStrategyId);
    }
  }, [selectedBacktestStrategyId]);

  const handleToggleStrategy = async (id: string) => {
    try {
      await api.toggleStrategy(id);
      await onRefreshStrategies();
    } catch (err) {
      setBuilderMsg(err instanceof Error ? err.message : 'Failed to toggle strategy.');
    }
  };

  const handleAddCondition = () => {
    setConditions((prev) => [...prev, { indicator: 'RSI', operator: '>', value: 52 }]);
  };

  const handleSaveCustomStrategy = async () => {
    setBuilderMsg(null);
    if (!name.trim()) {
      setBuilderMsg('Please provide a strategy name.');
      return;
    }
    try {
      await api.createStrategy({
        name,
        description,
        allowedRegimes,
        entryConditions: conditions,
        stopLossAtrMult: slMult,
        target1AtrMult: t1Mult,
        target2AtrMult: t1Mult * 1.5,
        minProbThreshold: minProb,
        maxHoldingBars: 20,
      });
      await onRefreshStrategies();
      setName('');
      setDescription('');
      setBuilderOpen(false);
      setBuilderMsg('Custom strategy saved to registry.');
    } catch (err) {
      setBuilderMsg(err instanceof Error ? err.message : 'Failed to save strategy.');
    }
  };

  const handleRunBacktest = async () => {
    setBtRunning(true);
    setBtError(null);
    try {
      const res = await api.runBacktest({
        symbols: btSymbols,
        strategyId: btStrategyId,
        timeframe: btTimeframe,
        initialCapital: btCapital,
        riskPerTradePct: btRiskPct,
        brokerageFlatCap: 20,
        brokeragePct: 0.0003,
        slippageBps: btSlippageBps,
        useOutOfSampleOnly: btOosOnly,
        dataset: btDataset,
        bidAskSpreadBps: btSpreadBps,
        partialFillMode: btPartialFills,
        maxParticipationPct: 5,
        enforceCostHurdle: true,
      });
      setActiveResult(res);
      await onRefreshBacktests();
    } catch (err) {
      setBtError(err instanceof Error ? err.message : 'Backtest failed.');
    } finally {
      setBtRunning(false);
    }
  };

  const toggleSymbol = (sym: string) => {
    setBtSymbols((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]
    );
  };

  if (mode === 'strategies') {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Quantitative Strategy Registry & No-Code Builder
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {strategies.length} versioned intraday strategies · Independent Risk Engine overrides all strategy signals
            </p>
          </div>
          <button
            onClick={() => setBuilderOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-sky-600 hover:bg-sky-500 text-white whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            {builderOpen ? 'Close Builder' : 'New Visual Strategy'}
          </button>
        </div>

        {builderMsg && (
          <div className="px-4 py-2.5 rounded-md border border-sky-500/40 bg-sky-50/40 dark:bg-sky-950/30 text-xs text-sky-700 dark:text-sky-300">
            {builderMsg}
          </div>
        )}

        {builderOpen && (
          <div className="p-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Visual No-Code Strategy Builder
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">Strategy Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. VWAP + ADX20 Intraday Momentum"
                  className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Description</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Rule logic summary..."
                  className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>
            </div>

            {/* Entry Rules */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-300">Entry Conditions (All Must Pass)</span>
                <button
                  onClick={handleAddCondition}
                  className="text-sky-600 dark:text-sky-400 hover:underline"
                >
                  + Add Rule
                </button>
              </div>
              {conditions.map((c, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    value={c.indicator}
                    onChange={(e) => {
                      const next = [...conditions];
                      next[idx] = { ...c, indicator: e.target.value as StrategyRuleCondition['indicator'] };
                      setConditions(next);
                    }}
                    className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  >
                    <option value="PRICE_VS_VWAP">Price vs VWAP</option>
                    <option value="RSI">Wilder RSI(14)</option>
                    <option value="ADX">ADX(14)</option>
                    <option value="REL_VOL">Relative Volume</option>
                    <option value="EMA_CROSS">EMA 9/21 Cross</option>
                    <option value="SUPERTREND">Supertrend</option>
                    <option value="BB_POS">Bollinger Band Extreme</option>
                  </select>
                  <select
                    value={c.operator}
                    onChange={(e) => {
                      const next = [...conditions];
                      next[idx] = { ...c, operator: e.target.value as StrategyRuleCondition['operator'] };
                      setConditions(next);
                    }}
                    className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  >
                    <option value=">">&gt;</option>
                    <option value=">=">&gt;=</option>
                    <option value="<">&lt;</option>
                    <option value="<=">&lt;=</option>
                    <option value="ABOVE">ABOVE</option>
                    <option value="BELOW">BELOW</option>
                  </select>
                  <input
                    type="number"
                    step="0.1"
                    value={c.value}
                    onChange={(e) => {
                      const next = [...conditions];
                      next[idx] = { ...c, value: Number(e.target.value) };
                      setConditions(next);
                    }}
                    className="w-24 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                  />
                  <button
                    onClick={() => setConditions((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-1.5 text-slate-400 hover:text-rose-500"
                    aria-label="Remove condition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* ATR Multipliers & Regime Restrictions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">Stop-Loss (ATR Mult)</label>
                <input
                  type="number"
                  step="0.1"
                  value={slMult}
                  onChange={(e) => setSlMult(Number(e.target.value))}
                  className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Target 1 (ATR Mult)</label>
                <input
                  type="number"
                  step="0.1"
                  value={t1Mult}
                  onChange={(e) => setT1Mult(Number(e.target.value))}
                  className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Min ML Prob Threshold</label>
                <input
                  type="number"
                  step="0.02"
                  min="0.5"
                  max="0.85"
                  value={minProb}
                  onChange={(e) => setMinProb(Number(e.target.value))}
                  className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-slate-500">Allowed Regimes:</span>
              {(['STRONG_TREND_BULL', 'STRONG_TREND_BEAR', 'SIDEWAYS_RANGE', 'HIGH_VOL_BREAKOUT'] as MarketRegime[]).map((reg) => (
                <label key={reg} className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowedRegimes.includes(reg)}
                    onChange={() =>
                      setAllowedRegimes((prev) =>
                        prev.includes(reg) ? prev.filter((r) => r !== reg) : [...prev, reg]
                      )
                    }
                  />
                  <span className="font-mono">{reg}</span>
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={handleSaveCustomStrategy}
                className="px-4 py-2 text-xs font-medium rounded-md bg-sky-600 hover:bg-sky-500 text-white"
              >
                Save Strategy to Registry
              </button>
            </div>
          </div>
        )}

        {/* Strategy Library List */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {strategies.map((strat) => (
            <div
              key={strat.id}
              className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-col justify-between gap-3"
            >
              <div className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {strat.name}
                    </h3>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      v{strat.version} · {strat.category} · {strat.isCustom ? 'Custom Builder' : 'Built-in'}
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleStrategy(strat.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded border whitespace-nowrap shrink-0 ${
                      strat.enabled
                        ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                        : 'border-slate-300 dark:border-slate-700 text-slate-400'
                    }`}
                  >
                    {strat.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {strat.description}
                </p>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800/70 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span>
                  SL {strat.stopLossAtrMult}x ATR · T1 {strat.target1AtrMult}x · P≥{Math.round(strat.minProbThreshold * 100)}%
                </span>
                <button
                  onClick={() => {
                    setBtStrategyId(strat.id);
                    onOpenBacktestWithStrategy(strat.id);
                  }}
                  className="text-sky-600 dark:text-sky-400 font-sans font-medium hover:underline whitespace-nowrap shrink-0"
                >
                  Backtest →
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Backtesting Laboratory View
  const displayResult = activeResult ?? backtestHistory[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Configuration Panel */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              No-Lookahead Backtesting Laboratory
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Bar t signals execute at Bar t+1 Open · Conservative SL-first intrabar rule · Full NSE statutory charges + slippage
            </p>
          </div>
          <button
            onClick={handleRunBacktest}
            disabled={btRunning || btSymbols.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5" />
            {btRunning ? 'Running Backtest...' : 'Run Backtest'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 text-xs">
          <div className="md:col-span-2">
            <label className="block text-slate-500 mb-1">Strategy</label>
            <select
              value={btStrategyId}
              onChange={(e) => setBtStrategyId(e.target.value)}
              className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (v{s.version})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Dataset / Window</label>
            <select
              value={btDataset}
              onChange={(e) => setBtDataset(e.target.value as 'research' | 'public')}
              className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-medium"
            >
              <option value="research">Research Replay (14D)</option>
              <option value="public">Real Public .NS (60D)</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Timeframe</label>
            <select
              value={btTimeframe}
              onChange={(e) => setBtTimeframe(e.target.value as Timeframe)}
              className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
            >
              <option value="1m">1m (Recent Intraday)</option>
              <option value="5m">5m Intraday</option>
              <option value="15m">15m Intraday</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Capital (₹) / Risk %</label>
            <div className="flex gap-1.5">
              <input
                type="number"
                value={btCapital}
                onChange={(e) => setBtCapital(Number(e.target.value))}
                className="w-2/3 px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
              />
              <input
                type="number"
                step="0.2"
                value={btRiskPct}
                onChange={(e) => setBtRiskPct(Number(e.target.value))}
                className="w-1/3 px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Slip / Spread (bps)</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={btSlippageBps}
                onChange={(e) => setBtSlippageBps(Number(e.target.value))}
                title="Slippage bps"
                className="w-14 px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
              />
              <input
                type="number"
                value={btSpreadBps}
                onChange={(e) => setBtSpreadBps(Number(e.target.value))}
                title="Bid-Ask Spread bps"
                className="w-14 px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
              />
              <label className="inline-flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={btOosOnly}
                  onChange={(e) => setBtOosOnly(e.target.checked)}
                />
                <span>OOS</span>
              </label>
              <label className="inline-flex items-center gap-1 cursor-pointer" title="Cap qty at 5% bar volume as partial fills">
                <input
                  type="checkbox"
                  checked={btPartialFills}
                  onChange={(e) => setBtPartialFills(e.target.checked)}
                />
                <span>PartFill</span>
              </label>
            </div>
          </div>
        </div>

        {/* Universe selector */}
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-500">Universe ({btSymbols.length} / {universe.length} selected):</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setBtSymbols(['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'INFY'])}
                className="text-sky-600 dark:text-sky-400 hover:underline"
              >
                Top 5 Liquid
              </button>
              <button
                onClick={() =>
                  setBtSymbols(
                    universe
                      .map((u) => u.symbol)
                      .filter((s) => btDataset === 'research' || s !== 'TATAMOTORS')
                  )
                }
                className="text-sky-600 dark:text-sky-400 hover:underline"
              >
                Select All ({btDataset === 'public' ? universe.filter((u) => u.symbol !== 'TATAMOTORS').length : universe.length})
              </button>
              <button
                onClick={() => setBtSymbols([])}
                className="text-slate-500 hover:underline"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {universe.map((u) => {
              const active = btSymbols.includes(u.symbol);
              return (
                <button
                  key={u.symbol}
                  onClick={() => toggleSymbol(u.symbol)}
                  className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors ${
                    active
                      ? 'bg-sky-600 border-sky-600 text-white'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {u.symbol}
                </button>
              );
            })}
          </div>
        </div>

        {btError && <div className="text-xs text-rose-500">{btError}</div>}
      </div>

      {/* Results View */}
      {displayResult ? (
        <div className="space-y-6">
          {/* Statistical Truthfulness & 70% Target Banner */}
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                {displayResult.strategyName} v{displayResult.strategyVersion} · {displayResult.config.useOutOfSampleOnly ? 'Out-of-Sample Split' : 'Full Dataset'} · {displayResult.dataMode}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {displayResult.validationNotice}
              </p>
            </div>
            <button
              onClick={() =>
                downloadCsv(
                  `backtest-${displayResult.strategyName.replace(/\s+/g, '_')}.csv`,
                  ['Symbol', 'Side', 'EntryTime', 'ExitTime', 'Qty', 'Entry', 'Exit', 'GrossPnl', 'Charges', 'NetPnl', 'Reason', 'Regime'],
                  displayResult.trades.map((t) => [
                    t.symbol,
                    t.side,
                    t.entryTimeIst,
                    t.exitTimeIst,
                    t.quantity,
                    t.entryPrice,
                    t.exitPrice,
                    t.grossPnl,
                    t.charges.totalCharges,
                    t.netPnl,
                    t.exitReason,
                    t.regime,
                  ])
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
              <div className="text-[11px] text-slate-500">Net Profit (Gross)</div>
              <div className={`mt-1 text-base font-mono font-semibold tabular-nums ${displayResult.totalNetProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {formatInr(displayResult.totalNetProfit, true)}
              </div>
              <div className="text-[11px] font-mono text-slate-500">
                {displayResult.netReturnPct}% · Gross: {formatInr(displayResult.grossTotalPnl ?? (displayResult.totalNetProfit + displayResult.totalCharges), true)}
              </div>
            </div>
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
              <div className="text-[11px] text-slate-500">Benchmark & Alpha</div>
              <div className="mt-1 text-base font-mono font-semibold tabular-nums">
                {displayResult.benchmarkReturnPct !== undefined ? `${displayResult.benchmarkReturnPct}%` : '—'}
              </div>
              <div className={`text-[11px] font-mono ${(displayResult.alphaOverBenchmarkPct ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                Alpha: {displayResult.alphaOverBenchmarkPct !== undefined ? `${displayResult.alphaOverBenchmarkPct >= 0 ? '+' : ''}${displayResult.alphaOverBenchmarkPct}%` : '—'}
              </div>
            </div>
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
              <div className="text-[11px] text-slate-500">Net Win Rate (95% CI)</div>
              <div className="mt-1 text-base font-mono font-semibold tabular-nums">
                {displayResult.winRatePct}%
              </div>
              <div className="text-[11px] font-mono text-slate-500">
                {displayResult.winRateCI.lowerPct}–{displayResult.winRateCI.upperPct}% (n={displayResult.totalTrades})
              </div>
            </div>
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
              <div className="text-[11px] text-slate-500">Profit Factor / Exp.</div>
              <div className="mt-1 text-base font-mono font-semibold tabular-nums">
                {displayResult.profitFactor}
              </div>
              <div className="text-[11px] font-mono text-slate-500">Exp: {formatInr(displayResult.expectancyInr, true)}</div>
            </div>
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
              <div className="text-[11px] text-slate-500">Max Drawdown</div>
              <div className="mt-1 text-base font-mono font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                -{displayResult.maxDrawdownPct}%
              </div>
              <div className="text-[11px] font-mono text-slate-500">{formatInr(displayResult.maxDrawdownInr)}</div>
            </div>
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
              <div className="text-[11px] text-slate-500">Daily Sharpe / Trade Sh</div>
              <div className="mt-1 text-base font-mono font-semibold tabular-nums">
                {displayResult.portfolioDailySharpe ?? displayResult.sharpeRatio} / {displayResult.sharpeRatio}
              </div>
              <div className="text-[11px] font-mono text-slate-500">Sortino: {displayResult.sortinoRatio} · MaxLoss: {displayResult.maxConsecutiveLosses}</div>
            </div>
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
              <div className="text-[11px] text-slate-500">NSE Fees + Spread + PartFill</div>
              <div className="mt-1 text-base font-mono font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                {formatInr(displayResult.totalCharges)}
              </div>
              <div className="text-[11px] font-mono text-slate-500">
                Sprd: {formatInr(displayResult.totalSpreadCostInr ?? 0)} · PFills: {displayResult.partialFillCount ?? 0} ({displayResult.avgFillRatioPct ?? 100}%)
              </div>
            </div>
          </div>

          {displayResult.dataSourceDetails && (
            <div className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-[11px] font-mono text-slate-600 dark:text-slate-400 flex flex-wrap gap-x-5 gap-y-1">
              <span>Provider: {displayResult.dataSourceDetails.provider}</span>
              <span>Window: {displayResult.dataSourceDetails.dateRangeIst}</span>
              <span>Bars: {displayResult.dataSourceDetails.totalBarsAnalyzed}</span>
              <span>0-Vol Excluded: {displayResult.dataSourceDetails.zeroVolumeBarsExcluded}</span>
              <span>Cost Hurdle Skips: {displayResult.costHurdleSkippedCount ?? 0}</span>
              <span>Liq Skips: {displayResult.liquiditySkippedCount ?? 0}</span>
            </div>
          )}

          {/* Equity Curve Chart */}
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <h3 className="text-sm font-semibold mb-3 text-slate-900 dark:text-slate-100">
              Synchronized Portfolio Equity Curve (After NSE Statutory Charges & Fill Slippage)
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={displayResult.equityCurve}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                  <XAxis dataKey="index" tick={{ fontSize: 11, fill: '#94A3B8' }} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: '#94A3B8' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      borderColor: '#1E293B',
                      fontSize: '12px',
                      color: '#F8FAFC',
                    }}
                  />
                  <Area type="monotone" dataKey="equity" stroke="#0EA5E9" fill="rgba(14, 165, 233, 0.16)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Cost Sensitivity Stress Test & Symbol Attribution */}
          {((displayResult.costSensitivity && displayResult.costSensitivity.length > 0) ||
            (displayResult.symbolBreakdown && displayResult.symbolBreakdown.length > 0)) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {displayResult.costSensitivity && displayResult.costSensitivity.length > 0 && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">
                    Slippage & Execution Cost Stress Test
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2 px-3">Slippage</th>
                        <th className="py-2 px-2 text-right">Trades</th>
                        <th className="py-2 px-2 text-right">Win%</th>
                        <th className="py-2 px-2 text-right">PF</th>
                        <th className="py-2 px-2 text-right">Charges</th>
                        <th className="py-2 px-3 text-right">Net P&L</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                      {displayResult.costSensitivity.map((cs) => (
                        <tr key={cs.slippageBps}>
                          <td className="py-2 px-3 font-mono">{cs.slippageBps} bps</td>
                          <td className="py-2 px-2 text-right font-mono">{cs.totalTrades}</td>
                          <td className="py-2 px-2 text-right font-mono">{cs.winRatePct}%</td>
                          <td className="py-2 px-2 text-right font-mono">{cs.profitFactor}</td>
                          <td className="py-2 px-2 text-right font-mono text-amber-600 dark:text-amber-400">{formatInr(cs.totalCharges)}</td>
                          <td className={`py-2 px-3 text-right font-mono font-medium ${cs.netPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {formatInr(cs.netPnl, true)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {displayResult.symbolBreakdown && displayResult.symbolBreakdown.length > 0 && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">
                    Per-Symbol Attribution ({displayResult.symbolBreakdown.length} stocks)
                  </div>
                  <div className="overflow-x-auto max-h-56">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                          <th className="py-2 px-3">Symbol</th>
                          <th className="py-2 px-2 text-right">Trades</th>
                          <th className="py-2 px-2 text-right">Win%</th>
                          <th className="py-2 px-2 text-right">PF</th>
                          <th className="py-2 px-3 text-right">Net P&L</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                        {displayResult.symbolBreakdown.map((sb) => (
                          <tr key={sb.symbol}>
                            <td className="py-2 px-3 font-semibold">{sb.symbol}</td>
                            <td className="py-2 px-2 text-right font-mono">{sb.trades}</td>
                            <td className="py-2 px-2 text-right font-mono">{sb.winRatePct}%</td>
                            <td className="py-2 px-2 text-right font-mono">{sb.profitFactor}</td>
                            <td className={`py-2 px-3 text-right font-mono ${sb.netPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                              {formatInr(sb.netPnl, true)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Regime Breakdown + Recent Backtest Trades */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">
                Performance by Market Regime
              </div>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 px-3">Regime</th>
                    <th className="py-2 px-2 text-right">N</th>
                    <th className="py-2 px-2 text-right">Win%</th>
                    <th className="py-2 px-3 text-right">Net P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {displayResult.regimeBreakdown.map((r) => (
                    <tr key={r.regime}>
                      <td className="py-2 px-3 font-mono text-[11px]">{r.regime}</td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums">{r.trades}</td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums">{r.winRatePct}%</td>
                      <td className={`py-2 px-3 text-right font-mono tabular-nums ${r.netPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {formatInr(r.netPnl, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="lg:col-span-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">
                Historical Trade Ledger (Latest {Math.min(25, displayResult.trades.length)} of {displayResult.totalTrades})
              </div>
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2 px-3">Symbol</th>
                      <th className="py-2 px-2">Side</th>
                      <th className="py-2 px-2 text-right">Qty</th>
                      <th className="py-2 px-2 text-right">Entry → Exit</th>
                      <th className="py-2 px-2 text-right">Charges</th>
                      <th className="py-2 px-2 text-right">Net P&L</th>
                      <th className="py-2 px-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {displayResult.trades.slice(-25).reverse().map((t) => (
                      <tr key={t.id}>
                        <td className="py-2 px-3 font-semibold">{t.symbol}</td>
                        <td className={`py-2 px-2 font-mono ${t.side === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{t.side}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">{t.quantity}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">₹{t.entryPrice} → ₹{t.exitPrice}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums text-amber-600 dark:text-amber-400">₹{t.charges.totalCharges.toFixed(1)}</td>
                        <td className={`py-2 px-2 text-right font-mono tabular-nums font-medium ${t.netPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {formatInr(t.netPnl, true)}
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-500">{t.exitReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-center text-sm text-slate-500">
          Select your strategy, universe, and slippage assumptions above, then click Run Backtest.
        </div>
      )}
    </div>
  );
}

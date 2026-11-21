import { AlertOctagon, CheckCircle2, Lock, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, formatInr } from '../lib/api';
import {
  BrokerAdapterInfo,
  MlEvaluationResult,
  ModelFamily,
  MonitoringDashboardSummary,
  RiskConfig,
  RiskDecision,
  StockMetadata,
  Timeframe,
} from '../types/trading';

interface RiskMlBrokersSettingsViewProps {
  mode: 'risk' | 'reports' | 'brokers' | 'settings';
  universe: StockMetadata[];
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onRefreshAll: () => Promise<void>;
}

export function RiskMlBrokersSettingsView({
  mode,
  universe,
  darkMode,
  onToggleDarkMode,
  onRefreshAll,
}: RiskMlBrokersSettingsViewProps) {
  // Risk Dashboard state
  const [riskConfig, setRiskConfig] = useState<RiskConfig | null>(null);
  const [auditLog, setAuditLog] = useState<RiskDecision[]>([]);
  const [accountSummary, setAccountSummary] = useState<{
    totalEquity: number;
    realizedPnlToday: number;
    unrealizedPnl: number;
    usedMargin: number;
    openPositions: number;
    tradesToday: number;
    consecutiveLosses: number;
  } | null>(null);
  const [riskSavedMsg, setRiskSavedMsg] = useState<string | null>(null);

  // ML Evaluation & Monitoring state
  const [reportsTab, setReportsTab] = useState<'validation' | 'monitoring'>('validation');
  const [mlSymbol, setMlSymbol] = useState('RELIANCE');
  const [mlTimeframe, setMlTimeframe] = useState<Timeframe>('5m');
  const [mlThreshold, setMlThreshold] = useState(0.62);
  const [mlDataset, setMlDataset] = useState<'research' | 'public'>('research');
  const [mlModelFamily, setMlModelFamily] = useState<ModelFamily>('DUAL_LOGIT_PLATT');
  const [mlResult, setMlResult] = useState<MlEvaluationResult | null>(null);
  const [mlLoading, setMlLoading] = useState(false);
  const [mlError, setMlError] = useState<string | null>(null);
  const [monitoring, setMonitoring] = useState<MonitoringDashboardSummary | null>(null);
  const [monLoading, setMonLoading] = useState(false);
  const [monMsg, setMonMsg] = useState<string | null>(null);

  // Brokers state
  const [brokers, setBrokers] = useState<BrokerAdapterInfo[]>([]);
  const [sebiRef, setSebiRef] = useState('');

  useEffect(() => {
    if (mode === 'risk') {
      api
        .getRiskState()
        .then((res) => {
          setRiskConfig(res.riskConfig);
          setAuditLog(res.auditLog);
          setAccountSummary(res.accountSummary);
        })
        .catch((err) => {
          setRiskSavedMsg(err instanceof Error ? err.message : 'Failed to load risk engine state.');
        });
    } else if (mode === 'brokers') {
      api
        .getBrokers()
        .then((res) => {
          setBrokers(res.adapters);
          setSebiRef(res.sebiCircularRef);
        })
        .catch(() => {
          setBrokers([]);
        });
    } else if (mode === 'reports') {
      if (!mlResult) handleRunMlEval();
      loadMonitoring();
    }
  }, [mode]);

  const loadMonitoring = async () => {
    setMonLoading(true);
    try {
      const sum = await api.getMonitoringSummary();
      setMonitoring(sum);
    } catch {
      // ignore initial error
    } finally {
      setMonLoading(false);
    }
  };

  const handleResolveMonitoring = async () => {
    setMonLoading(true);
    setMonMsg(null);
    try {
      const res = await api.resolveMonitoringPredictions();
      setMonitoring(res.summary);
      setMonMsg(`Checked pending horizons — resolved ${res.resolvedCount} predictions.`);
    } catch (err) {
      setMonMsg(err instanceof Error ? err.message : 'Resolution failed.');
    } finally {
      setMonLoading(false);
    }
  };

  const handleRollbackModel = async (version: string) => {
    setMonLoading(true);
    setMonMsg(null);
    try {
      const res = await api.rollbackModelVersion(version);
      setMonitoring(res.summary);
      setMonMsg(`Active ML model version switched to ${res.activeModelVersion}.`);
      await onRefreshAll();
    } catch (err) {
      setMonMsg(err instanceof Error ? err.message : 'Model rollback failed.');
    } finally {
      setMonLoading(false);
    }
  };

  const handleRunMlEval = async () => {
    setMlLoading(true);
    setMlError(null);
    try {
      const res = await api.evaluateMl(
        mlSymbol,
        mlTimeframe,
        mlThreshold,
        mlDataset,
        mlModelFamily,
        true
      );
      setMlResult(res);
    } catch (err) {
      setMlError(err instanceof Error ? err.message : 'ML evaluation failed.');
    } finally {
      setMlLoading(false);
    }
  };

  const handleSaveRisk = async () => {
    if (!riskConfig) return;
    try {
      const res = await api.updateRiskConfig(riskConfig);
      setRiskConfig(res.riskConfig);
      setRiskSavedMsg('Risk limits updated and persisted.');
      await onRefreshAll();
    } catch (err) {
      setRiskSavedMsg(err instanceof Error ? err.message : 'Failed to save risk policy.');
    }
  };

  const handleKillSwitch = async () => {
    if (!riskConfig) return;
    try {
      const next = !riskConfig.killSwitchActive;
      await api.toggleKillSwitch(next);
      const refreshed = await api.getRiskState();
      setRiskConfig(refreshed.riskConfig);
      setAuditLog(refreshed.auditLog);
      setAccountSummary(refreshed.accountSummary);
      await onRefreshAll();
    } catch (err) {
      setRiskSavedMsg(err instanceof Error ? err.message : 'Failed to toggle kill switch.');
    }
  };

  if (mode === 'risk') {
    if (!riskConfig || !accountSummary) {
      return <div className="p-8 text-sm text-slate-500">Loading Risk Management Engine...</div>;
    }
    return (
      <div className="space-y-6">
        {/* Emergency Kill Switch Banner */}
        <div
          className={`p-4 rounded-lg border flex flex-wrap items-center justify-between gap-4 ${
            riskConfig.killSwitchActive
              ? 'border-rose-500 bg-rose-500/10'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]'
          }`}
        >
          <div className="flex items-start gap-3">
            <AlertOctagon
              className={`w-5 h-5 mt-0.5 ${
                riskConfig.killSwitchActive ? 'text-rose-500' : 'text-slate-400'
              }`}
            />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Emergency Trading Kill Switch: {riskConfig.killSwitchActive ? 'HALTED' : 'ARMED (NORMAL)'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Activating immediately cancels pending limit orders and blocks all new order admission across AI signals and manual tickets.
              </p>
            </div>
          </div>
          <button
            onClick={handleKillSwitch}
            className={`px-4 py-2 text-xs font-semibold rounded-md text-white whitespace-nowrap shrink-0 ${
              riskConfig.killSwitchActive
                ? 'bg-emerald-600 hover:bg-emerald-500'
                : 'bg-rose-600 hover:bg-rose-500'
            }`}
          >
            {riskConfig.killSwitchActive ? 'Resume Trading Admission' : 'Activate Kill Switch'}
          </button>
        </div>

        {/* Live Telemetry & Configurable Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
            <h3 className="text-sm font-semibold">Deterministic Risk Limits</h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">Max Risk / Trade (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={riskConfig.maxLossPerTradePct}
                  onChange={(e) => setRiskConfig({ ...riskConfig, maxLossPerTradePct: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Max Daily Loss (₹)</label>
                <input
                  type="number"
                  step="1000"
                  value={riskConfig.maxDailyLossInr}
                  onChange={(e) => setRiskConfig({ ...riskConfig, maxDailyLossInr: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Max Open Positions</label>
                <input
                  type="number"
                  value={riskConfig.maxOpenPositions}
                  onChange={(e) => setRiskConfig({ ...riskConfig, maxOpenPositions: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Max Trades / Day</label>
                <input
                  type="number"
                  value={riskConfig.maxTradesPerDay}
                  onChange={(e) => setRiskConfig({ ...riskConfig, maxTradesPerDay: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Max Consecutive Losses</label>
                <input
                  type="number"
                  value={riskConfig.maxConsecutiveLosses}
                  onChange={(e) => setRiskConfig({ ...riskConfig, maxConsecutiveLosses: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Min Risk/Reward Ratio</label>
                <input
                  type="number"
                  step="0.1"
                  value={riskConfig.minRiskRewardRatio}
                  onChange={(e) => setRiskConfig({ ...riskConfig, minRiskRewardRatio: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Max Total Exposure (%)</label>
                <input
                  type="number"
                  value={riskConfig.maxTotalExposurePct}
                  onChange={(e) => setRiskConfig({ ...riskConfig, maxTotalExposurePct: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Max Per-Stock Exposure (%)</label>
                <input
                  type="number"
                  value={riskConfig.maxStockExposurePct}
                  onChange={(e) => setRiskConfig({ ...riskConfig, maxStockExposurePct: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-emerald-600 dark:text-emerald-400">{riskSavedMsg || ''}</span>
              <button
                onClick={handleSaveRisk}
                className="px-4 py-2 text-xs font-medium rounded bg-sky-600 hover:bg-sky-500 text-white"
              >
                Save Risk Policy
              </button>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                <div className="text-[11px] text-slate-500">Daily Realized P&L</div>
                <div className="mt-1 font-mono font-semibold text-sm">{formatInr(accountSummary.realizedPnlToday, true)}</div>
              </div>
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                <div className="text-[11px] text-slate-500">Consecutive Losses</div>
                <div className="mt-1 font-mono font-semibold text-sm">{accountSummary.consecutiveLosses} / {riskConfig.maxConsecutiveLosses}</div>
              </div>
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                <div className="text-[11px] text-slate-500">Trades Today</div>
                <div className="mt-1 font-mono font-semibold text-sm">{accountSummary.tradesToday} / {riskConfig.maxTradesPerDay}</div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">
                Immutable Risk Decision Audit Log ({auditLog.length})
              </div>
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2 px-3">Time</th>
                      <th className="py-2 px-2">Order</th>
                      <th className="py-2 px-2 text-right">Qty</th>
                      <th className="py-2 px-2">Verdict</th>
                      <th className="py-2 px-3">Rule Evaluation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {auditLog.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-slate-500">
                          No risk checks recorded yet. Submit a paper trade or execute an AI signal.
                        </td>
                      </tr>
                    ) : (
                      auditLog.map((d) => (
                        <tr key={d.id}>
                          <td className="py-2 px-3 font-mono text-slate-500">{d.timestampIst.slice(11, 19)}</td>
                          <td className="py-2 px-2 font-semibold">{d.side} {d.symbol}</td>
                          <td className="py-2 px-2 text-right font-mono tabular-nums">{d.approvedQty}/{d.requestedQty}</td>
                          <td className={`py-2 px-2 font-mono font-semibold ${d.verdict === 'APPROVED' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {d.verdict}
                          </td>
                          <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{d.reasons.join(' ')}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'reports') {
    return (
      <div className="space-y-6">
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Walk-Forward ML Validation & Drift Monitoring Lab
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Purged Chronological Train → Embargo (≥11 bars) → Platt Calibration → Untouched OOS Test
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <button
                onClick={() => setReportsTab('validation')}
                className={`px-3 py-1.5 rounded border font-medium ${
                  reportsTab === 'validation'
                    ? 'bg-sky-600 border-sky-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                Walk-Forward ML Audit
              </button>
              <button
                onClick={() => {
                  setReportsTab('monitoring');
                  loadMonitoring();
                }}
                className={`px-3 py-1.5 rounded border font-medium ${
                  reportsTab === 'monitoring'
                    ? 'bg-sky-600 border-sky-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                Prediction Ledger & Drift ({monitoring?.totalLoggedPredictions ?? 0})
              </button>
            </div>
          </div>

          {reportsTab === 'validation' && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={mlDataset}
                onChange={(e) => setMlDataset(e.target.value as 'research' | 'public')}
                className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-medium"
              >
                <option value="research">Dataset: Research Replay (14D)</option>
                <option value="public">Dataset: Real Public .NS (60D)</option>
              </select>
              <select
                value={mlModelFamily}
                onChange={(e) => setMlModelFamily(e.target.value as ModelFamily)}
                className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-medium"
              >
                <option value="DUAL_LOGIT_PLATT">Dual Logit + Platt</option>
                <option value="MULTINOMIAL_3CLASS_SOFTMAX">3-Class Softmax</option>
                <option value="RANDOM_FOREST">Random Forest (20T)</option>
                <option value="GBDT_ENSEMBLE">GBDT Ensemble (24R)</option>
              </select>
              <select
                value={mlSymbol}
                onChange={(e) => setMlSymbol(e.target.value)}
                className="px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-semibold"
              >
                {universe.map((u) => (
                  <option key={u.symbol} value={u.symbol}>{u.symbol}</option>
                ))}
              </select>
              <select
                value={mlTimeframe}
                onChange={(e) => setMlTimeframe(e.target.value as Timeframe)}
                className="px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
              >
                <option value="5m">5m</option>
                <option value="15m">15m</option>
                <option value="1m">1m</option>
              </select>
              <select
                value={mlThreshold}
                onChange={(e) => setMlThreshold(Number(e.target.value))}
                className="px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
              >
                <option value={0.55}>Conviction ≥ 55%</option>
                <option value={0.60}>Conviction ≥ 60%</option>
                <option value={0.62}>Conviction ≥ 62%</option>
                <option value={0.68}>Conviction ≥ 68%</option>
              </select>
              <button
                onClick={handleRunMlEval}
                disabled={mlLoading}
                className="px-3.5 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium"
              >
                {mlLoading ? 'Evaluating...' : 'Evaluate OOS'}
              </button>
            </div>
          )}
        </div>

        {reportsTab === 'validation' ? (
          <>
            {mlError && (
              <div className="p-3 rounded-lg border border-rose-500/40 bg-rose-500/5 text-xs text-rose-600 dark:text-rose-400">
                {mlError}
              </div>
            )}

            {mlResult && (
              <>
                {mlResult.overfittingWarning && (
                  <div className="p-3.5 rounded-lg border border-rose-500/50 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300">
                    <span className="font-semibold">Model Validation Warning: </span>
                    {mlResult.overfittingWarning}
                  </div>
                )}

                <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Empirical OOS Verdict ({mlResult.dataMode} · {mlResult.horizonBars ?? 10}-bar horizon):{' '}
                  </span>
                  {mlResult.honestAssessment}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                  <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                    <div className="text-[11px] text-slate-500">Selective OOS Win Rate</div>
                    <div className="mt-1 text-lg font-mono font-semibold">{mlResult.oosFilteredWinRatePct}%</div>
                    <div className="text-[11px] font-mono text-slate-500">n={mlResult.oosFilteredSamples} · CI {mlResult.oosFilteredCI.lowerPct}–{mlResult.oosFilteredCI.upperPct}%</div>
                  </div>
                  <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                    <div className="text-[11px] text-slate-500">Balanced Acc (@0.5 / @Prior)</div>
                    <div className="mt-1 text-lg font-mono font-semibold">
                      {mlResult.classification ? `${mlResult.classification.balancedAccPct}%` : `${mlResult.oosRawWinRatePct}%`}
                      {mlResult.priorMatchedClassification ? ` / ${mlResult.priorMatchedClassification.balancedAccPct}%` : ''}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">
                      F1: {mlResult.classification?.f1Pct ?? '—'}% · 3Cls Acc: {mlResult.threeClassMetrics?.accuracyPct ?? '—'}%
                    </div>
                  </div>
                  <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                    <div className="text-[11px] text-slate-500">Brier / Log Loss</div>
                    <div className="mt-1 text-lg font-mono font-semibold">{mlResult.brierScore}</div>
                    <div className="text-[11px] font-mono text-slate-500">LogLoss: {mlResult.logLoss}</div>
                  </div>
                  <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                    <div className="text-[11px] text-slate-500">Calibration Error</div>
                    <div className="mt-1 text-lg font-mono font-semibold">{mlResult.ecePct ?? '—'}%</div>
                    <div className="text-[11px] font-mono text-slate-500">MCE: {mlResult.mcePct ?? '—'}%</div>
                  </div>
                  <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                    <div className="text-[11px] text-slate-500">ROC AUC (Up / Down)</div>
                    <div className="mt-1 text-lg font-mono font-semibold">
                      {mlResult.rocAucApprox} / {mlResult.shortRocAuc ?? '—'}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">Short Brier: {mlResult.shortBrierScore ?? '—'}</div>
                  </div>
                  <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                    <div className="text-[11px] text-slate-500">Purged Split</div>
                    <div className="mt-1 text-xs font-mono">
                      Train {mlResult.splitSummary.trainBars} · Emb {mlResult.splitSummary.embargoBars}
                    </div>
                    <div className="text-xs font-mono text-slate-500">
                      Val {mlResult.splitSummary.valBars} · Test {mlResult.splitSummary.oosTestBars}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                    <h3 className="text-sm font-semibold mb-3">Reliability Diagram (Predicted vs Empirical OOS %)</h3>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={mlResult.calibrationBins}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                          <XAxis dataKey="binLabel" tick={{ fontSize: 11, fill: '#94A3B8' }} />
                          <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} unit="%" />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#0F172A', borderColor: '#1E293B', fontSize: '12px', color: '#F8FAFC' }}
                          />
                          <Bar dataKey="predictedMean" name="Predicted %" fill="#64748B" />
                          <Bar dataKey="empiricalWinRate" name="Empirical OOS %" fill="#0EA5E9" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold mb-2">OOS Confusion Matrix & Dual Head Summary</h3>
                      {mlResult.classification && (
                        <div className="grid grid-cols-4 gap-2 text-xs font-mono text-center">
                          <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/30">TP: {mlResult.classification.tp}</div>
                          <div className="p-2 rounded bg-rose-500/10 border border-rose-500/30">FP: {mlResult.classification.fp}</div>
                          <div className="p-2 rounded bg-sky-500/10 border border-sky-500/30">TN: {mlResult.classification.tn}</div>
                          <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30">FN: {mlResult.classification.fn}</div>
                        </div>
                      )}
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold mb-2">Causal Feature Weights (Train-Only Fit)</h3>
                      <div className="space-y-2">
                        {mlResult.featureImportances.map((f) => (
                          <div key={f.feature} className="flex items-center justify-between text-xs">
                            <span className="text-slate-700 dark:text-slate-300">{f.feature}</span>
                            <span className={`font-mono tabular-nums font-medium ${f.weight >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                              {f.weight >= 0 ? '+' : ''}{f.weight.toFixed(4)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Baselines + Expanding Walk-Forward Folds + Per-Regime Breakdown */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
                      Baseline Benchmarks (Same OOS Test Set)
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                          <th className="py-2 px-3">Baseline</th>
                          <th className="py-2 px-2 text-right">Acc%</th>
                          <th className="py-2 px-3 text-right">Bal%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                        {(mlResult.baselines ?? []).map((b) => (
                          <tr key={b.name}>
                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{b.name}</td>
                            <td className="py-2 px-2 text-right font-mono">{b.accuracyPct}%</td>
                            <td className="py-2 px-3 text-right font-mono">{b.balancedAccPct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
                      Expanding Walk-Forward Folds (3 Folds)
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                          <th className="py-2 px-3">Fold / Test Window</th>
                          <th className="py-2 px-2 text-right">Acc%</th>
                          <th className="py-2 px-2 text-right">Brier</th>
                          <th className="py-2 px-3 text-right">AUC</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                        {(mlResult.walkForwardFolds ?? []).map((f) => (
                          <tr key={f.foldIndex}>
                            <td className="py-2 px-3 font-mono text-[11px]">
                              #{f.foldIndex} · {f.testRangeIst} ({f.dominantRegime.replace(/_/g, ' ')})
                            </td>
                            <td className="py-2 px-2 text-right font-mono">{f.accuracyPct}%</td>
                            <td className="py-2 px-2 text-right font-mono">{f.brierScore}</td>
                            <td className="py-2 px-3 text-right font-mono">{f.rocAuc}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
                      Per-Regime OOS Performance
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                          <th className="py-2 px-3">Regime</th>
                          <th className="py-2 px-2 text-right">N</th>
                          <th className="py-2 px-2 text-right">Acc%</th>
                          <th className="py-2 px-3 text-right">Brier</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                        {(mlResult.regimePerformance ?? []).map((rp) => (
                          <tr key={rp.regime}>
                            <td className="py-2 px-3 font-mono text-[11px]">{rp.regime}</td>
                            <td className="py-2 px-2 text-right font-mono">{rp.samples}</td>
                            <td className="py-2 px-2 text-right font-mono">{rp.accuracyPct}%</td>
                            <td className="py-2 px-3 text-right font-mono">{rp.brierScore}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {mlResult.modelComparison && mlResult.modelComparison.length > 0 && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold flex flex-wrap items-center justify-between gap-2">
                      <span>4-Family Head-to-Head OOS Benchmark (Untouched Test Split · 14 Causal Features)</span>
                      {mlResult.classPrevalence && (
                        <span className="font-mono text-[11px] text-slate-500">
                          OOS Prevalence — UP: {mlResult.classPrevalence.upPct}% · DOWN: {mlResult.classPrevalence.downPct}% · TIMEOUT: {mlResult.classPrevalence.timeoutPct}%
                        </span>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                            <th className="py-2 px-3">Model Family</th>
                            <th className="py-2 px-2 text-right">AUC (Up/Dn)</th>
                            <th className="py-2 px-2 text-right">Brier</th>
                            <th className="py-2 px-2 text-right">ECE%</th>
                            <th className="py-2 px-2 text-right">3Cls Acc / LL</th>
                            <th className="py-2 px-3 text-right">Sel Win% (N)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                          {mlResult.modelComparison.map((mc) => (
                            <tr key={mc.modelFamily}>
                              <td className="py-2 px-3 font-mono font-semibold">{mc.modelVersion}</td>
                              <td className="py-2 px-2 text-right font-mono">{mc.rocAucUp} / {mc.rocAucDown}</td>
                              <td className="py-2 px-2 text-right font-mono">{mc.brierScore}</td>
                              <td className="py-2 px-2 text-right font-mono">{mc.ecePct}%</td>
                              <td className="py-2 px-2 text-right font-mono">{mc.threeClassAccuracyPct ?? '—'}% / {mc.threeClassLogLoss ?? '—'}</td>
                              <td className="py-2 px-3 text-right font-mono">{mc.selectiveWinRatePct}% ({mc.selectiveCount})</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          /* Prediction Ledger, Concept/Calibration Drift & Model Rollback */
          <div className="space-y-6">
            {monitoring?.driftAlertActive && (
              <div className="p-3.5 rounded-lg border border-rose-500/50 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300">
                <span className="font-semibold">Drift Alert Triggered: </span>
                {monitoring.driftAlertReason}
              </div>
            )}

            {monMsg && (
              <div className="p-3 rounded-lg border border-sky-500/40 bg-sky-500/10 text-xs text-sky-700 dark:text-sky-300">
                {monMsg}
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                <div className="text-[11px] text-slate-500">Logged / Resolved Predictions</div>
                <div className="mt-1 text-lg font-mono font-semibold">
                  {monitoring?.totalLoggedPredictions ?? 0} / {monitoring?.resolvedPredictions ?? 0}
                </div>
                <div className="text-[11px] font-mono text-slate-500">Pending: {monitoring?.pendingPredictions ?? 0}</div>
              </div>
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                <div className="text-[11px] text-slate-500">Resolved Hit Rate vs Conf</div>
                <div className="mt-1 text-lg font-mono font-semibold">{monitoring?.resolvedHitRatePct ?? 0}%</div>
                <div className="text-[11px] font-mono text-slate-500">
                  Avg Conf: {monitoring?.avgConfidencePct ?? 0}% (Drift {monitoring?.calibrationDriftPct ?? 0}%)
                </div>
              </div>
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                <div className="text-[11px] text-slate-500">Covariate Feature Drift (Z)</div>
                <div className="mt-1 text-lg font-mono font-semibold">{monitoring?.featureDriftZScore ?? 0}σ</div>
                <div className="text-[11px] font-mono text-slate-500">Threshold: 1.50σ</div>
              </div>
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                <div className="text-[11px] text-slate-500">Paper vs Backtest Variance</div>
                <div className="mt-1 text-lg font-mono font-semibold">
                  {monitoring?.paperVsBacktestVariance.paperWinRatePct ?? 0}%
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  BT: {monitoring?.paperVsBacktestVariance.latestBacktestWinRatePct ?? '—'}% (Trades: {monitoring?.paperVsBacktestVariance.paperClosedTrades ?? 0})
                </div>
              </div>
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-col justify-between">
                <div className="text-[11px] text-slate-500">Horizon Resolution</div>
                <button
                  onClick={handleResolveMonitoring}
                  disabled={monLoading}
                  className="mt-2 px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium"
                >
                  {monLoading ? 'Updating...' : 'Resolve Elapsed Bars'}
                </button>
              </div>
            </div>

            {/* Model Registry & Rollback */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
                Model Version Registry & Safe Rollback ({monitoring?.activeModelVersion})
              </div>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 px-3">Model Version</th>
                    <th className="py-2 px-3">Notes</th>
                    <th className="py-2 px-2 text-right">OOS Acc</th>
                    <th className="py-2 px-2 text-right">Brier / ECE</th>
                    <th className="py-2 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {(monitoring?.modelVersions ?? []).map((mv) => (
                    <tr key={mv.modelVersion}>
                      <td className="py-2 px-3 font-mono font-semibold">{mv.modelVersion}</td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{mv.notes}</td>
                      <td className="py-2 px-2 text-right font-mono">{mv.oosAccuracyPct}%</td>
                      <td className="py-2 px-2 text-right font-mono">{mv.oosBrierScore} / {mv.ecePct}%</td>
                      <td className="py-2 px-3 text-right">
                        {mv.active ? (
                          <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">ACTIVE</span>
                        ) : (
                          <button
                            onClick={() => handleRollbackModel(mv.modelVersion)}
                            className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px]"
                          >
                            Switch / Rollback
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Daily & Weekly Paper Reports */}
            {((monitoring?.dailyReports?.length ?? 0) > 0 || (monitoring?.weeklyReports?.length ?? 0) > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
                    Daily Paper & Prediction Report
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2 px-3">Date (IST)</th>
                        <th className="py-2 px-2 text-right">Trades (Win%)</th>
                        <th className="py-2 px-2 text-right">Pred Hit%</th>
                        <th className="py-2 px-3 text-right">Net P&L</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                      {(monitoring?.dailyReports ?? []).slice(0, 7).map((dr) => (
                        <tr key={dr.periodLabel}>
                          <td className="py-2 px-3 font-mono">{dr.periodLabel}</td>
                          <td className="py-2 px-2 text-right font-mono">{dr.closedTrades} ({dr.winRatePct}%)</td>
                          <td className="py-2 px-2 text-right font-mono">{dr.predictionHitRatePct}% ({dr.resolvedPredictions})</td>
                          <td className={`py-2 px-3 text-right font-mono ${dr.netPnlInr >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {formatInr(dr.netPnlInr, true)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
                    Weekly Paper & Prediction Report
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2 px-3">ISO Week</th>
                        <th className="py-2 px-2 text-right">Trades (Win%)</th>
                        <th className="py-2 px-2 text-right">Pred Hit%</th>
                        <th className="py-2 px-3 text-right">Net P&L</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                      {(monitoring?.weeklyReports ?? []).slice(0, 6).map((wr) => (
                        <tr key={wr.periodLabel}>
                          <td className="py-2 px-3 font-mono">{wr.periodLabel}</td>
                          <td className="py-2 px-2 text-right font-mono">{wr.closedTrades} ({wr.winRatePct}%)</td>
                          <td className="py-2 px-2 text-right font-mono">{wr.predictionHitRatePct}% ({wr.resolvedPredictions})</td>
                          <td className={`py-2 px-3 text-right font-mono ${wr.netPnlInr >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {formatInr(wr.netPnlInr, true)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Logged Prediction Audit Table */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
                Prediction & Outcome Audit Ledger (Latest {monitoring?.recentPredictions.length ?? 0})
              </div>
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2 px-3">Market Data IST</th>
                      <th className="py-2 px-2">Symbol</th>
                      <th className="py-2 px-2">Dir</th>
                      <th className="py-2 px-2 text-right">P(Up)/P(Dn)/P(TOut)</th>
                      <th className="py-2 px-2">Horizon</th>
                      <th className="py-2 px-2">Status</th>
                      <th className="py-2 px-3 text-right">Outcome / Paper Exec</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {(monitoring?.recentPredictions ?? []).map((p) => (
                      <tr key={p.predictionId}>
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-500">{p.marketDataTimestampIst}</td>
                        <td className="py-2 px-2 font-semibold">{p.symbol}</td>
                        <td className="py-2 px-2 font-mono">{p.direction}</td>
                        <td className="py-2 px-2 text-right font-mono">
                          {(p.probUp * 100).toFixed(1)}% / {(p.probDown * 100).toFixed(1)}% / {((p.probTimeout ?? Math.max(0, 1 - p.probUp - p.probDown)) * 100).toFixed(1)}%
                        </td>
                        <td className="py-2 px-2 font-mono">{p.horizonBars}b</td>
                        <td className={`py-2 px-2 font-mono text-[11px] ${p.status === 'RESOLVED_HIT' ? 'text-emerald-600 dark:text-emerald-400' : p.status === 'RESOLVED_MISS' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'}`}>
                          {p.status}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {p.simulatedExecution?.executed && p.simulatedExecution.netPnlInr !== undefined
                            ? `${p.actualOutcome ?? 'Exec'} · Paper ${formatInr(p.simulatedExecution.netPnlInr, true)}`
                            : p.actualOutcome
                            ? `${p.actualOutcome} (${p.realizedReturnPct ?? 0}%)`
                            : 'Pending bar horizon'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (mode === 'brokers') {
    return (
      <div className="space-y-6">
        <div className="p-4 rounded-lg border border-amber-500/40 bg-amber-500/5 flex items-start gap-3">
          <Lock className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-xs space-y-1">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              Live Real-Money Broker Execution Locked · {sebiRef || 'SEBI Feb 4, 2025 Circular'}
            </div>
            <p className="text-slate-600 dark:text-slate-300">
              Per Indian regulatory rules, live API order placement requires Static IP whitelisting (VPC + Cloud NAT), Exchange Algo ID tagging, daily OAuth/TOTP 2FA handshake, and server-side secrets. Keys are never stored in browser storage.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {brokers.map((b) => (
            <div key={b.id} className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{b.name}</h3>
                <span className="font-mono text-[11px] text-amber-600 dark:text-amber-400">
                  {b.status === 'CONFIGURED_READY_FOR_OAUTH' ? 'CREDS DETECTED' : 'CREDENTIALS NOT SET'}
                </span>
              </div>
              <div className="space-y-1 text-slate-600 dark:text-slate-300">
                <div><span className="font-medium text-slate-500">Pricing:</span> {b.pricingSummary}</div>
                <div><span className="font-medium text-slate-500">Rate Limits:</span> {b.rateLimits}</div>
                <div><span className="font-medium text-slate-500">Auth Flow:</span> {b.authFlow}</div>
                <div><span className="font-medium text-slate-500">Static IP & Algo ID:</span> {b.complianceNotes}</div>
              </div>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800/70 flex items-center justify-between text-[11px]">
                <span className="inline-flex items-center gap-1 text-slate-500">
                  <ShieldAlert className="w-3.5 h-3.5" /> Live Orders: Locked
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Adapter Interface Ready
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Settings & Architecture Docs View
  return (
    <div className="space-y-6">
      <div className="p-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
        <h2 className="text-sm font-semibold">Terminal Appearance & Runtime Configuration</h2>
        <div className="flex items-center justify-between text-xs py-2 border-b border-slate-100 dark:border-slate-800">
          <div>
            <div className="font-medium">Color Theme</div>
            <div className="text-slate-500">Toggle between institutional Dark Terminal and Light Surface</div>
          </div>
          <button
            onClick={onToggleDarkMode}
            className="px-4 py-1.5 rounded border border-slate-200 dark:border-slate-700 font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          </button>
        </div>
        <div className="text-xs space-y-2 text-slate-600 dark:text-slate-300">
          <div className="font-semibold text-slate-900 dark:text-slate-100">Architecture & Documentation Suite</div>
          <p>
            Full technical research, Mermaid architecture diagrams, 12-repo GitHub audit, SEBI Feb 4, 2025 compliance report, database ER schema, and API specifications are maintained in the repository root and <span className="font-mono">/docs</span> directory.
          </p>
        </div>
      </div>
    </div>
  );
}

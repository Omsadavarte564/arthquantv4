import { ArrowDownRight, ArrowUpRight, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { DataHealthPanel } from '../components/DataHealthPanel';
import { api, formatInr, formatPct } from '../lib/api';
import {
  MarketOverviewResponse,
  PaperAccountState,
  StrategyConfig,
  TradingSignal,
} from '../types/trading';

interface OverviewViewProps {
  overview: MarketOverviewResponse | null;
  signals: TradingSignal[];
  account: PaperAccountState | null;
  strategies: StrategyConfig[];
  onNavigate: (page: string) => void;
  onSelectChartSymbol: (symbol: string) => void;
  onExecuteSignal: (signal: TradingSignal) => Promise<void>;
}

export function OverviewView({
  overview,
  signals,
  account,
  strategies,
  onNavigate,
  onSelectChartSymbol,
  onExecuteSignal,
}: OverviewViewProps) {
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  if (!overview || !account) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-lg bg-slate-200 dark:bg-slate-800/60" />
          ))}
        </div>
        <div className="h-72 rounded-lg bg-slate-200 dark:bg-slate-800/60" />
      </div>
    );
  }

  const actionableSignals = signals.filter((s) => s.direction === 'BUY' || s.direction === 'SELL').slice(0, 5);
  const closedWins = account.closedTrades.filter((t) => t.netPnl > 0).length;
  const paperWinRate =
    account.closedTrades.length > 0
      ? ((closedWins / account.closedTrades.length) * 100).toFixed(1)
      : '—';

  const handleGenerateBrief = async () => {
    setLoadingReport(true);
    setAiError(null);
    try {
      const res = await api.generateMarketReport('5m');
      if (res.available && res.report) {
        setAiReport(res.report);
      } else {
        setAiError(res.error || 'Gemini AI unavailable.');
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to generate market brief.');
    } finally {
      setLoadingReport(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Honest Data & Execution Mode Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
          <span className="font-semibold text-amber-600 dark:text-amber-400">
            Data: {overview.dataMode}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-semibold text-sky-600 dark:text-sky-400">
            Execution: {account.executionMode}
          </span>
          <span aria-hidden="true">·</span>
          <span>Live Broker Routing: Locked</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">Bar Time: {overview.istTimestamp}</span>
        </div>
        <button
          onClick={() => onNavigate('brokers')}
          className="text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
        >
          Check Broker & SEBI Readiness →
        </button>
      </div>

      {/* Live Market Data Health Panel */}
      <DataHealthPanel health={overview.dataHealth} compact />

      {/* Benchmark Indices + Portfolio KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {overview.indices.map((idx) => {
          const isUp = idx.change >= 0;
          return (
            <div
              key={idx.symbol}
              className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{idx.name}</span>
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {idx.regime.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {idx.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-mono font-medium tabular-nums ${
                    isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {isUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                  {formatPct(idx.changePct)}
                </span>
              </div>
              <div className="mt-2 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                H {idx.dayHigh.toLocaleString('en-IN')} · L {idx.dayLow.toLocaleString('en-IN')}
              </div>
            </div>
          );
        })}

        {/* Paper Portfolio Summary Card */}
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Paper Equity (Simulated)</span>
            <button
              onClick={() => onNavigate('paper')}
              className="text-xs text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
            >
              Trade Desk
            </button>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatInr(account.totalEquity)}
            </span>
            <span
              className={`text-xs font-mono font-medium tabular-nums ${
                account.realizedPnlToday + account.unrealizedPnl >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {formatInr(account.realizedPnlToday + account.unrealizedPnl, true)}
            </span>
          </div>
          <div className="mt-2 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Open: {account.positions.length} · Win Rate: {paperWinRate}% (n={account.closedTrades.length})
          </div>
        </div>
      </div>

      {/* Main Split: Top Actionable Signals (Left) + AI Market Brief & Breadth (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Top Quantitative Opportunities
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Causal signals passing regime alignment · {signals.filter((s) => s.direction === 'NO_TRADE').length} symbols in NO TRADE
              </p>
            </div>
            <button
              onClick={() => onNavigate('signals')}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              All Signals
            </button>
          </div>

          {actionableSignals.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No high-conviction BUY or SELL setups triggered at the current research bar. Capital preservation (HOLD / NO TRADE) active.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4 font-medium">Symbol</th>
                    <th className="py-2.5 px-3 font-medium">Action</th>
                    <th className="py-2.5 px-3 font-medium text-right">Entry</th>
                    <th className="py-2.5 px-3 font-medium text-right">SL / T1</th>
                    <th className="py-2.5 px-3 font-medium text-right">R/R</th>
                    <th className="py-2.5 px-3 font-medium text-right">Cal. Prob</th>
                    <th className="py-2.5 px-4 font-medium text-right">Execute</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {actionableSignals.map((sig) => (
                    <tr key={sig.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4">
                        <button
                          onClick={() => {
                            onSelectChartSymbol(sig.symbol);
                            onNavigate('charts');
                          }}
                          className="font-semibold text-slate-900 dark:text-slate-100 hover:text-sky-500 text-left"
                        >
                          {sig.symbol}
                        </button>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[170px]">
                          {sig.strategyName}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`font-mono font-semibold ${
                            sig.direction === 'BUY'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {sig.direction}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        ₹{sig.entryPrice.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {sig.stopLoss.toFixed(1)} / {sig.target1.toFixed(1)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {sig.riskRewardRatio}:1
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {(sig.estimatedProbability * 100).toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          onClick={() => onExecuteSignal(sig)}
                          className="px-2.5 py-1 text-xs font-medium rounded bg-sky-600 hover:bg-sky-500 text-white transition-colors whitespace-nowrap shrink-0"
                        >
                          Paper Trade
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Column: Market Breadth + Gemini Brief + Active Strategies */}
        <div className="lg:col-span-4 space-y-4">
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Gemini Market Intelligence
              </h3>
              <button
                onClick={handleGenerateBrief}
                disabled={loadingReport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white transition-colors whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {loadingReport ? 'Analyzing...' : 'Generate Brief'}
              </button>
            </div>
            {aiReport ? (
              <div className="text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
                {aiReport}
              </div>
            ) : aiError ? (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                {aiError}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Generate a structured market regime and sector leadership summary using server-side Gemini (`gemini-4-hydrogen`), strictly grounded in current snapshot metrics.
              </p>
            )}
            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
              <button
                onClick={() => onNavigate('copilot')}
                className="text-sky-600 dark:text-sky-400 hover:underline font-medium"
              >
                Open RAG + MCP Copilot →
              </button>
              <button
                onClick={() => onNavigate('knowledge')}
                className="text-slate-500 dark:text-slate-400 hover:text-slate-200"
              >
                Knowledge Base
              </button>
            </div>
          </div>

          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Market Breadth & Strategy Registry
              </h3>
              <button
                onClick={() => onNavigate('strategies')}
                className="text-xs text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
              >
                Manage
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs pt-1">
              <div>
                <div className="text-slate-500 dark:text-slate-400">Advances / Declines</div>
                <div className="font-mono tabular-nums font-medium mt-0.5">
                  <span className="text-emerald-600 dark:text-emerald-400">{overview.breadth.advances}</span>
                  {' / '}
                  <span className="text-rose-600 dark:text-rose-400">{overview.breadth.declines}</span>
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">NIFTY Realized Vol (Ann.)</div>
                <div className="font-mono tabular-nums font-medium mt-0.5">{overview.breadth.realizedVolAnnualizedPct}%</div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Enabled Strategies</div>
                <div className="font-mono tabular-nums font-medium mt-0.5">
                  {strategies.filter((s) => s.enabled).length} / {strategies.length}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Daily Trades (Sim)</div>
                <div className="font-mono tabular-nums font-medium mt-0.5">{account.tradesToday}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom: Active Positions Preview */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Open Simulated Positions ({account.positions.length})
          </h3>
          <button
            onClick={() => onNavigate('portfolio')}
            className="text-xs text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
          >
            Full Portfolio →
          </button>
        </div>
        {account.positions.length === 0 ? (
          <div className="p-6 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
            <span>No open intraday positions. Execute an AI signal or place a simulated ticket on the Paper Trading desk.</span>
            <button
              onClick={() => onNavigate('paper')}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              Open Paper Desk
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 px-4 font-medium">Symbol</th>
                  <th className="py-2 px-3 font-medium">Side</th>
                  <th className="py-2 px-3 font-medium text-right">Qty</th>
                  <th className="py-2 px-3 font-medium text-right">Avg Entry</th>
                  <th className="py-2 px-3 font-medium text-right">LTP</th>
                  <th className="py-2 px-3 font-medium text-right">SL / Target</th>
                  <th className="py-2 px-4 font-medium text-right">Unrealized P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {account.positions.map((pos) => (
                  <tr key={pos.symbol}>
                    <td className="py-2.5 px-4 font-semibold">{pos.symbol}</td>
                    <td
                      className={`py-2.5 px-3 font-mono font-semibold ${
                        pos.side === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {pos.side}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{pos.quantity}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">₹{pos.avgEntryPrice.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">₹{pos.currentPrice.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                      {pos.stopLoss.toFixed(1)} / {pos.target.toFixed(1)}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono tabular-nums font-semibold ${
                        pos.unrealizedPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatInr(pos.unrealizedPnl, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

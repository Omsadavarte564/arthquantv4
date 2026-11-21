import { Download, FastForward, RotateCcw, Search } from 'lucide-react';
import { useState } from 'react';
import { api, downloadCsv, formatInr } from '../lib/api';
import { PaperAccountState, RiskConfig, ScannerRow, StockMetadata } from '../types/trading';

interface PaperPortfolioJournalViewProps {
  mode: 'paper' | 'portfolio' | 'journal';
  account: PaperAccountState | null;
  riskConfig: RiskConfig | null;
  universe: StockMetadata[];
  scannerRows: ScannerRow[];
  onRefreshAll: () => Promise<void>;
}

export function PaperPortfolioJournalView({
  mode,
  account,
  riskConfig,
  universe,
  scannerRows,
  onRefreshAll,
}: PaperPortfolioJournalViewProps) {
  const [symbol, setSymbol] = useState('RELIANCE');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [stopLoss, setStopLoss] = useState<string>('');
  const [target, setTarget] = useState<string>('');
  const [orderMsg, setOrderMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [journalSearch, setJournalSearch] = useState('');
  const [journalTypeFilter, setJournalTypeFilter] = useState('ALL');

  if (!account || !riskConfig) {
    return <div className="p-8 text-sm text-slate-500">Loading paper trading ledger...</div>;
  }

  const activeQuote = scannerRows.find((r) => r.symbol === symbol);
  const ltp = activeQuote?.ltp ?? 1450;

  const autoFillBracket = (selSide: 'BUY' | 'SELL', basePrice: number) => {
    const sl = selSide === 'BUY' ? basePrice * 0.992 : basePrice * 1.008;
    const tgt = selSide === 'BUY' ? basePrice * 1.014 : basePrice * 0.986;
    setStopLoss((Math.round(sl / 0.05) * 0.05).toFixed(2));
    setTarget((Math.round(tgt / 0.05) * 0.05).toFixed(2));
  };

  const handlePlaceOrder = async () => {
    setOrderMsg(null);
    if (orderType === 'LIMIT' && (!limitPrice || Number(limitPrice) <= 0)) {
      setOrderMsg({ ok: false, text: 'Enter a valid positive Limit Price for LIMIT orders.' });
      return;
    }
    if (quantity && (!Number.isInteger(Number(quantity)) || Number(quantity) <= 0)) {
      setOrderMsg({ ok: false, text: 'Quantity must be a positive whole integer (or leave blank for Auto Risk Size).' });
      return;
    }
    setSubmitting(true);
    const parsedSl = Number(stopLoss) || Number((side === 'BUY' ? ltp * 0.992 : ltp * 1.008).toFixed(2));
    const parsedTgt = Number(target) || Number((side === 'BUY' ? ltp * 1.014 : ltp * 0.986).toFixed(2));
    try {
      const res = await api.submitPaperOrder({
        symbol,
        side,
        orderType,
        quantity: quantity ? Number(quantity) : undefined,
        limitPrice: orderType === 'LIMIT' && limitPrice ? Number(limitPrice) : undefined,
        stopLoss: parsedSl,
        target: parsedTgt,
        strategyName: 'Paper Desk Ticket',
        regime: activeQuote?.regime ?? 'STRONG_TREND_BULL',
      });
      setOrderMsg({
        ok: true,
        text: `SIMULATED FILL APPROVED: ${side} ${res.decision.approvedQty} ${symbol}. ${res.decision.reasons[0]}`,
      });
      await onRefreshAll();
    } catch (err) {
      setOrderMsg({
        ok: false,
        text: `RISK REJECTED: ${err instanceof Error ? err.message : 'Order blocked by Risk Gatekeeper.'}`,
      });
      await onRefreshAll();
    } finally {
      setSubmitting(false);
    }
  };

  const handleClosePosition = async (sym: string) => {
    try {
      await api.closePaperPosition(sym);
      setOrderMsg({ ok: true, text: `Squared off simulated ${sym} position.` });
      await onRefreshAll();
    } catch (err) {
      setOrderMsg({ ok: false, text: err instanceof Error ? err.message : `Failed to close ${sym}.` });
    }
  };

  const handleStepBar = async () => {
    try {
      await api.stepPaperSim();
      await onRefreshAll();
    } catch (err) {
      setOrderMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed to step simulation bar.' });
    }
  };

  const handleReset = async () => {
    try {
      await api.resetPaperAccount(1000000);
      setOrderMsg({ ok: true, text: 'Paper account reset to ₹10,00,000 virtual capital.' });
      await onRefreshAll();
    } catch (err) {
      setOrderMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed to reset paper account.' });
    }
  };

  if (mode === 'portfolio') {
    const exposure = account.positions.reduce((s, p) => s + p.currentPrice * p.quantity, 0);
    const exposurePct = account.totalEquity > 0 ? (exposure / account.totalEquity) * 100 : 0;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <div className="text-xs text-slate-500">Total Account Equity (Simulated)</div>
            <div className="mt-1.5 text-xl font-mono font-semibold tabular-nums">{formatInr(account.totalEquity)}</div>
            <div className="text-xs font-mono text-slate-500 mt-1">Initial: {formatInr(account.initialCapital)}</div>
          </div>
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <div className="text-xs text-slate-500">Available Margin / Used</div>
            <div className="mt-1.5 text-xl font-mono font-semibold tabular-nums">{formatInr(account.availableCapital)}</div>
            <div className="text-xs font-mono text-slate-500 mt-1">Used MIS Margin: {formatInr(account.usedMargin)}</div>
          </div>
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <div className="text-xs text-slate-500">Realized / Unrealized P&L</div>
            <div className={`mt-1.5 text-xl font-mono font-semibold tabular-nums ${account.realizedPnlToday >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {formatInr(account.realizedPnlToday, true)}
            </div>
            <div className="text-xs font-mono text-slate-500 mt-1">Unrealized: {formatInr(account.unrealizedPnl, true)}</div>
          </div>
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <div className="text-xs text-slate-500">Gross Exposure</div>
            <div className="mt-1.5 text-xl font-mono font-semibold tabular-nums">{formatInr(exposure)}</div>
            <div className="text-xs font-mono text-slate-500 mt-1">{exposurePct.toFixed(1)}% of equity (cap {riskConfig.maxTotalExposurePct}%)</div>
          </div>
        </div>

        {/* Open Positions */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Open Simulated Positions ({account.positions.length})</h3>
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">SIMULATED EXECUTION ONLY</span>
          </div>
          {account.positions.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">No open positions in simulated portfolio.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2.5 px-4">Symbol</th>
                    <th className="py-2.5 px-3">Side</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Avg Entry</th>
                    <th className="py-2.5 px-3 text-right">Current</th>
                    <th className="py-2.5 px-3 text-right">Market Value</th>
                    <th className="py-2.5 px-3 text-right">Unrealized P&L</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {account.positions.map((p) => (
                    <tr key={p.symbol}>
                      <td className="py-2.5 px-4 font-semibold">{p.symbol}</td>
                      <td className={`py-2.5 px-3 font-mono font-semibold ${p.side === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{p.side}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{p.quantity}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">₹{p.avgEntryPrice.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">₹{p.currentPrice.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatInr(p.currentPrice * p.quantity)}</td>
                      <td className={`py-2.5 px-3 text-right font-mono tabular-nums font-semibold ${p.unrealizedPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {formatInr(p.unrealizedPnl, true)}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          onClick={() => handleClosePosition(p.symbol)}
                          className="px-2.5 py-1 text-xs rounded border border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                        >
                          Square Off
                        </button>
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

  if (mode === 'journal') {
    const q = journalSearch.trim().toUpperCase();
    const filteredJournal = account.journal
      .filter((j) => (journalTypeFilter === 'ALL' ? true : j.type === journalTypeFilter))
      .filter((j) => (!q ? true : j.symbol.includes(q) || j.summary.toUpperCase().includes(q) || j.strategyName.toUpperCase().includes(q)));

    return (
      <div className="space-y-4">
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="relative min-w-[220px] flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                value={journalSearch}
                onChange={(e) => setJournalSearch(e.target.value)}
                placeholder="Search symbol, strategy, or risk decision..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <select
              value={journalTypeFilter}
              onChange={(e) => setJournalTypeFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              <option value="ALL">All Events</option>
              <option value="RISK_CHECK">Risk Checks</option>
              <option value="ORDER_EXECUTION">Order Executions</option>
              <option value="POSITION_CLOSE">Position Closes</option>
            </select>
          </div>
          <button
            onClick={() =>
              downloadCsv(
                'arthquant-trade-journal.csv',
                ['Timestamp', 'Type', 'Symbol', 'Strategy', 'Regime', 'Verdict', 'NetPnl', 'Summary'],
                filteredJournal.map((j) => [j.timestampIst, j.type, j.symbol, j.strategyName, j.regime, j.verdict, j.netPnl ?? '', j.summary])
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5" />
            Export Journal
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-2.5 px-4">Timestamp (IST)</th>
                  <th className="py-2.5 px-3">Event</th>
                  <th className="py-2.5 px-3">Symbol</th>
                  <th className="py-2.5 px-3">Strategy / Regime</th>
                  <th className="py-2.5 px-3">Verdict</th>
                  <th className="py-2.5 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {filteredJournal.map((j) => (
                  <tr key={j.id}>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">{j.timestampIst}</td>
                    <td className="py-2.5 px-3 font-mono">{j.type}</td>
                    <td className="py-2.5 px-3 font-semibold">{j.symbol}</td>
                    <td className="py-2.5 px-3 text-slate-500">{j.strategyName} · {j.regime}</td>
                    <td className={`py-2.5 px-3 font-mono font-semibold ${j.verdict === 'APPROVED' ? 'text-emerald-600 dark:text-emerald-400' : j.verdict === 'REJECTED' ? 'text-rose-600 dark:text-rose-400' : 'text-sky-600 dark:text-sky-400'}`}>
                      {j.verdict}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">{j.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // Paper Trading Desk View
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
        <div className="text-xs text-slate-700 dark:text-slate-300">
          <span className="font-semibold text-amber-600 dark:text-amber-400">SIMULATED PAPER EXECUTION</span>
          {' · '}
          Persisted across restarts · Orders pass through the Independent Risk Gatekeeper and deduct NSE statutory fees on close.
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleStepBar}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            <FastForward className="w-3.5 h-3.5" />
            Step Next 5m Bar
          </button>
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset ₹10L
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Order Ticket */}
        <div className="lg:col-span-4 p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Simulated Order Ticket</h3>
            <span className="text-xs font-mono tabular-nums text-slate-500">LTP: ₹{ltp.toFixed(2)}</span>
          </div>

          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-md text-xs">
            <button
              onClick={() => {
                setSide('BUY');
                autoFillBracket('BUY', ltp);
              }}
              className={`py-1.5 font-semibold rounded ${side === 'BUY' ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}
            >
              BUY
            </button>
            <button
              onClick={() => {
                setSide('SELL');
                autoFillBracket('SELL', ltp);
              }}
              className={`py-1.5 font-semibold rounded ${side === 'SELL' ? 'bg-rose-600 text-white' : 'text-slate-500'}`}
            >
              SELL
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-500 mb-1">NSE Symbol</label>
              <select
                value={symbol}
                onChange={(e) => {
                  const s = e.target.value;
                  setSymbol(s);
                  const q = scannerRows.find((r) => r.symbol === s);
                  if (q) autoFillBracket(side, q.ltp);
                }}
                className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-semibold"
              >
                {universe.map((u) => (
                  <option key={u.symbol} value={u.symbol}>
                    {u.symbol} — {u.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-500 mb-1">Order Type</label>
                <select
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value as 'MARKET' | 'LIMIT')}
                  className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                >
                  <option value="MARKET">MARKET</option>
                  <option value="LIMIT">LIMIT</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Qty (blank = Auto Risk Size)</label>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Auto"
                  className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
            </div>

            {orderType === 'LIMIT' && (
              <div>
                <label className="block text-slate-500 mb-1">Limit Price (₹)</label>
                <input
                  type="number"
                  step="0.05"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder={String(ltp)}
                  className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-500 mb-1">Stop-Loss (₹)</label>
                <input
                  type="number"
                  step="0.05"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  placeholder={(side === 'BUY' ? ltp * 0.992 : ltp * 1.008).toFixed(2)}
                  className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Target (₹)</label>
                <input
                  type="number"
                  step="0.05"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder={(side === 'BUY' ? ltp * 1.014 : ltp * 0.986).toFixed(2)}
                  className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
            </div>

            <button
              onClick={handlePlaceOrder}
              disabled={submitting}
              className={`w-full py-2 font-semibold rounded-md text-white transition-colors ${
                side === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'
              }`}
            >
              {submitting ? 'Checking Risk Engine...' : `Submit Simulated ${side}`}
            </button>

            {orderMsg && (
              <div
                className={`p-2.5 rounded text-[11px] leading-relaxed ${
                  orderMsg.ok
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                }`}
              >
                {orderMsg.text}
              </div>
            )}
          </div>
        </div>

        {/* Positions, Orders, Closed Trades */}
        <div className="lg:col-span-8 space-y-4">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="font-semibold text-sm">Active Paper Positions ({account.positions.length})</span>
              <span className="font-mono">
                Equity: {formatInr(account.totalEquity)} · Realized Today: {formatInr(account.realizedPnlToday, true)}
              </span>
            </div>
            {account.positions.length === 0 ? (
              <div className="p-6 text-xs text-slate-500">No open positions.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2 px-3">Symbol</th>
                      <th className="py-2 px-2">Side</th>
                      <th className="py-2 px-2 text-right">Qty</th>
                      <th className="py-2 px-2 text-right">Entry → LTP</th>
                      <th className="py-2 px-2 text-right">SL / Tgt</th>
                      <th className="py-2 px-2 text-right">Unrealized</th>
                      <th className="py-2 px-3 text-right">Exit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {account.positions.map((p) => (
                      <tr key={p.symbol}>
                        <td className="py-2 px-3 font-semibold">{p.symbol}</td>
                        <td className={`py-2 px-2 font-mono ${p.side === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{p.side}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">{p.quantity}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">₹{p.avgEntryPrice} → ₹{p.currentPrice}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-500">{p.stopLoss} / {p.target}</td>
                        <td className={`py-2 px-2 text-right font-mono tabular-nums font-semibold ${p.unrealizedPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {formatInr(p.unrealizedPnl, true)}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            onClick={() => handleClosePosition(p.symbol)}
                            className="px-2 py-1 rounded border border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                          >
                            Close
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">
              Order Book & Closed Trades ({account.orders.length} orders · {account.closedTrades.length} closed)
            </div>
            <div className="overflow-x-auto max-h-64">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 px-3">Time</th>
                    <th className="py-2 px-2">Symbol</th>
                    <th className="py-2 px-2">Type</th>
                    <th className="py-2 px-2 text-right">Qty</th>
                    <th className="py-2 px-2 text-right">Price</th>
                    <th className="py-2 px-3">Status / Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {account.orders.slice(0, 20).map((o) => (
                    <tr key={o.id}>
                      <td className="py-2 px-3 font-mono text-slate-500">{o.createdAtIst.slice(11, 19)}</td>
                      <td className="py-2 px-2 font-semibold">{o.side} {o.symbol}</td>
                      <td className="py-2 px-2 font-mono">{o.orderType}</td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums">{o.quantity}</td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums">₹{(o.filledPrice ?? o.requestedPrice).toFixed(2)}</td>
                      <td className="py-2 px-3">
                        <span className={`font-mono font-semibold ${o.status === 'FILLED' ? 'text-emerald-600 dark:text-emerald-400' : o.status === 'REJECTED' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-500'}`}>
                          {o.status}
                        </span>
                        {o.rejectionReason ? <span className="text-slate-500 ml-1.5">· {o.rejectionReason}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {account.closedTrades.length > 0 && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">
                Closed Paper Trades & NSE Charges ({account.closedTrades.length})
              </div>
              <div className="overflow-x-auto max-h-56">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2 px-3">Symbol</th>
                      <th className="py-2 px-2">Side</th>
                      <th className="py-2 px-2 text-right">Qty</th>
                      <th className="py-2 px-2 text-right">Entry → Exit</th>
                      <th className="py-2 px-2 text-right">NSE Fees</th>
                      <th className="py-2 px-2 text-right">Net P&L</th>
                      <th className="py-2 px-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {account.closedTrades.slice(0, 20).map((t) => (
                      <tr key={t.id}>
                        <td className="py-2 px-3 font-semibold">{t.symbol}</td>
                        <td className={`py-2 px-2 font-mono ${t.side === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{t.side}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">{t.quantity}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">₹{t.entryPrice.toFixed(2)} → ₹{t.exitPrice.toFixed(2)}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums text-amber-600 dark:text-amber-400">₹{t.charges.totalCharges.toFixed(2)}</td>
                        <td className={`py-2 px-2 text-right font-mono tabular-nums font-semibold ${t.netPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {formatInr(t.netPnl, true)}
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-500">{t.exitReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

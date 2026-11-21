import { RefreshCw, Search, Sparkles, Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatPct } from '../lib/api';
import { NseDirectoryResponse, PublicNseQuote, ScannerRow, TradingSignal } from '../types/trading';

interface ScannerSignalsViewProps {
  mode: 'scanner' | 'signals';
  scannerRows: ScannerRow[];
  signals: TradingSignal[];
  onToggleWatchlist: (symbol: string, current: boolean) => Promise<void>;
  onSelectChartSymbol: (symbol: string) => void;
  onExecuteSignal: (signal: TradingSignal) => Promise<void>;
}

export function ScannerSignalsView({
  mode,
  scannerRows,
  signals,
  onToggleWatchlist,
  onSelectChartSymbol,
  onExecuteSignal,
}: ScannerSignalsViewProps) {
  const [search, setSearch] = useState('');
  const [sectorFilter, setSectorFilter] = useState('ALL');
  const [regimeFilter, setRegimeFilter] = useState('ALL');
  const [signalFilter, setSignalFilter] = useState('ALL');
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [minRvol, setMinRvol] = useState(0);
  const [sortBy, setSortBy] = useState<'aiProbUp' | 'relVolume' | 'changePct' | 'rsi14'>('relVolume');

  const [aiSummarySymbol, setAiSummarySymbol] = useState<string | null>(null);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const [scannerTab, setScannerTab] = useState<'research' | 'directory'>('research');
  const [dirScope, setDirScope] = useState<'clean' | 'all' | 'research'>('clean');
  const [dirPage, setDirPage] = useState(1);
  const [dirData, setDirData] = useState<NseDirectoryResponse | null>(null);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirSyncing, setDirSyncing] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [dirQuotes, setDirQuotes] = useState<Record<string, PublicNseQuote>>({});
  const [quoteLoadingSym, setQuoteLoadingSym] = useState<string | null>(null);

  const handleFetchQuote = async (symbol: string) => {
    setQuoteLoadingSym(symbol);
    setDirError(null);
    try {
      const res = await api.getPublicQuote(symbol);
      setDirQuotes((prev) => ({ ...prev, [symbol]: res.quote }));
    } catch (err) {
      setDirError(err instanceof Error ? err.message : `Unable to fetch NSE quote for ${symbol}.`);
    } finally {
      setQuoteLoadingSym(null);
    }
  };

  const loadDirectory = useCallback(async (q: string, scope: 'clean' | 'all' | 'research', page: number) => {
    setDirLoading(true);
    setDirError(null);
    try {
      const res = await api.getNseDirectory({ q, scope, page, limit: 50 });
      setDirData(res);
    } catch (err) {
      setDirError(err instanceof Error ? err.message : 'Failed to load NSE directory.');
    } finally {
      setDirLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'scanner' && scannerTab === 'directory') {
      const timer = setTimeout(() => {
        loadDirectory(search, dirScope, dirPage);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [mode, scannerTab, search, dirScope, dirPage, loadDirectory]);

  useEffect(() => {
    if (mode !== 'scanner' || scannerTab !== 'directory') return;
    const iv = setInterval(() => {
      loadDirectory(search, dirScope, dirPage);
    }, 20000);
    return () => clearInterval(iv);
  }, [mode, scannerTab, search, dirScope, dirPage, loadDirectory]);

  const handleSyncDirectory = async () => {
    setDirSyncing(true);
    setDirError(null);
    try {
      await api.syncNseDirectory();
      await loadDirectory(search, dirScope, 1);
      setDirPage(1);
    } catch (err) {
      setDirError(err instanceof Error ? err.message : 'Failed to sync NSE master list.');
    } finally {
      setDirSyncing(false);
    }
  };

  const sectors = useMemo(
    () => ['ALL', ...Array.from(new Set(scannerRows.map((r) => r.sector))).sort()],
    [scannerRows]
  );

  const filteredScanner = useMemo(() => {
    const q = search.trim().toUpperCase();
    return scannerRows
      .filter((r) => (!q ? true : r.symbol.includes(q) || r.name.toUpperCase().includes(q)))
      .filter((r) => (sectorFilter === 'ALL' ? true : r.sector === sectorFilter))
      .filter((r) => (regimeFilter === 'ALL' ? true : r.regime === regimeFilter))
      .filter((r) => (signalFilter === 'ALL' ? true : r.signal === signalFilter))
      .filter((r) => (watchlistOnly ? r.inWatchlist : true))
      .filter((r) => r.relVolume >= minRvol)
      .sort((a, b) => b[sortBy] - a[sortBy]);
  }, [scannerRows, search, sectorFilter, regimeFilter, signalFilter, watchlistOnly, minRvol, sortBy]);

  const filteredSignals = useMemo(() => {
    const q = search.trim().toUpperCase();
    return signals
      .filter((s) => (!q ? true : s.symbol.includes(q) || s.companyName.toUpperCase().includes(q)))
      .filter((s) => (regimeFilter === 'ALL' ? true : s.regime === regimeFilter))
      .filter((s) => (signalFilter === 'ALL' ? true : s.direction === signalFilter));
  }, [signals, search, regimeFilter, signalFilter]);

  const handleStockSummary = async (symbol: string) => {
    setAiSummarySymbol(symbol);
    setAiText(null);
    setAiError(null);
    setAiLoading(true);
    try {
      const res = await api.generateStockSummary(symbol);
      if (res.available && res.summary) setAiText(res.summary);
      else setAiError(res.error || 'Gemini AI unavailable.');
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to fetch AI summary.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleExplainSignal = async (sig: TradingSignal) => {
    setAiSummarySymbol(`${sig.symbol} Signal`);
    setAiText(null);
    setAiError(null);
    setAiLoading(true);
    try {
      const res = await api.explainSignal(sig);
      if (res.available && res.explanation) setAiText(res.explanation);
      else setAiError(res.error || 'Gemini AI unavailable.');
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to explain signal.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Scanner Mode Switcher: Quant Research (24) vs Full NSE Master Directory (3,100+) */}
      {mode === 'scanner' && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setScannerTab('research')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                scannerTab === 'research'
                  ? 'bg-sky-600 border-sky-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              Quant Research Scanner ({scannerRows.length} Stocks)
            </button>
            <button
              onClick={() => setScannerTab('directory')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                scannerTab === 'directory'
                  ? 'bg-sky-600 border-sky-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              All NSE Listed Shares {dirData ? `(${dirData.counts.standardEquities.toLocaleString('en-IN')}+)` : '(3,100+)'}
            </button>
          </div>
          {scannerTab === 'directory' && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={dirScope}
                onChange={(e) => {
                  setDirScope(e.target.value as 'clean' | 'all' | 'research');
                  setDirPage(1);
                }}
                className="px-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                <option value="clean">
                  Standard NSE Equities ({dirData?.counts.standardEquities.toLocaleString('en-IN') ?? '—'})
                </option>
                <option value="all">
                  All NSE Cash / SME / Debt ({dirData?.counts.totalCashInstruments.toLocaleString('en-IN') ?? '—'})
                </option>
                <option value="research">
                  With Local Research Candles ({dirData?.counts.researchUniverse ?? 24})
                </option>
              </select>
              <button
                onClick={handleSyncDirectory}
                disabled={dirSyncing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${dirSyncing ? 'animate-spin' : ''}`} />
                {dirSyncing ? 'Syncing NSE...' : 'Sync NSE Master'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setDirPage(1);
            }}
            placeholder={
              mode === 'scanner' && scannerTab === 'directory'
                ? 'Search ANY NSE share (e.g., RELIANCE, SUZLON, HAL, IREDA, ZOMATO, MRF)...'
                : 'Filter NSE symbol or company...'
            }
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
          />
        </div>

        {(mode !== 'scanner' || scannerTab === 'research') && mode === 'scanner' && (
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
          >
            {sectors.map((sec) => (
              <option key={sec} value={sec}>
                Sector: {sec}
              </option>
            ))}
          </select>
        )}

        {(mode !== 'scanner' || scannerTab === 'research') && (
          <>
            <select
              value={regimeFilter}
              onChange={(e) => setRegimeFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              <option value="ALL">Regime: ALL</option>
              <option value="STRONG_TREND_BULL">Strong Trend Bull</option>
              <option value="STRONG_TREND_BEAR">Strong Trend Bear</option>
              <option value="SIDEWAYS_RANGE">Sideways Range</option>
              <option value="HIGH_VOL_BREAKOUT">High Vol Breakout</option>
              <option value="UNCERTAIN_CHOP">Uncertain Chop</option>
            </select>

            <select
              value={signalFilter}
              onChange={(e) => setSignalFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              <option value="ALL">Signal: ALL</option>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
              <option value="HOLD">HOLD</option>
              <option value="NO_TRADE">NO TRADE</option>
            </select>
          </>
        )}

        {mode === 'scanner' && scannerTab === 'research' && (
          <>
            <select
              value={minRvol}
              onChange={(e) => setMinRvol(Number(e.target.value))}
              className="px-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              <option value={0}>Min RVol: Any</option>
              <option value={1.2}>RVol ≥ 1.2x</option>
              <option value={1.5}>RVol ≥ 1.5x</option>
              <option value={2.0}>RVol ≥ 2.0x</option>
            </select>
            <button
              onClick={() => setWatchlistOnly((w) => !w)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                watchlistOnly
                  ? 'bg-sky-600 border-sky-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              Watchlist Only
            </button>
          </>
        )}
      </div>

      {/* Gemini Explanation Drawer when active */}
      {aiSummarySymbol && (
        <div className="p-4 rounded-lg border border-sky-500/40 bg-sky-50/40 dark:bg-sky-950/20 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-sky-700 dark:text-sky-300">
              Gemini Research Explanation · {aiSummarySymbol}
            </span>
            <button
              onClick={() => setAiSummarySymbol(null)}
              className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
            >
              Close
            </button>
          </div>
          {aiLoading ? (
            <div className="text-xs text-slate-500">Generating grounded quantitative explanation...</div>
          ) : aiText ? (
            <div className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-line leading-relaxed">
              {aiText}
            </div>
          ) : (
            <div className="text-xs text-amber-600 dark:text-amber-400">{aiError}</div>
          )}
        </div>
      )}

      {mode === 'scanner' && scannerTab === 'directory' ? (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>
              {dirData
                ? `${dirData.sourceName} · Synced ${dirData.syncedAtIst} · Showing ${dirData.items.length} of ${dirData.totalMatches.toLocaleString('en-IN')} matching NSE instruments`
                : 'Loading full NSE Equity Master Directory...'}
            </span>
            {dirData && (
              <div className="flex items-center gap-2">
                <button
                  disabled={dirData.page <= 1 || dirLoading}
                  onClick={() => setDirPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Prev
                </button>
                <span className="font-mono tabular-nums">
                  Page {dirData.page} / {dirData.totalPages}
                </span>
                <button
                  disabled={dirData.page >= dirData.totalPages || dirLoading}
                  onClick={() => setDirPage((p) => p + 1)}
                  className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Next
                </button>
              </div>
            )}
          </div>

          {dirError && (
            <div className="px-4 py-3 text-xs text-rose-500 border-b border-slate-200 dark:border-slate-800">
              {dirError}
            </div>
          )}
          {dirData?.syncWarning && (
            <div className="px-4 py-2 text-xs text-amber-600 dark:text-amber-400 border-b border-slate-200 dark:border-slate-800">
              {dirData.syncWarning}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-3 font-medium">Watch</th>
                  <th className="py-2.5 px-3 font-medium">NSE Symbol</th>
                  <th className="py-2.5 px-3 font-medium">Company Name</th>
                  <th className="py-2.5 px-3 font-medium">Exchange / Token</th>
                  <th className="py-2.5 px-3 font-medium text-right">Tick</th>
                  <th className="py-2.5 px-3 font-medium text-right">Lot</th>
                  <th className="py-2.5 px-3 font-medium text-right">NSE Price (LTP)</th>
                  <th className="py-2.5 px-3 font-medium text-right">Chg %</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {dirLoading && !dirData ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500">
                      Fetching official NSE Equity Master list & live prices...
                    </td>
                  </tr>
                ) : dirData && dirData.items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500">
                      No NSE instruments matched &ldquo;{search}&rdquo;.
                    </td>
                  </tr>
                ) : (
                  (dirData?.items || []).map((item) => {
                    const q = dirQuotes[item.symbol];
                    const ltp = q?.ltp ?? item.ltp;
                    const chgPct = q?.changePct ?? item.changePct;
                    return (
                      <tr key={item.symbol} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-3">
                          <button
                            onClick={async () => {
                              await onToggleWatchlist(item.symbol, Boolean(item.inWatchlist));
                              loadDirectory(search, dirScope, dirPage);
                            }}
                            aria-label={`Toggle watchlist for ${item.symbol}`}
                            className="p-1 text-slate-400 hover:text-amber-500"
                          >
                            <Star
                              className={`w-3.5 h-3.5 ${
                                item.inWatchlist ? 'fill-amber-400 text-amber-400' : ''
                              }`}
                            />
                          </button>
                        </td>
                        <td className="py-2 px-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {item.symbol}
                        </td>
                        <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                          {item.name}
                          {item.sector && (
                            <span className="ml-2 text-[11px] text-slate-400">· {item.sector}</span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-500">
                          {item.exchange}:{item.segment} {item.instrumentToken ? `(${item.instrumentToken})` : ''}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          ₹{item.tickSize.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{item.lotSize}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {typeof ltp === 'number' ? (
                            `₹${ltp.toFixed(2)}`
                          ) : (
                            <span className="text-[11px] font-normal text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {typeof chgPct === 'number' ? (
                            <span className={chgPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                              {formatPct(chgPct)}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2 px-4 text-right space-x-1.5 whitespace-nowrap">
                          {item.isStandardEquity && typeof ltp !== 'number' && (
                            <button
                              onClick={() => handleFetchQuote(item.symbol)}
                              disabled={quoteLoadingSym === item.symbol}
                              className="px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                            >
                              {quoteLoadingSym === item.symbol ? '...' : 'Retry Price'}
                            </button>
                          )}
                          <button
                            onClick={() => onSelectChartSymbol(item.symbol)}
                            className="px-2.5 py-1 text-[11px] font-medium rounded bg-sky-600 hover:bg-sky-500 text-white"
                          >
                            Open Chart
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : mode === 'scanner' ? (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Showing {filteredScanner.length} NSE Equities · Click column header to sort</span>
            <div className="flex items-center gap-3">
              <span>Sort:</span>
              {(['relVolume', 'aiProbUp', 'changePct', 'rsi14'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setSortBy(k)}
                  className={`font-medium ${sortBy === k ? 'text-sky-500 underline' : 'hover:text-slate-900 dark:hover:text-white'}`}
                >
                  {k === 'relVolume' ? 'RVol' : k === 'aiProbUp' ? 'AI P(Up)' : k === 'changePct' ? 'Chg%' : 'RSI'}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-3 font-medium">Watch</th>
                  <th className="py-2.5 px-3 font-medium">Symbol</th>
                  <th className="py-2.5 px-3 font-medium text-right">LTP</th>
                  <th className="py-2.5 px-3 font-medium text-right">Chg %</th>
                  <th className="py-2.5 px-3 font-medium text-right">RVol</th>
                  <th className="py-2.5 px-3 font-medium text-right">RSI(14)</th>
                  <th className="py-2.5 px-3 font-medium text-right">VWAP Dev</th>
                  <th className="py-2.5 px-3 font-medium">Regime</th>
                  <th className="py-2.5 px-3 font-medium text-right">AI P(Up)</th>
                  <th className="py-2.5 px-3 font-medium">Signal</th>
                  <th className="py-2.5 px-4 font-medium text-right">Research</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {filteredScanner.map((r) => (
                  <tr key={r.symbol} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3">
                      <button
                        onClick={() => onToggleWatchlist(r.symbol, r.inWatchlist)}
                        aria-label={`Toggle watchlist for ${r.symbol}`}
                        className="p-1 text-slate-400 hover:text-amber-500"
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${r.inWatchlist ? 'fill-amber-400 text-amber-400' : ''}`}
                        />
                      </button>
                    </td>
                    <td className="py-2 px-3">
                      <button
                        onClick={() => onSelectChartSymbol(r.symbol)}
                        className="font-semibold text-slate-900 dark:text-slate-100 hover:text-sky-500"
                      >
                        {r.symbol}
                      </button>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{r.sector}</div>
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">₹{r.ltp.toFixed(2)}</td>
                    <td
                      className={`py-2 px-3 text-right font-mono tabular-nums ${
                        r.changePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatPct(r.changePct)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{r.relVolume.toFixed(2)}x</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{r.rsi14.toFixed(1)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{formatPct(r.vwapDistPct)}</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                      {r.regime.replace(/_/g, ' ')}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums font-medium">
                      {r.aiProbUp.toFixed(1)}%
                    </td>
                    <td className="py-2 px-3 font-mono font-semibold">
                      <span
                        className={
                          r.signal === 'BUY'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : r.signal === 'SELL'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }
                      >
                        {r.signal}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right">
                      <button
                        onClick={() => handleStockSummary(r.symbol)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                      >
                        <Sparkles className="w-3 h-3" />
                        360° AI
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* AI Signals Feed */
        <div className="space-y-3">
          {filteredSignals.map((sig) => (
            <div
              key={sig.id}
              className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-col lg:flex-row lg:items-center justify-between gap-4"
            >
              <div className="space-y-1.5 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    onClick={() => onSelectChartSymbol(sig.symbol)}
                    className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:text-sky-500"
                  >
                    {sig.symbol}
                  </button>
                  <span className="text-slate-500 dark:text-slate-400">{sig.companyName}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`font-mono font-bold ${
                      sig.direction === 'BUY'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : sig.direction === 'SELL'
                        ? 'text-rose-600 dark:text-rose-400'
                        : sig.direction === 'HOLD'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-500'
                    }`}
                  >
                    {sig.direction}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-600 dark:text-slate-300">{sig.strategyName}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-slate-500">{sig.regime}</span>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {sig.technicalJustification}
                  {sig.rejectionReason ? ` — ${sig.rejectionReason}` : ''}
                </p>

                <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 pt-1">
                  <span>Entry: ₹{sig.entryPrice.toFixed(2)} (Zone ₹{sig.entryZone[0]}–{sig.entryZone[1]})</span>
                  <span>SL: ₹{sig.stopLoss.toFixed(2)}</span>
                  <span>T1: ₹{sig.target1.toFixed(2)}</span>
                  <span>T2: ₹{sig.target2.toFixed(2)}</span>
                  <span>R/R: {sig.riskRewardRatio}:1</span>
                  <span>
                    Calibrated Prob: {(sig.estimatedProbability * 100).toFixed(1)}% (95% CI: {sig.confidenceLow}%–{sig.confidenceHigh}%)
                  </span>
                  {sig.probUpPct !== undefined && sig.probDownPct !== undefined && (
                    <span>P(Up)/P(Dn): {sig.probUpPct}% / {sig.probDownPct}%</span>
                  )}
                  <span>Horizon: {sig.predictionHorizonBars ?? 10} bars</span>
                  <span>RVol: {sig.volumeData.relVolume}x</span>
                  <span>Data IST: {sig.marketDataTimestampIst ?? sig.timestampIst}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleExplainSignal(sig)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Explain AI
                </button>
                {(sig.direction === 'BUY' || sig.direction === 'SELL') && (
                  <button
                    onClick={() => onExecuteSignal(sig)}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-sky-600 hover:bg-sky-500 text-white whitespace-nowrap shrink-0"
                  >
                    Paper Trade
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

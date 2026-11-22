import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { TradingChart } from '../components/TradingChart';
import { TradingViewWidget } from '../components/TradingViewWidget';
import { api } from '../lib/api';
import { Candle, IndicatorPoint, StockMetadata, Timeframe, TradingSignal } from '../types/trading';

interface ChartsViewProps {
  selectedSymbol: string;
  onChangeSymbol: (sym: string) => void;
  universe: StockMetadata[];
  signals: TradingSignal[];
  darkMode: boolean;
  onExecuteSignal: (signal: TradingSignal) => Promise<void>;
}

export function ChartsView({
  selectedSymbol,
  onChangeSymbol,
  universe,
  signals,
  darkMode,
  onExecuteSignal,
}: ChartsViewProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [feedMode, setFeedMode] = useState<'auto' | 'public' | 'research'>('public');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [customSymbolInput, setCustomSymbolInput] = useState('');
  const [symbolName, setSymbolName] = useState(selectedSymbol);
  const [dataModeLabel, setDataModeLabel] = useState<string>('PUBLIC_DELAYED_NSE_FEED');
  const [publicChangePct, setPublicChangePct] = useState<number | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [indicators, setIndicators] = useState<IndicatorPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showEma, setShowEma] = useState(true);
  const [showVwap, setShowVwap] = useState(true);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showSupertrend, setShowSupertrend] = useState(true);
  const [chartEngine, setChartEngine] = useState<'quant' | 'tradingview'>('quant');

  const fetchChartData = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      if (!silent) setError(null);

      try {
        const res = await api.getCandles(selectedSymbol, timeframe, feedMode);
        setCandles(res.candles);
        setIndicators(res.indicators);
        setSymbolName(res.name || selectedSymbol);
        setDataModeLabel(res.dataMode);
        setPublicChangePct(res.quote ? res.quote.changePct : null);
        setError(null);
      } catch (err) {
        if (!silent) {
          setCandles([]);
          setIndicators([]);
          setPublicChangePct(null);
        }
        setError(err instanceof Error ? err.message : 'Failed to load OHLCV chart data.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedSymbol, timeframe, feedMode]
  );

  useEffect(() => {
    fetchChartData(false);
  }, [fetchChartData]);

  useEffect(() => {
    if (!autoRefresh || feedMode === 'research') return;
    const iv = setInterval(() => {
      fetchChartData(true);
    }, 15000);
    return () => clearInterval(iv);
  }, [autoRefresh, feedMode, fetchChartData]);

  const latestBar = candles[candles.length - 1];
  const latestInd = indicators[indicators.length - 1];
  const activeSignal = signals.find((s) => s.symbol === selectedSymbol) ?? null;
  const inPresetUniverse = universe.some((u) => u.symbol === selectedSymbol);

  const handleLoadCustomSymbol = (e: React.FormEvent) => {
    e.preventDefault();
    let cleaned = customSymbolInput.trim().toUpperCase();
    if (!cleaned) return;
    if (cleaned === 'RELIENCE' || cleaned === 'RELIENCE.NS') {
      cleaned = 'RELIANCE';
    }
    onChangeSymbol(cleaned);
    setCustomSymbolInput('');
  };

  return (
    <div className="space-y-4">
      {/* Chart Controls Toolbar */}
      <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={inPresetUniverse ? selectedSymbol : '__CUSTOM__'}
            onChange={(e) => {
              if (e.target.value !== '__CUSTOM__') onChangeSymbol(e.target.value);
            }}
            className="px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
          >
            {!inPresetUniverse && (
              <option value="__CUSTOM__">
                {selectedSymbol} — {symbolName} (NSE Public)
              </option>
            )}
            {universe.map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {s.symbol} — {s.name}
              </option>
            ))}
          </select>

          <form onSubmit={handleLoadCustomSymbol} className="flex items-center gap-1.5">
            <input
              type="text"
              value={customSymbolInput}
              onChange={(e) => setCustomSymbolInput(e.target.value)}
              placeholder="Any NSE symbol (e.g. SUZLON, HAL)"
              className="w-52 px-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono uppercase focus:outline-none focus:border-sky-500"
            />
            <button
              type="submit"
              className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-sky-600 hover:bg-sky-500 text-white"
            >
              Load
            </button>
          </form>

          <select
            value={feedMode}
            onChange={(e) => setFeedMode(e.target.value as 'auto' | 'public' | 'research')}
            className="px-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
          >
            <option value="public">Feed: Public NSE (.NS Live/Delayed)</option>
            <option value="auto">Feed: Auto (24 Research / 3,100+ Public)</option>
            <option value="research">Feed: Local Research Replay (24)</option>
          </select>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-md">
            {(['1m', '5m', '15m'] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-md">
            <button
              onClick={() => setChartEngine('quant')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                chartEngine === 'quant'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Quant Chart
            </button>
            <button
              onClick={() => setChartEngine('tradingview')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                chartEngine === 'tradingview'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
              title="Official TradingView Real-Time Streaming Chart"
            >
              TradingView Live
            </button>
          </div>

          <button
            onClick={() => fetchChartData(true)}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-sky-600 dark:text-sky-400 font-medium">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto-Poll (15s)</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showVwap} onChange={(e) => setShowVwap(e.target.checked)} />
            <span>VWAP</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showEma} onChange={(e) => setShowEma(e.target.checked)} />
            <span>EMA 9/21</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showSupertrend} onChange={(e) => setShowSupertrend(e.target.checked)} />
            <span>Supertrend</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showBollinger} onChange={(e) => setShowBollinger(e.target.checked)} />
            <span>Bollinger (20,2)</span>
          </label>
        </div>
      </div>

      {/* Latest Indicator Telemetry Strip */}
      {latestBar && latestInd && (
        <div className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-4 text-xs font-mono tabular-nums">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {selectedSymbol} · ₹{latestBar.close.toFixed(2)}
              {publicChangePct !== null && (
                <span className={`ml-1.5 ${publicChangePct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  ({publicChangePct >= 0 ? '+' : ''}
                  {publicChangePct.toFixed(2)}%)
                </span>
              )}
            </span>
            <span className="text-sky-600 dark:text-sky-400">[{dataModeLabel}]</span>
            <span className="text-slate-500">VWAP: ₹{latestInd.vwap.toFixed(2)}</span>
            <span className="text-slate-500">RSI(14): {latestInd.rsi14.toFixed(1)}</span>
            <span className="text-slate-500">ADX(14): {latestInd.adx14.toFixed(1)}</span>
            <span className="text-slate-500">ATR(14): ₹{latestInd.atr14.toFixed(2)}</span>
            <span className="text-slate-500">ORB15: {latestInd.orbLow}–{latestInd.orbHigh}</span>
          </div>
          <span className="text-slate-400">{latestBar.istLabel}</span>
        </div>
      )}

      {/* Chart Display: Quant Chart or TradingView Live Real-Time Widget */}
      {chartEngine === 'tradingview' ? (
        <TradingViewWidget
          symbol={selectedSymbol}
          darkMode={darkMode}
          interval={timeframe === '1m' ? '1' : timeframe === '15m' ? '15' : '5'}
        />
      ) : error ? (
        <div className="p-6 rounded-lg border border-rose-500/40 bg-rose-500/5 text-xs text-rose-600 dark:text-rose-400">
          Chart Data Error ({selectedSymbol}): {error}
        </div>
      ) : loading ? (
        <div className="h-[440px] rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/50 animate-pulse" />
      ) : (
        <TradingChart
          candles={candles}
          indicators={indicators}
          darkMode={darkMode}
          showEma={showEma}
          showVwap={showVwap}
          showBollinger={showBollinger}
          showSupertrend={showSupertrend}
          activeSignal={activeSignal}
        />
      )}

      {/* Active Signal Context Card below Chart */}
      {activeSignal && (
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 text-xs">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              Current Signal ({activeSignal.symbol}): {activeSignal.direction} · {activeSignal.strategyName}
            </div>
            <div className="text-slate-500 dark:text-slate-400">
              {activeSignal.technicalJustification}
              {activeSignal.rejectionReason ? ` · ${activeSignal.rejectionReason}` : ''}
            </div>
          </div>
          {(activeSignal.direction === 'BUY' || activeSignal.direction === 'SELL') && (
            <button
              onClick={() => onExecuteSignal(activeSignal)}
              className="px-4 py-2 text-xs font-medium rounded-md bg-sky-600 hover:bg-sky-500 text-white whitespace-nowrap shrink-0"
            >
              Send to Paper Trade (Risk-Checked)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Briefcase,
  CandlestickChart,
  Database,
  FlaskConical,
  LayoutDashboard,
  Link2,
  Menu,
  Moon,
  Radar,
  Server,
  Settings,
  ShieldCheck,
  Sliders,
  Sun,
  TrendingUp,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';
import {
  BacktestResult,
  MarketOverviewResponse,
  PaperAccountState,
  RiskConfig,
  ScannerRow,
  StockMetadata,
  StrategyConfig,
  TradingSignal,
} from './types/trading';
import { AiCopilotView } from './views/AiCopilotView';
import { ChartsView } from './views/ChartsView';
import { MarketAnalysisView } from './views/MarketAnalysisView';
import { OverviewView } from './views/OverviewView';
import { PaperPortfolioJournalView } from './views/PaperPortfolioJournalView';
import { RagMcpView } from './views/RagMcpView';
import { RiskMlBrokersSettingsView } from './views/RiskMlBrokersSettingsView';
import { ScannerSignalsView } from './views/ScannerSignalsView';
import { StrategyBacktestView } from './views/StrategyBacktestView';

type PageId =
  | 'overview'
  | 'copilot'
  | 'market'
  | 'scanner'
  | 'signals'
  | 'charts'
  | 'strategies'
  | 'backtest'
  | 'paper'
  | 'portfolio'
  | 'journal'
  | 'risk'
  | 'reports'
  | 'knowledge'
  | 'mcp'
  | 'brokers'
  | 'settings';

const NAV_ITEMS: { id: PageId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'copilot', label: 'AI Copilot (RAG+MCP)', icon: Bot },
  { id: 'market', label: 'Market Analysis', icon: TrendingUp },
  { id: 'scanner', label: 'AI Stock Scanner', icon: Radar },
  { id: 'signals', label: 'AI Signals', icon: Activity },
  { id: 'charts', label: 'Charts', icon: CandlestickChart },
  { id: 'strategies', label: 'Strategy Lab', icon: Sliders },
  { id: 'backtest', label: 'Backtesting', icon: FlaskConical },
  { id: 'paper', label: 'Paper Trading', icon: BarChart3 },
  { id: 'portfolio', label: 'Portfolio', icon: Briefcase },
  { id: 'journal', label: 'Trade Journal', icon: BookOpen },
  { id: 'risk', label: 'Risk Dashboard', icon: ShieldCheck },
  { id: 'reports', label: 'Reports & ML Lab', icon: BarChart3 },
  { id: 'knowledge', label: 'AI Knowledge Base', icon: Database },
  { id: 'mcp', label: 'MCP Integrations', icon: Server },
  { id: 'brokers', label: 'Broker Connections', icon: Link2 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [activePage, setActivePage] = useState<PageId>('overview');
  const [darkMode, setDarkMode] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);

  const [overview, setOverview] = useState<MarketOverviewResponse | null>(null);
  const [universe, setUniverse] = useState<StockMetadata[]>([]);
  const [scannerRows, setScannerRows] = useState<ScannerRow[]>([]);
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [strategies, setStrategies] = useState<StrategyConfig[]>([]);
  const [backtestHistory, setBacktestHistory] = useState<BacktestResult[]>([]);
  const [account, setAccount] = useState<PaperAccountState | null>(null);
  const [riskConfig, setRiskConfig] = useState<RiskConfig | null>(null);

  const [selectedSymbol, setSelectedSymbol] = useState('RELIANCE');
  const [selectedBtStrategy, setSelectedBtStrategy] = useState('regime-adaptive-ensemble');
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 5000);
  };

  const refreshAll = useCallback(async () => {
    try {
      const [ovRes, scanRes, sigRes, stratRes, paperRes, btRes] = await Promise.all([
        api.getMarketOverview('5m'),
        api.getScanner({ timeframe: '5m' }),
        api.getSignals('5m'),
        api.getStrategies(),
        api.getPaperState(),
        api.getBacktestHistory(),
      ]);
      setOverview(ovRes.overview);
      setUniverse(ovRes.universe);
      setScannerRows(scanRes.rows);
      setSignals(sigRes.signals);
      setStrategies(stratRes.strategies);
      setAccount(paperRes.account);
      setRiskConfig(paperRes.riskConfig);
      setBacktestHistory(btRes.history);
    } catch (err) {
      showToast(false, err instanceof Error ? err.message : 'Failed to load terminal data.');
    }
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const handleToggleWatchlist = async (symbol: string, current: boolean) => {
    try {
      await api.toggleWatchlist(symbol, current);
      await refreshAll();
    } catch (err) {
      showToast(false, err instanceof Error ? err.message : 'Failed to update watchlist.');
    }
  };

  const handleExecuteSignal = async (signal: TradingSignal) => {
    if (signal.direction !== 'BUY' && signal.direction !== 'SELL') return;
    try {
      const res = await api.submitPaperOrder({
        symbol: signal.symbol,
        side: signal.direction,
        orderType: 'MARKET',
        stopLoss: signal.stopLoss,
        target: signal.target1,
        strategyName: signal.strategyName,
        regime: signal.regime,
      });
      showToast(
        true,
        `Paper ${signal.direction} ${res.decision.approvedQty} ${signal.symbol} filled (Risk Gatekeeper approved).`
      );
      await refreshAll();
    } catch (err) {
      showToast(
        false,
        `Risk Rejected (${signal.symbol}): ${err instanceof Error ? err.message : 'Order blocked.'}`
      );
      await refreshAll();
    }
  };

  const handleStepSim = async () => {
    try {
      await api.stepPaperSim();
      await refreshAll();
      showToast(true, 'Advanced simulated market session by one 5m bar.');
    } catch (err) {
      showToast(false, err instanceof Error ? err.message : 'Failed to step simulation bar.');
    }
  };

  const unreadAlerts = account?.alerts.filter((a) => !a.read).length ?? 0;
  const activeNavLabel = NAV_ITEMS.find((n) => n.id === activePage)?.label ?? 'Overview';

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      {/* Sidebar Navigation (240px desktop) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F1520] flex flex-col transition-transform duration-200 lg:translate-x-0 lg:static ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-14 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
          <button
            onClick={() => setActivePage('overview')}
            className="text-base font-bold font-display tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            ArthQuant
          </button>
          <button
            onClick={() => setMobileNavOpen(false)}
            className="lg:hidden p-1 text-slate-500"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActivePage(item.id);
                  setMobileNavOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
          <div className="font-medium text-slate-700 dark:text-slate-300">NSE Equity Intraday</div>
          <div>Paper Mode · Live Locked</div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract */}
        <header className="h-14 px-4 lg:px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F1520] flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-1.5 rounded border border-slate-200 dark:border-slate-700"
              aria-label="Open navigation"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-xs truncate">
              <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">Terminal</span>
              <span className="text-slate-400">/</span>
              <h1 className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                {activeNavLabel}
              </h1>
              {riskConfig?.killSwitchActive && (
                <span className="ml-2 text-xs font-mono font-bold text-rose-500 whitespace-nowrap">
                  · KILL SWITCH HALTED
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={handleStepSim}
              className="hidden sm:inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              Step 5m Bar
            </button>

            <div className="relative">
              <button
                onClick={async () => {
                  const next = !alertsOpen;
                  setAlertsOpen(next);
                  if (next && unreadAlerts > 0) {
                    await api.markAlertsRead();
                    await refreshAll();
                  }
                }}
                aria-label="Alerts and Notifications"
                className="p-2 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 relative"
              >
                <Bell className="w-4 h-4" />
                {unreadAlerts > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white text-[10px] font-mono flex items-center justify-center">
                    {unreadAlerts}
                  </span>
                )}
              </button>

              {alertsOpen && account && (
                <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-xl p-3 space-y-2 z-50">
                  <div className="flex items-center justify-between text-xs font-semibold pb-1.5 border-b border-slate-200 dark:border-slate-800">
                    <span>System & Risk Alerts</span>
                    <button onClick={() => setAlertsOpen(false)} className="text-slate-400 hover:text-slate-200">
                      Close
                    </button>
                  </div>
                  {account.alerts.slice(0, 10).map((a) => (
                    <div key={a.id} className="text-xs py-1.5 border-b border-slate-100 dark:border-slate-800/60 last:border-0">
                      <div className="flex items-center justify-between">
                        <span className={`font-semibold ${a.severity === 'CRITICAL' ? 'text-rose-500' : a.severity === 'WARNING' ? 'text-amber-500' : 'text-sky-500'}`}>
                          {a.title}
                        </span>
                        <span className="font-mono text-[10px] text-slate-400">{a.timestampIst.slice(11, 16)}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">{a.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => setDarkMode((d) => !d)}
              aria-label="Toggle color theme"
              className="p-2 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Action Feedback Banner */}
        {toast && (
          <div
            className={`mx-4 lg:mx-6 mt-4 px-4 py-2.5 rounded-md border text-xs flex items-center justify-between ${
              toast.ok
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
            }`}
          >
            <span>{toast.text}</span>
            <button onClick={() => setToast(null)} className="ml-4 underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Active Page Viewport */}
        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">
          {activePage === 'overview' && (
            <OverviewView
              overview={overview}
              signals={signals}
              account={account}
              strategies={strategies}
              onNavigate={(p) => setActivePage(p as PageId)}
              onSelectChartSymbol={setSelectedSymbol}
              onExecuteSignal={handleExecuteSignal}
            />
          )}

          {activePage === 'market' && (
            <MarketAnalysisView
              overview={overview}
              onSelectSymbol={(sym) => {
                setSelectedSymbol(sym);
                setActivePage('charts');
              }}
            />
          )}

          {(activePage === 'scanner' || activePage === 'signals') && (
            <ScannerSignalsView
              mode={activePage}
              scannerRows={scannerRows}
              signals={signals}
              onToggleWatchlist={handleToggleWatchlist}
              onSelectChartSymbol={(sym) => {
                setSelectedSymbol(sym);
                setActivePage('charts');
              }}
              onExecuteSignal={handleExecuteSignal}
            />
          )}

          {activePage === 'charts' && (
            <ChartsView
              selectedSymbol={selectedSymbol}
              onChangeSymbol={setSelectedSymbol}
              universe={universe}
              signals={signals}
              darkMode={darkMode}
              onExecuteSignal={handleExecuteSignal}
            />
          )}

          {(activePage === 'strategies' || activePage === 'backtest') && (
            <StrategyBacktestView
              mode={activePage}
              strategies={strategies}
              universe={universe}
              backtestHistory={backtestHistory}
              onRefreshStrategies={refreshAll}
              onRefreshBacktests={refreshAll}
              selectedBacktestStrategyId={selectedBtStrategy}
              onOpenBacktestWithStrategy={(id) => {
                setSelectedBtStrategy(id);
                setActivePage('backtest');
              }}
            />
          )}

          {(activePage === 'paper' || activePage === 'portfolio' || activePage === 'journal') && (
            <PaperPortfolioJournalView
              mode={activePage}
              account={account}
              riskConfig={riskConfig}
              universe={universe}
              scannerRows={scannerRows}
              onRefreshAll={refreshAll}
            />
          )}

          {activePage === 'copilot' && (
            <AiCopilotView
              universe={universe}
              onNavigate={(p) => setActivePage(p as PageId)}
            />
          )}

          {(activePage === 'knowledge' || activePage === 'mcp') && (
            <RagMcpView mode={activePage} />
          )}

          {(activePage === 'risk' ||
            activePage === 'reports' ||
            activePage === 'brokers' ||
            activePage === 'settings') && (
            <RiskMlBrokersSettingsView
              mode={activePage}
              universe={universe}
              darkMode={darkMode}
              onToggleDarkMode={() => setDarkMode((d) => !d)}
              onRefreshAll={refreshAll}
            />
          )}
        </main>
      </div>
    </div>
  );
}

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DataHealthPanel } from '../components/DataHealthPanel';
import { formatPct } from '../lib/api';
import { MarketOverviewResponse, ScannerRow } from '../types/trading';

interface MarketAnalysisViewProps {
  overview: MarketOverviewResponse | null;
  onSelectSymbol: (symbol: string) => void;
}

export function MarketAnalysisView({ overview, onSelectSymbol }: MarketAnalysisViewProps) {
  if (!overview) {
    return <div className="p-8 text-sm text-slate-500">Loading Indian market structure...</div>;
  }

  const renderMoverTable = (title: string, rows: ScannerRow[]) => (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      </div>
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
            <th className="py-2 px-4 font-medium">Symbol</th>
            <th className="py-2 px-3 font-medium text-right">LTP</th>
            <th className="py-2 px-3 font-medium text-right">Chg %</th>
            <th className="py-2 px-4 font-medium text-right">RVol</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
          {rows.map((r) => (
            <tr key={r.symbol} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
              <td className="py-2 px-4">
                <button
                  onClick={() => onSelectSymbol(r.symbol)}
                  className="font-semibold text-slate-900 dark:text-slate-100 hover:text-sky-500"
                >
                  {r.symbol}
                </button>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{r.sector}</div>
              </td>
              <td className="py-2 px-3 text-right font-mono tabular-nums">₹{r.ltp.toFixed(2)}</td>
              <td
                className={`py-2 px-3 text-right font-mono tabular-nums font-medium ${
                  r.changePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {formatPct(r.changePct)}
              </td>
              <td className="py-2 px-4 text-right font-mono tabular-nums">{r.relVolume.toFixed(2)}x</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <DataHealthPanel health={overview.dataHealth} />

      {/* Sector Rotation Chart & Institutional Context */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                NSE Sector Performance Rotation
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Equal-weighted intraday return across tracked sector leaders · {overview.dataMode}
              </p>
            </div>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={overview.sectors} layout="vertical" margin={{ left: 24, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94A3B8' }} unit="%" />
                <YAxis type="category" dataKey="sector" width={160} tick={{ fontSize: 11, fill: '#94A3B8' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderColor: '#1E293B',
                    fontSize: '12px',
                    color: '#F8FAFC',
                  }}
                />
                <Bar dataKey="changePct" radius={[0, 3, 3, 0]}>
                  {overview.sectors.map((entry) => (
                    <Cell
                      key={entry.sector}
                      fill={entry.changePct >= 0 ? '#16A34A' : '#DC2626'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Institutional & Breadth Panel */}
        <div className="lg:col-span-4 space-y-4">
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Institutional FII / DII Context
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-slate-500 dark:text-slate-400">FII Cash Net</div>
                <div className="font-mono tabular-nums text-sm font-semibold text-amber-600 dark:text-amber-400 mt-0.5">
                  {overview.fiiDiiContext.fiiNetCr !== null
                    ? `₹${overview.fiiDiiContext.fiiNetCr.toLocaleString('en-IN')} Cr`
                    : 'UNAVAILABLE'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">DII Cash Net</div>
                <div className="font-mono tabular-nums text-sm font-semibold text-amber-600 dark:text-amber-400 mt-0.5">
                  {overview.fiiDiiContext.diiNetCr !== null
                    ? `₹${overview.fiiDiiContext.diiNetCr.toLocaleString('en-IN')} Cr`
                    : 'UNAVAILABLE'}
                </div>
              </div>
            </div>
            <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
              Status: {overview.fiiDiiContext.sourceStatus}. {overview.fiiDiiContext.note}
            </p>
          </div>

          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Breadth Summary
            </h3>
            <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
              <div className="flex justify-between">
                <span>Advance / Decline Ratio</span>
                <span className="font-mono tabular-nums font-medium">{overview.breadth.adRatio}</span>
              </div>
              <div className="flex justify-between">
                <span>Overall Benchmark Regime</span>
                <span className="font-mono font-medium">{overview.overallRegime}</span>
              </div>
              <div className="flex justify-between">
                <span>NIFTY Realized Vol (Ann.)</span>
                <span className="font-mono tabular-nums font-medium">{overview.breadth.realizedVolAnnualizedPct}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Movers & Unusual Volume */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {renderMoverTable('Top Intraday Gainers', overview.topGainers)}
        {renderMoverTable('Top Intraday Losers', overview.topLosers)}
        {renderMoverTable('Unusual Relative Volume', overview.unusualVolume)}
      </div>
    </div>
  );
}

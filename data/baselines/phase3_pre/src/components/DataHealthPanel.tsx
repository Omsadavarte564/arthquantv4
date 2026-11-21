import { Activity, AlertTriangle, CheckCircle2, Radio } from 'lucide-react';
import { DataHealthStatus } from '../types/trading';

interface DataHealthPanelProps {
  health: DataHealthStatus;
  compact?: boolean;
}

export function DataHealthPanel({ health, compact = false }: DataHealthPanelProps) {
  const isLive = health.classification === 'LIVE_REALTIME';
  const hasAlert = health.staleFeedBlocked || !health.validationPassed || health.classification === 'UNAVAILABLE';

  return (
    <div
      className={`rounded-lg border ${
        hasAlert
          ? 'border-rose-500/40 bg-rose-500/5'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]'
      } p-4 space-y-3`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {hasAlert ? (
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
          ) : isLive ? (
            <Radio className="w-4 h-4 text-emerald-500 shrink-0" />
          ) : (
            <Activity className="w-4 h-4 text-amber-500 shrink-0" />
          )}
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Market Data Feed Health
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
          <span
            className={`font-semibold ${
              isLive
                ? 'text-emerald-600 dark:text-emerald-400'
                : health.classification === 'UNAVAILABLE'
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {health.classification}
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-slate-600 dark:text-slate-300">{health.marketStatus}</span>
          <span aria-hidden="true">·</span>
          <span className="text-slate-500 dark:text-slate-400">{health.liveVerificationStatus}</span>
        </div>
      </div>

      <div className={`grid ${compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'} gap-3 text-xs`}>
        <div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Provider</div>
          <div className="font-medium text-slate-900 dark:text-slate-100 mt-0.5 truncate" title={health.providerName}>
            {health.providerName}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Connection Status</div>
          <div className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">{health.connectionStatus}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Latest Source Bar</div>
          <div className="font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
            {health.latestSourceTimestampIst}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Validation / Missing</div>
          <div className="font-mono tabular-nums mt-0.5 inline-flex items-center gap-1">
            {health.validationPassed ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
            )}
            <span>
              {health.validationPassed ? 'PASSED' : 'FAILED'} · {health.missingDataCount} gaps
            </span>
          </div>
        </div>

        {!compact && (
          <>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Last Update / Heartbeat</div>
              <div className="font-mono tabular-nums text-slate-700 dark:text-slate-300 mt-0.5">
                {health.lastUpdateIst}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Feed Latency</div>
              <div className="font-mono tabular-nums text-slate-700 dark:text-slate-300 mt-0.5">
                {health.feedLatencyMs !== null ? `${health.feedLatencyMs} ms` : 'N/A (Offline Replay)'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Reconnections</div>
              <div className="font-mono tabular-nums text-slate-700 dark:text-slate-300 mt-0.5">
                {health.reconnectionCount}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">NSE Session Status</div>
              <div className="text-slate-700 dark:text-slate-300 mt-0.5">{health.marketStatusReason}</div>
            </div>
          </>
        )}
      </div>

      {health.validationNotes.length > 0 && (
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/70 text-[11px] text-amber-600 dark:text-amber-400 space-y-0.5">
          {health.validationNotes.map((note, idx) => (
            <div key={idx}>{note}</div>
          ))}
        </div>
      )}
    </div>
  );
}

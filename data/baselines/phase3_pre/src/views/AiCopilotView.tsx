import {
  Bot,
  ChevronDown,
  ChevronUp,
  Cpu,
  Database,
  FileText,
  Send,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { CopilotQueryResponse, StockMetadata } from '../types/trading';

interface AiCopilotViewProps {
  universe: StockMetadata[];
  onNavigate: (page: string) => void;
}

interface CopilotExchange {
  id: string;
  query: string;
  askedAt: string;
  response: CopilotQueryResponse;
}

const EXAMPLE_PROMPTS = [
  {
    label: 'SEBI Algo & Static IP Rules',
    query: 'What are SEBI static IP and algo tagging rules for retail API trading?',
  },
  {
    label: 'RELIANCE 360° Research + Risk',
    query:
      'Analyze RELIANCE current trend, technical signal, corporate risk profile, and check our risk limits.',
  },
  {
    label: 'INFY Price & RSI (MCP Live/Delayed)',
    query: "What is INFY's current price, RSI, and market status today?",
  },
  {
    label: 'Best OOS Backtest Strategy',
    query: 'Which strategy performed best in recent out-of-sample backtests and what are our methodology rules?',
  },
  {
    label: 'Paper Portfolio & Kill Switch',
    query: 'Show my current paper portfolio balance, open positions, and risk limits.',
  },
];

const TAG_STYLE: Record<string, string> = {
  LIVE_OR_DELAYED_MARKET_DATA:
    'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  QUANT_ML_ENGINE: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  RETRIEVED_RAG_DOCUMENTS:
    'border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  PAPER_PORTFOLIO_DATA:
    'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  GENERAL_EXPLANATION:
    'border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-slate-300',
};

export function AiCopilotView({ universe, onNavigate }: AiCopilotViewProps) {
  const [query, setQuery] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CopilotExchange[]>([]);
  const [expandedCitations, setExpandedCitations] = useState<Record<string, boolean>>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  const submitQuery = async (promptText: string) => {
    const clean = promptText.trim();
    if (!clean || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.askCopilot(clean, selectedSymbol || undefined);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setHistory((prev) => [
        {
          id,
          query: clean,
          askedAt: new Date().toLocaleTimeString('en-IN', { hour12: false }),
          response,
        },
        ...prev,
      ]);
      setExpandedCitations((prev) => ({ ...prev, [id]: response.citations.length > 0 }));
      setQuery('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to query AI Copilot.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Architecture Banner */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-sky-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Gemini + RAG + MCP Quant Research Copilot
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Routes regulatory/document queries to cited RAG collections and live market, quant, backtest, and portfolio queries to live MCP tools. Live execution remains locked.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => onNavigate('knowledge')}
            className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            Manage Knowledge Base
          </button>
          <button
            onClick={() => onNavigate('mcp')}
            className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            MCP Diagnostics
          </button>
        </div>
      </div>

      {/* Prompt Input & Example Chips */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-3">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="sm:w-44 px-3 py-2 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
            aria-label="Optional NSE symbol context"
          >
            <option value="">Auto-detect Symbol</option>
            {universe.map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {s.symbol} — {s.sector}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitQuery(query);
            }}
            placeholder="Ask about SEBI circulars, NSE timings, RELIANCE RSI/signals, strategy OOS Sharpe, or paper portfolio..."
            className="flex-1 px-3 py-2 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          <button
            onClick={() => submitQuery(query)}
            disabled={loading || !query.trim()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            {loading ? 'Orchestrating...' : 'Ask Copilot'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map((ex) => (
            <button
              key={ex.label}
              onClick={() => {
                setQuery(ex.query);
                submitQuery(ex.query);
              }}
              disabled={loading}
              className="px-2.5 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 hover:border-sky-500/60 hover:bg-sky-500/5 text-slate-600 dark:text-slate-300 transition-colors"
            >
              {ex.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="px-3 py-2 rounded border border-rose-500/40 bg-rose-500/10 text-xs text-rose-600 dark:text-rose-400">
            {error}
          </div>
        )}
      </div>

      {/* Responses Feed */}
      {history.length === 0 ? (
        <div className="p-8 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-center space-y-2">
          <Sparkles className="w-6 h-6 text-sky-500 mx-auto" />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Grounded Institutional Q&A Ready
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
            Select an example above or type your own question. Every answer displays exact data-source transparency tags, MCP tool execution logs, and verifiable RAG document citations.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {history.map((item) => {
            const r = item.response;
            const citOpen = Boolean(expandedCitations[item.id]);
            const mcpOpen = Boolean(expandedTools[item.id]);

            return (
              <div
                key={item.id}
                className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden"
              >
                {/* Question Header */}
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0F1520] flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Q: {item.query}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500">
                    <span>Intent: {r.routing.intent}</span>
                    {r.routing.detectedSymbol && <span>· {r.routing.detectedSymbol}</span>}
                    <span>· {item.askedAt} IST</span>
                  </div>
                </div>

                {/* Data Source Transparency Tags */}
                <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800/70 flex flex-wrap gap-2">
                  {r.transparencyTags.map((tag, idx) => (
                    <span
                      key={`${tag.type}-${idx}`}
                      title={`${tag.source} (${tag.timestampIst})`}
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded border ${
                        TAG_STYLE[tag.type] || TAG_STYLE.GENERAL_EXPLANATION
                      }`}
                    >
                      {tag.type === 'RETRIEVED_RAG_DOCUMENTS' ? (
                        <Database className="w-3 h-3" />
                      ) : (
                        <Cpu className="w-3 h-3" />
                      )}
                      {tag.label}
                    </span>
                  ))}
                  {!r.available && r.error && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300">
                      <ShieldAlert className="w-3 h-3" />
                      Gemini fallback active — grounded tool/RAG facts shown directly
                    </span>
                  )}
                </div>

                {/* Answer Body */}
                <div className="p-4 text-xs leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                  {r.answer}
                </div>

                {/* Expandable Citations & MCP Tool Trace */}
                <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0D131E] flex flex-wrap items-center gap-4 text-xs">
                  <button
                    onClick={() =>
                      setExpandedCitations((prev) => ({ ...prev, [item.id]: !citOpen }))
                    }
                    className="inline-flex items-center gap-1.5 font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    RAG Citations ({r.citations.length}) · Confidence {r.ragConfidenceScore.toFixed(2)}
                    {citOpen ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    onClick={() =>
                      setExpandedTools((prev) => ({ ...prev, [item.id]: !mcpOpen }))
                    }
                    className="inline-flex items-center gap-1.5 font-medium text-sky-600 dark:text-sky-400 hover:underline"
                  >
                    <Cpu className="w-3.5 h-3.5" />
                    MCP Tools Invoked ({r.mcpToolsUsed.length})
                    {mcpOpen ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {r.modelUsed && (
                    <span className="ml-auto font-mono text-[11px] text-slate-500">
                      Engine: {r.modelUsed}
                    </span>
                  )}
                </div>

                {citOpen && (
                  <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5 bg-slate-50/40 dark:bg-[#0B1019]">
                    {r.citations.length === 0 ? (
                      <div className="text-xs text-slate-500">
                        No RAG document chunks were attached to this response.
                      </div>
                    ) : (
                      r.citations.map((c) => (
                        <div
                          key={c.chunkId}
                          className="p-3 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-xs space-y-1"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {c.title}
                            </span>
                            <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                              {c.collection} · Page {c.pageNumber} · Score {c.score}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Publisher: {c.publisher} · Pub: {c.publicationDate} · Effective:{' '}
                            {c.effectiveDate} · Status: {c.status}
                          </div>
                          <p className="text-xs text-slate-700 dark:text-slate-300 pt-1">
                            {c.excerpt}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {mcpOpen && (
                  <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 space-y-2 bg-slate-50/40 dark:bg-[#0B1019]">
                    {r.mcpToolsUsed.length === 0 ? (
                      <div className="text-xs text-slate-500">
                        No MCP tools were required for this query.
                      </div>
                    ) : (
                      r.mcpToolsUsed.map((t, idx) => (
                        <div
                          key={`${t.toolName}-${idx}`}
                          className="p-2.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-[11px] font-mono space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sky-600 dark:text-sky-400">
                              {t.toolName}
                            </span>
                            <span
                              className={
                                t.status === 'SUCCESS' ? 'text-emerald-500' : 'text-rose-500'
                              }
                            >
                              {t.status} · {t.durationMs}ms · {t.timestampIst}
                            </span>
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 break-all">
                            {t.dataPreview}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

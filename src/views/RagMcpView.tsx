import {
  CheckCircle2,
  Database,
  Play,
  RefreshCw,
  Search,
  Server,
  Shield,
  Trash2,
  Upload,
} from 'lucide-react';
import { ChangeEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  McpIntegrationStatus,
  RagCollection,
  RagDocumentMetadata,
  RagRetrievalResult,
} from '../types/trading';

interface RagMcpViewProps {
  mode: 'knowledge' | 'mcp';
}

const COLLECTIONS: { id: RagCollection; label: string }[] = [
  { id: 'INDIAN_MARKET', label: 'Indian Market' },
  { id: 'COMPANY_INFO', label: 'Company Info' },
  { id: 'FINANCIAL_NEWS_RESEARCH', label: 'Financial News & Research' },
  { id: 'TRADING_KNOWLEDGE', label: 'Trading Knowledge' },
  { id: 'REGULATORY_COMPLIANCE', label: 'Regulatory & Compliance' },
];

export function RagMcpView({ mode }: RagMcpViewProps) {
  // ── Knowledge Base (RAG) State ─────────────────────────────────────────────
  const [role, setRole] = useState<'ADMIN' | 'TRADER'>('ADMIN');
  const [docs, setDocs] = useState<RagDocumentMetadata[]>([]);
  const [counts, setCounts] = useState<Record<RagCollection, number>>({
    INDIAN_MARKET: 0,
    COMPANY_INFO: 0,
    FINANCIAL_NEWS_RESEARCH: 0,
    TRADING_KNOWLEDGE: 0,
    REGULATORY_COMPLIANCE: 0,
  });
  const [totalChunks, setTotalChunks] = useState(0);
  const [searchQ, setSearchQ] = useState('');
  const [filterCol, setFilterCol] = useState<RagCollection | 'ALL'>('ALL');
  const [ragFeedback, setRagFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  // Upload form
  const [title, setTitle] = useState('');
  const [collection, setCollection] = useState<RagCollection>('REGULATORY_COMPLIANCE');
  const [category, setCategory] = useState('SEBI Circular');
  const [publisher, setPublisher] = useState('SEBI / Exchange');
  const [sourceUrl, setSourceUrl] = useState('https://www.sebi.gov.in/');
  const [exchangeOrCompany, setExchangeOrCompany] = useState('NSE');
  const [relatedSymbol, setRelatedSymbol] = useState('');
  const [publicationDate, setPublicationDate] = useState('2026-11-20');
  const [effectiveDate, setEffectiveDate] = useState('2026-11-20');
  const [contentText, setContentText] = useState('');
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    mimeType: string;
    base64: string;
  } | null>(null);

  // Retrieval tester
  const [retrieveQuery, setRetrieveQuery] = useState('');
  const [retrieveResult, setRetrieveResult] = useState<RagRetrievalResult | null>(null);

  // ── MCP State ──────────────────────────────────────────────────────────────
  const [mcpStatus, setMcpStatus] = useState<McpIntegrationStatus | null>(null);
  const [testingMcp, setTestingMcp] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs: number;
    toolCount: number;
    error?: string;
  } | null>(null);
  const [inspectTool, setInspectTool] = useState('get_nse_market_status');
  const [inspectSymbol, setInspectSymbol] = useState('RELIANCE');
  const [inspectOutput, setInspectOutput] = useState<string | null>(null);

  const loadRag = useCallback(async () => {
    try {
      const res = await api.getRagDocuments({
        q: searchQ || undefined,
        collection: filterCol,
      });
      setDocs(res.documents);
      setCounts(res.countsByCollection);
      setTotalChunks(res.totalChunks);
    } catch (err) {
      setRagFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to load knowledge base.',
      });
    }
  }, [searchQ, filterCol]);

  const loadMcp = useCallback(async () => {
    try {
      const status = await api.getMcpStatus();
      setMcpStatus(status);
    } catch {
      // handled cleanly
    }
  }, []);

  useEffect(() => {
    if (mode === 'knowledge') loadRag();
    else loadMcp();
  }, [mode, loadRag, loadMcp]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      setSelectedFile({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64,
      });
      if (!title.trim()) {
        setTitle(file.name.replace(/\.[^.]+$/, ''));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (uploading) return;
    setUploading(true);
    setRagFeedback(null);
    try {
      const res = await api.uploadRagDocument(
        {
          fileName: selectedFile?.name || `${(title || 'knowledge-note').replace(/[^a-z0-9]/gi, '_')}.md`,
          contentBase64: selectedFile?.base64,
          contentText: selectedFile ? undefined : contentText,
          mimeType: selectedFile?.mimeType,
          title: title || selectedFile?.name || 'Untitled Document',
          sourceUrl,
          publisher,
          category,
          collection,
          publicationDate,
          effectiveDate,
          exchangeOrCompany,
          relatedSymbol: relatedSymbol.trim() || undefined,
        },
        role
      );
      setRagFeedback({
        ok: true,
        text: `Indexed "${res.document.title}" (v${res.document.version}, ${res.document.chunkCount} chunks, ${res.document.pageCount} pages).`,
      });
      setTitle('');
      setContentText('');
      setSelectedFile(null);
      await loadRag();
    } catch (err) {
      setRagFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Document upload failed.',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleToggleArchive = async (doc: RagDocumentMetadata) => {
    try {
      const nextStatus = doc.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED';
      await api.updateRagDocument(doc.docId, { status: nextStatus }, role);
      setRagFeedback({ ok: true, text: `Updated "${doc.title}" status to ${nextStatus}.` });
      await loadRag();
    } catch (err) {
      setRagFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Status update blocked.',
      });
    }
  };

  const handleDelete = async (doc: RagDocumentMetadata) => {
    try {
      await api.deleteRagDocument(doc.docId, role);
      setRagFeedback({ ok: true, text: `Deleted "${doc.title}" (${doc.docId}).` });
      await loadRag();
    } catch (err) {
      setRagFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Delete blocked.',
      });
    }
  };

  const handleRetrieveTest = async () => {
    if (!retrieveQuery.trim()) return;
    try {
      const res = await api.retrieveRag(
        retrieveQuery,
        filterCol === 'ALL' ? undefined : filterCol
      );
      setRetrieveResult(res);
    } catch (err) {
      setRagFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Retrieval test failed.',
      });
    }
  };

  const handleTestMcp = async () => {
    setTestingMcp(true);
    try {
      const res = await api.testMcpConnection();
      setTestResult({
        ok: res.ok,
        latencyMs: res.latencyMs,
        toolCount: res.toolCount,
        error: res.error,
      });
      setMcpStatus(res.status);
    } catch (err) {
      setTestResult({
        ok: false,
        latencyMs: 0,
        toolCount: 0,
        error: err instanceof Error ? err.message : 'MCP test failed.',
      });
    } finally {
      setTestingMcp(false);
    }
  };

  const handleRunInspectorTool = async () => {
    setInspectOutput(null);
    const needsSymbol = new Set([
      'get_nse_stock_quote',
      'get_historical_candles',
      'get_technical_indicators',
      'evaluate_walk_forward_ml',
      'explain_trading_signal',
    ]);
    const args: Record<string, unknown> = needsSymbol.has(inspectTool)
      ? { symbol: inspectSymbol.toUpperCase() }
      : inspectTool === 'search_rag_knowledge_base'
      ? { query: `SEBI or risk profile for ${inspectSymbol}` }
      : {};
    try {
      const res = await api.invokeMcpTool(inspectTool, args);
      setInspectOutput(JSON.stringify(res.data, null, 2));
      await loadMcp();
    } catch (err) {
      setInspectOutput(`Error: ${err instanceof Error ? err.message : 'Invocation failed.'}`);
    }
  };

  if (mode === 'mcp') {
    return (
      <div className="space-y-6">
        {/* Connection & Security Card */}
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-sky-500" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Model Context Protocol (MCP) Server & Client Integration
                </h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Real @modelcontextprotocol/sdk Streamable HTTP transport over server-authenticated Bearer session. Zero live order placement or risk bypass exposed.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={loadMcp}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
              <button
                onClick={handleTestMcp}
                disabled={testingMcp}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {testingMcp ? 'Testing Handshake...' : 'Test MCP Connection'}
              </button>
            </div>
          </div>

          {mcpStatus && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
              <div>
                <div className="text-slate-500 dark:text-slate-400">Transport & Endpoint</div>
                <div className="font-mono font-medium mt-0.5">
                  {mcpStatus.transportType} ({mcpStatus.endpointPath})
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Client Handshake</div>
                <div
                  className={`font-mono font-semibold mt-0.5 ${
                    mcpStatus.clientConnected ? 'text-emerald-500' : 'text-amber-500'
                  }`}
                >
                  {mcpStatus.clientConnected ? 'CONNECTED' : 'STANDBY (CONNECT ON DEMAND)'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Auth Guard</div>
                <div className="font-mono font-medium mt-0.5">
                  {mcpStatus.authConfigured ? 'BEARER PROTECTED' : 'UNCONFIGURED'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Last Tool Invocation</div>
                <div className="font-mono mt-0.5">
                  {mcpStatus.lastToolInvocationIst || 'None yet'}
                </div>
              </div>
            </div>
          )}

          {testResult && (
            <div
              className={`px-3 py-2 rounded border text-xs ${
                testResult.ok
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
              }`}
            >
              {testResult.ok
                ? `Streamable HTTP MCP handshake verified: ${testResult.toolCount} tools listed, market status returned in ${testResult.latencyMs}ms.`
                : `MCP connection check failed: ${testResult.error}`}
            </div>
          )}
        </div>

        {/* Live MCP Tool Inspector */}
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-3">
          <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Interactive Read-Only MCP Tool Runner
          </h3>
          <div className="flex flex-wrap gap-2.5">
            <select
              value={inspectTool}
              onChange={(e) => setInspectTool(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            >
              {(mcpStatus?.tools || []).map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} ({t.permissionLevel})
                </option>
              ))}
            </select>
            <input
              type="text"
              value={inspectSymbol}
              onChange={(e) => setInspectSymbol(e.target.value)}
              placeholder="Symbol (e.g. RELIANCE)"
              className="w-40 px-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono"
            />
            <button
              onClick={handleRunInspectorTool}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-700"
            >
              <Play className="w-3.5 h-3.5" />
              Invoke via MCP Client
            </button>
          </div>
          {inspectOutput && (
            <pre className="p-3 rounded bg-slate-950 text-emerald-300 text-[11px] font-mono overflow-x-auto max-h-64">
              {inspectOutput}
            </pre>
          )}
        </div>

        {/* 20 Registered MCP Tools Catalog */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Registered MCP Tool Catalog ({mcpStatus?.tools.length || 0} / 20)
            </h3>
            <span className="text-[11px] font-mono text-slate-500">
              Zod Input Validated · Timeout 10s · 60 req/min
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 px-4 font-medium">Tool Name</th>
                  <th className="py-2 px-3 font-medium">Category</th>
                  <th className="py-2 px-3 font-medium">Permission</th>
                  <th className="py-2 px-3 font-medium">Input Schema</th>
                  <th className="py-2 px-4 font-medium">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {(mcpStatus?.tools || []).map((t) => (
                  <tr key={t.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-4 font-mono font-semibold text-sky-600 dark:text-sky-400">
                      {t.name}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px]">{t.category}</td>
                    <td className="py-2 px-3 font-mono text-[11px]">{t.permissionLevel}</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500">
                      {t.inputSchemaSummary}
                    </td>
                    <td className="py-2 px-4 text-slate-600 dark:text-slate-300">
                      {t.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent MCP Audit Logs */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              MCP Invocation Audit Trail ({mcpStatus?.recentAuditLogs.length || 0})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 px-4 font-medium">Timestamp IST</th>
                  <th className="py-2 px-3 font-medium">Tool</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                  <th className="py-2 px-3 font-medium text-right">Duration</th>
                  <th className="py-2 px-4 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {(mcpStatus?.recentAuditLogs || []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500">
                      No MCP invocations logged yet. Run "Test MCP Connection" or ask the AI Copilot.
                    </td>
                  </tr>
                ) : (
                  (mcpStatus?.recentAuditLogs || []).map((log) => (
                    <tr key={log.id}>
                      <td className="py-2 px-4 font-mono text-[11px] text-slate-500">
                        {log.timestampIst}
                      </td>
                      <td className="py-2 px-3 font-mono font-medium">{log.toolName}</td>
                      <td
                        className={`py-2 px-3 font-mono font-semibold ${
                          log.status === 'SUCCESS' ? 'text-emerald-500' : 'text-rose-500'
                        }`}
                      >
                        {log.status}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{log.durationMs}ms</td>
                      <td className="py-2 px-4 text-slate-600 dark:text-slate-300">
                        {log.summary}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ── AI Knowledge Base (RAG Admin) View ─────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header & Role Guard */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              AI Knowledge Base (RAG Document Administration)
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            5 separated collections · Supports PDF, DOCX, TXT, MD, CSV, JSON, HTML (max 10 MB) · SHA-256 deduplication · Isolated from personal trading logs ({totalChunks} indexed chunks).
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Shield className="w-4 h-4 text-slate-400" />
          <span className="text-slate-500">Access Role:</span>
          <button
            onClick={() => setRole((r) => (r === 'ADMIN' ? 'TRADER' : 'ADMIN'))}
            className={`px-3 py-1 rounded font-mono font-semibold border ${
              role === 'ADMIN'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300'
            }`}
          >
            {role} (Click to Switch)
          </button>
        </div>
      </div>

      {/* 5 Separated Collection Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {COLLECTIONS.map((col) => (
          <button
            key={col.id}
            onClick={() => setFilterCol((prev) => (prev === col.id ? 'ALL' : col.id))}
            className={`p-3 rounded-lg border text-left transition-colors ${
              filterCol === col.id
                ? 'border-indigo-500 bg-indigo-500/10'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-slate-400'
            }`}
          >
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {col.label}
            </div>
            <div className="text-lg font-mono font-semibold mt-1 text-slate-900 dark:text-slate-100">
              {counts[col.id] || 0} docs
            </div>
          </button>
        ))}
      </div>

      {ragFeedback && (
        <div
          className={`px-4 py-2.5 rounded-md border text-xs ${
            ragFeedback.ok
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          {ragFeedback.text}
        </div>
      )}

      {/* Upload & Retrieval Sandbox Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Upload New Document */}
        <div className="lg:col-span-7 p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Ingest New Document into Knowledge Base
            </h3>
            <span className="text-[11px] font-mono text-slate-500">
              {role === 'ADMIN' ? 'Admin Write Enabled' : 'Read-Only Trader Role (403 on Write)'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Document Title (e.g. SEBI Circular Oct 2026)"
              className="px-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
            <select
              value={collection}
              onChange={(e) => setCollection(e.target.value as RagCollection)}
              className="px-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            >
              {COLLECTIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={publisher}
              onChange={(e) => setPublisher(e.target.value)}
              placeholder="Publisher (e.g. SEBI, NSE, HDFC Securities)"
              className="px-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Category (e.g. SEBI Circular, Earnings Filing)"
              className="px-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
            <input
              type="text"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="Source URL (https://... or local://...)"
              className="px-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={exchangeOrCompany}
                onChange={(e) => setExchangeOrCompany(e.target.value)}
                placeholder="Exchange/Company"
                className="flex-1 px-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
              />
              <input
                type="text"
                value={relatedSymbol}
                onChange={(e) => setRelatedSymbol(e.target.value)}
                placeholder="Symbol (opt)"
                className="w-28 px-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono uppercase"
              />
            </div>
            <input
              type="date"
              value={publicationDate}
              onChange={(e) => setPublicationDate(e.target.value)}
              aria-label="Publication Date"
              className="px-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              aria-label="Effective Date"
              className="px-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
          </div>

          <div className="space-y-2 text-xs">
            <label className="block font-medium text-slate-600 dark:text-slate-300">
              Upload File (PDF, DOCX, TXT, MD, CSV, JSON, HTML) OR Paste Text Below
            </label>
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.htm"
              onChange={handleFileChange}
              className="block w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-200"
            />
            {selectedFile && (
              <div className="text-[11px] font-mono text-sky-500">
                Selected file: {selectedFile.name}
              </div>
            )}
            <textarea
              rows={4}
              value={contentText}
              onChange={(e) => setContentText(e.target.value)}
              placeholder="Or paste verified markdown/plain-text document content here..."
              className="w-full px-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono text-xs"
            />
          </div>

          <button
            onClick={handleUpload}
            disabled={uploading || (!selectedFile && contentText.trim().length < 15)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
          >
            <Upload className="w-3.5 h-3.5" />
            {uploading ? 'Chunking & Indexing...' : 'Index Document'}
          </button>
        </div>

        {/* Semantic Retrieval Sandbox */}
        <div className="lg:col-span-5 p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Semantic Retrieval & Citation Tester
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={retrieveQuery}
              onChange={(e) => setRetrieveQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRetrieveTest();
              }}
              placeholder="Test RAG retrieval (e.g. SEBI static IP, RELIANCE drivers)"
              className="flex-1 px-3 py-2 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
            <button
              onClick={handleRetrieveTest}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium rounded bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-700"
            >
              <Search className="w-3.5 h-3.5" />
              Test
            </button>
          </div>

          {retrieveResult && (
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between font-mono text-[11px] text-slate-500">
                <span>
                  Evidence:{' '}
                  <strong
                    className={
                      retrieveResult.sufficientEvidence ? 'text-emerald-500' : 'text-amber-500'
                    }
                  >
                    {retrieveResult.sufficientEvidence ? 'SUFFICIENT' : 'INSUFFICIENT'}
                  </strong>
                </span>
                <span>Top Score: {retrieveResult.confidenceScore}</span>
              </div>
              {retrieveResult.citations.length === 0 ? (
                <div className="p-3 rounded border border-slate-200 dark:border-slate-800 text-slate-500">
                  {retrieveResult.noResultReason || 'No matching chunks.'}
                </div>
              ) : (
                retrieveResult.citations.map((c) => (
                  <div
                    key={c.chunkId}
                    className="p-2.5 rounded border border-slate-200 dark:border-slate-800 space-y-1"
                  >
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {c.title} (Page {c.pageNumber}, Score {c.score})
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {c.collection} · {c.publisher} · {c.publicationDate}
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300">
                      {c.excerpt.slice(0, 220)}...
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Document Registry Table */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Indexed Documents Registry ({docs.length})
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Filter title, symbol, publisher..."
              className="px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
            <button
              onClick={loadRag}
              className="px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Filter
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4 font-medium">Title & Publisher</th>
                <th className="py-2.5 px-3 font-medium">Collection</th>
                <th className="py-2.5 px-3 font-medium">Status / Ver</th>
                <th className="py-2.5 px-3 font-medium">Indexing</th>
                <th className="py-2.5 px-3 font-medium text-right">Chunks / Pages</th>
                <th className="py-2.5 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {docs.map((doc) => (
                <tr key={doc.docId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-4 max-w-xs">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {doc.title}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {doc.publisher} · Pub {doc.publicationDate} · Eff {doc.effectiveDate}
                      {doc.relatedSymbol ? ` · ${doc.relatedSymbol}` : ''}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px]">{doc.collection}</td>
                  <td className="py-2.5 px-3 font-mono text-[11px]">
                    <span
                      className={
                        doc.status === 'ACTIVE'
                          ? 'text-emerald-500 font-semibold'
                          : 'text-amber-500 font-semibold'
                      }
                    >
                      {doc.status}
                    </span>{' '}
                    · v{doc.version}
                  </td>
                  <td className="py-2.5 px-3 text-[11px]">
                    <div className="font-mono text-sky-500">
                      {doc.indexingStatus}
                      {doc.geminiFileSearchSynced ? ' + FileSearch' : ' (Hybrid Local)'}
                    </div>
                    {doc.indexingError && (
                      <div className="text-[10px] text-slate-400 truncate max-w-[200px]" title={doc.indexingError}>
                        {doc.indexingError}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {doc.chunkCount} / {doc.pageCount}p
                  </td>
                  <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                    <button
                      onClick={() => handleToggleArchive(doc)}
                      className="px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {doc.status === 'ARCHIVED' ? 'Activate' : 'Archive'}
                    </button>
                    <button
                      onClick={() => handleDelete(doc)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-rose-500/40 text-rose-500 hover:bg-rose-500/10"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

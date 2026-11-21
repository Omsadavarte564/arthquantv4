import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  AssistantTransparencyTag,
  CopilotQueryResponse,
  McpPermissionLevel,
  RagCitation,
} from '../../src/types/trading.ts';
import { findNseDirectoryEntry } from '../data/nseDirectory.ts';
import { isValidSymbol, STOCK_UNIVERSE } from '../data/nseUniverse.ts';
import { mcpClientManager } from '../mcp/mcpClient.ts';
import { formatNowIst } from '../quant/riskEngine.ts';
import { classifyRagQuery, retrieveRagContext } from '../rag/ragEngine.ts';

const KNOWN_RESEARCH_SYMBOLS = new Set(STOCK_UNIVERSE.map((s) => s.symbol));

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 12000,
      headers: { 'User-Agent': 'aistudio-build' },
    },
  });
}

async function detectNseSymbolInQuery(query: string): Promise<string | undefined> {
  const ragClass = classifyRagQuery(query);
  if (ragClass.detectedSymbol) return ragClass.detectedSymbol;

  // Check uppercase tokens against full NSE master directory if not in top-24
  const tokens = query
    .toUpperCase()
    .replace(/[^A-Z0-9&-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && t.length <= 18);

  const stopTokens = new Set([
    'NSE', 'BSE', 'SEBI', 'WHAT', 'TELL', 'SHOW', 'PRICE', 'LIVE', 'QUOTE', 'TREND',
    'CHECK', 'SIGNAL', 'RISK', 'STATIC', 'ALGO', 'PORTFOLIO', 'PAPER', 'BACKTEST',
    'STRATEGY', 'HIGHEST', 'SHARPE', 'RATIO', 'BASED', 'TODAY', 'MARKET', 'RECENT',
    'ABOUT', 'WITH', 'WHICH', 'FROM', 'HAVE', 'RULE', 'RULES', 'CIRCULAR', 'OPEN',
  ]);

  for (const tok of tokens) {
    if (stopTokens.has(tok)) continue;
    if (KNOWN_RESEARCH_SYMBOLS.has(tok)) return tok;
    const entry = await findNseDirectoryEntry(tok);
    if (entry && entry.isStandardEquity) return entry.symbol;
  }
  return undefined;
}

export type CopilotIntent =
  | 'DOCUMENT_QA'
  | 'LIVE_MARKET'
  | 'COMBINED_RESEARCH'
  | 'STRATEGY_PERF'
  | 'PORTFOLIO'
  | 'GENERAL';

export async function classifyCopilotIntent(query: string): Promise<{
  intent: CopilotIntent;
  detectedSymbol?: string;
  wantsLiveMarket: boolean;
  wantsDocs: boolean;
  wantsStrategy: boolean;
  wantsPortfolio: boolean;
}> {
  const q = query.toLowerCase();
  const detectedSymbol = await detectNseSymbolInQuery(query);

  const wantsDocs =
    /\b(sebi|circular|static ip|algo|regulation|compliance|holiday|timing|session|filing|annual report|risk profile|risk factor|methodology|lookahead|embargo|stt|stamp duty|brokerage|document|knowledge base|rule|policy)\b/.test(
      q
    );
  const wantsLiveMarket =
    /\b(price|ltp|quote|current|today|live|chart|rsi|adx|vwap|supertrend|indicator|trend|signal|scanner|market open|market status|volume|gainer|loser)\b/.test(
      q
    );
  const wantsStrategy =
    /\b(strategy|strategies|backtest|sharpe|sortino|win rate|profit factor|drawdown|walk-forward|ml model|brier|auc)\b/.test(
      q
    );
  const wantsPortfolio =
    /\b(portfolio|position|paper|equity|margin|pnl|p&l|journal|kill switch|risk limit|risk check|risk config|open trade|can i buy|can i sell)\b/.test(
      q
    );

  let intent: CopilotIntent = 'GENERAL';
  if ((wantsDocs && wantsLiveMarket) || (detectedSymbol && wantsDocs) || /\banalyze\b.*\b(trend|risk|filing|signal)\b/.test(q)) {
    intent = 'COMBINED_RESEARCH';
  } else if (wantsPortfolio && !wantsStrategy && !wantsDocs) {
    intent = 'PORTFOLIO';
  } else if (wantsStrategy) {
    intent = 'STRATEGY_PERF';
  } else if (wantsLiveMarket && !wantsDocs) {
    intent = 'LIVE_MARKET';
  } else if (wantsDocs) {
    intent = 'DOCUMENT_QA';
  } else if (detectedSymbol) {
    intent = 'COMBINED_RESEARCH';
  }

  return {
    intent,
    detectedSymbol,
    wantsLiveMarket,
    wantsDocs,
    wantsStrategy,
    wantsPortfolio,
  };
}

async function generateCopilotTextWithGemini(
  prompt: string,
  systemInstruction: string
): Promise<{ ok: boolean; text?: string; modelUsed?: string; error?: string }> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      ok: false,
      error: 'GEMINI_API_KEY is not configured in server secrets.',
    };
  }

  try {
    const res = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    return { ok: true, text: res.text || '', modelUsed: 'gemini-4-hydrogen' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const shouldFallback =
      msg.includes('429') ||
      msg.includes('503') ||
      msg.includes('504') ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('UNAVAILABLE');

    if (shouldFallback) {
      try {
        const fb = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: prompt,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          },
        });
        return { ok: true, text: fb.text || '', modelUsed: 'gemini-3.1-flash-lite' };
      } catch (fbErr) {
        return {
          ok: false,
          error: fbErr instanceof Error ? fbErr.message : String(fbErr),
        };
      }
    }
    return { ok: false, error: msg };
  }
}

function buildDeterministicFallbackAnswer(params: {
  query: string;
  intent: CopilotIntent;
  citations: RagCitation[];
  sufficientRagEvidence: boolean;
  mcpOutputs: { toolName: string; data: unknown }[];
  geminiError?: string;
}): string {
  const sections: string[] = [];

  if (params.mcpOutputs.length > 0) {
    sections.push('**Verified MCP Tool Data (Server-Side):**');
    for (const out of params.mcpOutputs) {
      const compact = JSON.stringify(out.data, null, 2).slice(0, 900);
      sections.push(`- **${out.toolName}**:\n\`\`\`json\n${compact}\n\`\`\``);
    }
  }

  if (params.citations.length > 0) {
    sections.push('**Retrieved Knowledge Base Citations:**');
    for (const c of params.citations) {
      sections.push(
        `- **[${c.title} | ${c.publisher} | ${c.publicationDate} | Page ${c.pageNumber}]** (Score ${c.score}): ${c.excerpt}`
      );
    }
  } else if (params.intent === 'DOCUMENT_QA' && !params.sufficientRagEvidence) {
    sections.push(
      'Insufficient evidence in the indexed Knowledge Base to answer this document question reliably. Upload an authoritative PDF, DOCX, or Markdown document in AI Knowledge Base first.'
    );
  }

  if (params.geminiError) {
    sections.push(
      `_Note: Gemini narrative synthesis fallback active (${params.geminiError.slice(0, 140)}). All figures and citations above are directly verified from ArthQuant MCP tools and RAG chunks._`
    );
  }

  return sections.join('\n\n') || 'No matching tool or document evidence found for this query.';
}

export async function runAssistantCopilot(params: {
  query: string;
  userId?: string;
  allowedPermissions?: McpPermissionLevel[];
  preferredSymbol?: string;
}): Promise<CopilotQueryResponse> {
  const query = params.query.trim();
  if (!query) {
    throw new Error('Query cannot be empty.');
  }

  const userId = params.userId || 'terminal-user';
  const permissions: McpPermissionLevel[] = params.allowedPermissions || [
    'PUBLIC_MARKET',
    'RESEARCH_QUANT',
    'PORTFOLIO_READ',
  ];

  const routingInfo = await classifyCopilotIntent(query);
  const symbol = params.preferredSymbol?.toUpperCase().trim() || routingInfo.detectedSymbol;

  const mcpToolsUsed: CopilotQueryResponse['mcpToolsUsed'] = [];
  const mcpRawOutputs: { toolName: string; data: unknown }[] = [];
  const transparencyTags: AssistantTransparencyTag[] = [];
  let citations: RagCitation[] = [];
  let sufficientRagEvidence = true;
  let ragConfidenceScore = 0;

  const invokeMcp = async (toolName: string, args: Record<string, unknown>) => {
    try {
      const res = await mcpClientManager.callMcpToolForUser(userId, permissions, toolName, args);
      mcpToolsUsed.push({
        toolName,
        durationMs: res.durationMs,
        timestampIst: res.timestampIst,
        status: 'SUCCESS',
        dataPreview: res.rawText.slice(0, 260),
      });
      mcpRawOutputs.push({ toolName, data: res.data });
      return res.data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mcpToolsUsed.push({
        toolName,
        durationMs: 0,
        timestampIst: formatNowIst(),
        status: 'ERROR',
        dataPreview: msg.slice(0, 220),
      });
      return null;
    }
  };

  // 1. Dispatch MCP tool calls strictly for real-time/quant/strategy/portfolio data
  const { intent } = routingInfo;
  if (intent === 'LIVE_MARKET' || intent === 'COMBINED_RESEARCH') {
    await invokeMcp('get_nse_market_status', {});
    if (symbol) {
      await invokeMcp('get_nse_stock_quote', { symbol });
      if (isValidSymbol(symbol)) {
        await invokeMcp('get_technical_indicators', { symbol, timeframe: '5m' });
        await invokeMcp('get_ai_trading_signals', { symbol, timeframe: '5m' });
      }
    } else {
      await invokeMcp('get_market_overview', { timeframe: '5m' });
      await invokeMcp('get_ai_trading_signals', { timeframe: '5m', actionableOnly: true });
    }
    transparencyTags.push({
      type: 'LIVE_OR_DELAYED_MARKET_DATA',
      label: 'Market Clock & Public/Research NSE Quotes (via MCP)',
      timestampIst: formatNowIst(),
      source: 'MCP Server -> publicMarketFeed / nseUniverse',
    });
    if (symbol ? isValidSymbol(symbol) : true) {
      transparencyTags.push({
        type: 'QUANT_ML_ENGINE',
        label: 'Causal Technical Indicators & Calibrated ML Signals (via MCP)',
        timestampIst: formatNowIst(),
        source: 'MCP Server -> indicators / signals',
      });
    }
  }

  if (intent === 'STRATEGY_PERF') {
    await invokeMcp('list_strategies', { enabledOnly: true });
    await invokeMcp('get_backtest_history', { limit: 10 });
    if (symbol && isValidSymbol(symbol)) {
      await invokeMcp('evaluate_walk_forward_ml', { symbol, timeframe: '5m', threshold: 0.62 });
    }
    transparencyTags.push({
      type: 'QUANT_ML_ENGINE',
      label: 'Strategy Registry, OOS Backtests & Walk-Forward ML (via MCP)',
      timestampIst: formatNowIst(),
      source: 'MCP Server -> backtester / mlEngine',
    });
  }

  if (intent === 'PORTFOLIO' || intent === 'COMBINED_RESEARCH') {
    await invokeMcp('get_paper_portfolio', {});
    await invokeMcp('get_risk_dashboard', {});
    transparencyTags.push({
      type: 'PAPER_PORTFOLIO_DATA',
      label: 'Simulated Paper Portfolio & 9-Rule Risk Config (via MCP)',
      timestampIst: formatNowIst(),
      source: 'MCP Server -> stateStore / riskEngine (Live Locked)',
    });
  }

  // 2. Dispatch RAG retrieval for documents, rules, filings, or general Q&A
  //    CRITICAL SEPARATION RULE: Pure LIVE_MARKET price/quote queries do NOT search old RAG docs!
  const shouldQueryRag =
    intent === 'DOCUMENT_QA' ||
    intent === 'COMBINED_RESEARCH' ||
    intent === 'GENERAL' ||
    (intent === 'STRATEGY_PERF' && /\b(methodology|lookahead|embargo|charge|stt|rule)\b/i.test(query));

  if (shouldQueryRag) {
    const rag = await retrieveRagContext(query, { symbol, topK: 4 });
    citations = rag.citations;
    sufficientRagEvidence = rag.sufficientEvidence;
    ragConfidenceScore = rag.confidenceScore;

    if (citations.length > 0) {
      transparencyTags.push({
        type: 'RETRIEVED_RAG_DOCUMENTS',
        label: `Grounded RAG Corpus (${citations.length} cited passage${citations.length > 1 ? 's' : ''})`,
        timestampIst: formatNowIst(),
        source: `Collections: ${Array.from(new Set(citations.map((c) => c.collection))).join(', ')}`,
      });
    }
  }

  if (intent === 'GENERAL' && mcpToolsUsed.length === 0 && citations.length === 0) {
    await invokeMcp('get_nse_market_status', {});
    transparencyTags.push({
      type: 'GENERAL_EXPLANATION',
      label: 'General Trading Education / Clarification',
      timestampIst: formatNowIst(),
      source: 'Gemini Research Assistant',
    });
  }

  // If document-only query has insufficient evidence, skip inventing ungrounded text
  if (intent === 'DOCUMENT_QA' && !sufficientRagEvidence) {
    return {
      available: true,
      answer:
        'Insufficient evidence in the indexed Knowledge Base to answer this reliably. Please upload a relevant verified document (PDF, DOCX, TXT, MD, CSV, JSON, HTML) in **AI Knowledge Base** or refine your query with specific SEBI/NSE/strategy terms.',
      routing: {
        intent,
        usedRag: true,
        usedMcp: mcpToolsUsed.length > 0,
        detectedSymbol: symbol,
      },
      sufficientEvidence: false,
      ragConfidenceScore,
      citations: [],
      mcpToolsUsed,
      transparencyTags:
        transparencyTags.length > 0
          ? transparencyTags
          : [
              {
                type: 'RETRIEVED_RAG_DOCUMENTS',
                label: 'RAG Retrieval (Insufficient Evidence)',
                timestampIst: formatNowIst(),
                source: 'ArthQuant Knowledge Base',
              },
            ],
      modelUsed: 'GUARDED_INSUFFICIENT_EVIDENCE',
    };
  }

  // 3. Build grounded Gemini prompt
  const mcpBlock =
    mcpRawOutputs.length > 0
      ? mcpRawOutputs
          .map((m) => `### MCP Tool: ${m.toolName}\n${JSON.stringify(m.data, null, 2).slice(0, 2600)}`)
          .join('\n\n')
      : 'None invoked.';

  const ragBlock =
    citations.length > 0
      ? citations
          .map(
            (c, i) =>
              `[${i + 1}] Title: ${c.title} | Collection: ${c.collection} | Publisher: ${c.publisher} | PubDate: ${c.publicationDate} | Effective: ${c.effectiveDate} | Page: ${c.pageNumber} | Score: ${c.score}\nExcerpt: ${c.excerpt}`
          )
          .join('\n\n')
      : 'No RAG passages retrieved or matched.';

  const systemInstruction = `You are ArthQuant's Institutional Indian Equity Research & Risk Copilot.
STRICT SAFETY & GROUNDING RULES:
1. NEVER fabricate stock prices, percentages, SEBI circulars, or backtest numbers. Use ONLY the verified MCP Tool Outputs and RAG Passages supplied below.
2. Separate live/delayed market quotes & quant indicators (from MCP tools) from static research/regulatory rules (from RAG passages). NEVER treat old RAG excerpts as current live prices.
3. Whenever referencing a retrieved RAG fact, cite it inline as [Title | Publisher | PubDate | Page N].
4. If the user asks something outside supplied evidence, explicitly state what is missing or unavailable.
5. Never guarantee trading profits or promise real-money broker execution (paper mode only; live execution is locked).
6. Format cleanly with concise headings or bullets under 280 words.`;

  const prompt = `User Question: ${query}

Detected Intent: ${intent}${symbol ? ` | Detected NSE Symbol: ${symbol}` : ''}

=== VERIFIED MCP TOOL OUTPUTS ===
${mcpBlock}

=== RETRIEVED RAG KNOWLEDGE PASSAGES ===
${ragBlock}

Provide a clear, accurate, strictly grounded response citing exact MCP numbers and [Title | Publisher | PubDate | Page N] where applicable.`;

  const llm = await generateCopilotTextWithGemini(prompt, systemInstruction);

  if (!llm.ok || !llm.text) {
    const fallbackAnswer = buildDeterministicFallbackAnswer({
      query,
      intent,
      citations,
      sufficientRagEvidence,
      mcpOutputs: mcpRawOutputs,
      geminiError: llm.error,
    });
    return {
      available: false,
      error: llm.error,
      answer: fallbackAnswer,
      routing: {
        intent,
        usedRag: shouldQueryRag,
        usedMcp: mcpToolsUsed.length > 0,
        detectedSymbol: symbol,
      },
      sufficientEvidence: sufficientRagEvidence || mcpToolsUsed.some((t) => t.status === 'SUCCESS'),
      ragConfidenceScore,
      citations,
      mcpToolsUsed,
      transparencyTags,
      modelUsed: 'DETERMINISTIC_GROUNDED_FALLBACK',
    };
  }

  return {
    available: true,
    answer: llm.text,
    routing: {
      intent,
      usedRag: shouldQueryRag,
      usedMcp: mcpToolsUsed.length > 0,
      detectedSymbol: symbol,
    },
    sufficientEvidence: sufficientRagEvidence || mcpToolsUsed.some((t) => t.status === 'SUCCESS'),
    ragConfidenceScore,
    citations,
    mcpToolsUsed,
    transparencyTags,
    modelUsed: llm.modelUsed,
  };
}

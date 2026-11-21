import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { MarketOverviewResponse, ScannerRow, TradingSignal } from '../../src/types/trading.ts';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 12000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiConfigured(): boolean {
  const apiKey = process.env.GEMINI_API_KEY;
  return Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
}

function formatGeminiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw);
    const code = parsed?.error?.code;
    const status = parsed?.error?.status;
    const message = parsed?.error?.message;
    if (code === 429 || status === 'RESOURCE_EXHAUSTED') {
      return `Gemini API free-tier quota exceeded (429): Select a billing-enabled API key in Settings > Secrets or retry after quota resets. Details: ${message}`;
    }
    if (message) {
      return `Gemini API unavailable (${code ?? status ?? 'ERROR'}): ${message}`;
    }
  } catch {
    // non-JSON message
  }
  return `Gemini API unavailable: ${raw}`;
}

async function generateWithFallback(
  ai: GoogleGenAI,
  contents: string,
  systemInstruction: string
): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    return response.text ?? '';
  } catch (primaryErr) {
    const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    const shouldFallback =
      msg.includes('429') ||
      msg.includes('503') ||
      msg.includes('504') ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('UNAVAILABLE') ||
      msg.includes('DEADLINE_EXCEEDED');

    if (!shouldFallback) {
      throw primaryErr;
    }

    const callFallback = () =>
      ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      });

    try {
      const fallbackResponse = await callFallback();
      return fallbackResponse.text ?? '';
    } catch (fallbackErr) {
      const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      if (fbMsg.includes('503') || fbMsg.includes('UNAVAILABLE')) {
        await new Promise((r) => setTimeout(r, 500));
        const retryResponse = await callFallback();
        return retryResponse.text ?? '';
      }
      throw fallbackErr;
    }
  }
}

export async function explainSignalWithGemini(signal: TradingSignal): Promise<{
  available: boolean;
  explanation?: string;
  error?: string;
}> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      available: false,
      error: 'GEMINI_API_KEY is not configured in server secrets. Quantitative signal metrics remain valid; AI narrative is unavailable.',
    };
  }

  try {
    const prompt = `You are a quantitative Indian equity intraday research analyst explaining a signal from ArthQuant.
STRICT RULES:
- Explain ONLY the provided quantitative metrics. Do NOT invent new prices, do NOT alter entry/stop-loss/target levels, and do NOT guarantee profits.
- Keep the explanation crisp, structured, and under 140 words.

Signal Data (Read-Only):
Symbol: ${signal.symbol} (${signal.companyName})
Direction: ${signal.direction}
Strategy: ${signal.strategyName}
Market Regime: ${signal.regime}
Entry: ₹${signal.entryPrice} | Stop-Loss: ₹${signal.stopLoss} | Target 1: ₹${signal.target1} | Target 2: ₹${signal.target2}
Risk/Reward: ${signal.riskRewardRatio}:1
Calibrated ML Probability: ${(signal.estimatedProbability * 100).toFixed(1)}% (95% Wilson CI: ${signal.confidenceLow}%–${signal.confidenceHigh}%)
Technical Justification: ${signal.technicalJustification}
${signal.rejectionReason ? `Rejection/Hold Reason: ${signal.rejectionReason}` : ''}

Provide:
1. Core Setup Thesis
2. Risk & Invalidating Condition
3. Execution Discipline Note`;

    const explanation = await generateWithFallback(
      ai,
      prompt,
      'You are an objective quantitative research explainer for NSE equities. Never fabricate prices or promise returns.'
    );

    return {
      available: true,
      explanation: explanation || 'No explanation returned.',
    };
  } catch (err) {
    return { available: false, error: formatGeminiError(err) };
  }
}

export async function generateMarketReportWithGemini(overview: MarketOverviewResponse): Promise<{
  available: boolean;
  report?: string;
  error?: string;
}> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      available: false,
      error: 'GEMINI_API_KEY is not configured in server secrets. Set it in Settings > Secrets to enable AI market briefs.',
    };
  }

  try {
    const prompt = `Synthesize a concise institutional-style Indian intraday market brief from these verified snapshot numbers (${overview.dataSourceLabel}, timestamp ${overview.istTimestamp}):
Indices: ${overview.indices.map((i) => `${i.name}: ${i.ltp} (${i.changePct >= 0 ? '+' : ''}${i.changePct}%, regime ${i.regime})`).join(' | ')}
Breadth: ${overview.breadth.advances} Advances / ${overview.breadth.declines} Declines (A/D ${overview.breadth.adRatio}), NIFTY Realized Vol ${overview.breadth.realizedVolAnnualizedPct}%
Leading Sectors: ${overview.sectors.slice(0, 3).map((s) => `${s.sector} (${s.changePct >= 0 ? '+' : ''}${s.changePct}%)`).join(', ')}
Lagging Sectors: ${overview.sectors.slice(-2).map((s) => `${s.sector} (${s.changePct >= 0 ? '+' : ''}${s.changePct}%)`).join(', ')}
Top Gainers: ${overview.topGainers.slice(0, 3).map((g) => `${g.symbol} ${g.changePct}%`).join(', ')}
Unusual RVol: ${overview.unusualVolume.slice(0, 3).map((u) => `${u.symbol} ${u.relVolume}x`).join(', ')}

Keep under 180 words with 3 bulleted takeaways: Regime Posture, Sector Leadership, and Intraday Risk Guidance.`;

    const report = await generateWithFallback(
      ai,
      prompt,
      'You write factual, sober Indian equity market summaries strictly from supplied snapshot figures.'
    );

    return {
      available: true,
      report: report || 'No report generated.',
    };
  } catch (err) {
    return { available: false, error: formatGeminiError(err) };
  }
}

export async function generateStockSummaryWithGemini(
  row: ScannerRow,
  meta: { sector: string; peRatio: number; roePct: number; institutionalHoldingPct: number }
): Promise<{ available: boolean; summary?: string; error?: string }> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      available: false,
      error: 'GEMINI_API_KEY is not configured in server secrets.',
    };
  }

  try {
    const prompt = `Provide a concise 360-degree StockWise-style research brief for ${row.symbol} (${row.name}):
Price: ₹${row.ltp} (${row.changePct >= 0 ? '+' : ''}${row.changePct}%), Sector: ${meta.sector}
Fundamentals: P/E ${meta.peRatio}, ROE ${meta.roePct}%, Institutional Holding ${meta.institutionalHoldingPct}%, MCap ₹${row.marketCapCr.toLocaleString('en-IN')} Cr
Intraday Quant State: Regime ${row.regime}, RSI(14) ${row.rsi14}, ADX(14) ${row.adx14}, VWAP Dev ${row.vwapDistPct}%, RelVol ${row.relVolume}x, Calibrated P(Up) ${row.aiProbUp}%, Signal: ${row.signal}

Summarize in 3 concise sections (Intraday Technical Posture, Fundamental Context, Key Risk Factors) under 150 words. Do not give investment advice or guarantees.`;

    const summary = await generateWithFallback(
      ai,
      prompt,
      'You summarize Indian equity metrics strictly from supplied figures without giving financial advice.'
    );

    return { available: true, summary };
  } catch (err) {
    return { available: false, error: formatGeminiError(err) };
  }
}

import { Candle, Timeframe } from '../../src/types/trading.ts';

export interface PublicNseQuoteMeta {
  symbol: string;
  ltp: number;
  previousClose: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  lastBarIst: string;
  sourceLabel: string;
}

export interface PublicCandleResult {
  candles: Candle[];
  quote: PublicNseQuoteMeta;
}

export interface BatchQuoteItem {
  symbol: string;
  ltp: number;
  changePct: number;
  previousClose: number;
}

const cache = new Map<string, { fetchedAt: number; data: PublicCandleResult }>();
const batchQuoteCache = new Map<string, { fetchedAt: number; data: BatchQuoteItem }>();
const CACHE_TTL_MS = 15_000;

function formatIst(unixSec: number): { istLabel: string; sessionDate: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(unixSec * 1000));

  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  const sessionDate = `${map.year}-${map.month}-${map.day}`;
  const istLabel = `${sessionDate} ${map.hour}:${map.minute} IST`;
  return { istLabel, sessionDate };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseYahooChartResponse(
  symbol: string,
  payload: any
): PublicCandleResult {
  const result = payload?.chart?.result?.[0];
  if (!result) {
    const errDesc = payload?.chart?.error?.description || 'No chart data returned from NSE public feed.';
    throw new Error(errDesc);
  }

  const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const q = result.indicators?.quote?.[0] || {};
  const opens: (number | null)[] = Array.isArray(q.open) ? q.open : [];
  const highs: (number | null)[] = Array.isArray(q.high) ? q.high : [];
  const lows: (number | null)[] = Array.isArray(q.low) ? q.low : [];
  const closes: (number | null)[] = Array.isArray(q.close) ? q.close : [];
  const volumes: (number | null)[] = Array.isArray(q.volume) ? q.volume : [];

  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i];
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    const v = volumes[i] ?? 0;

    if (
      !Number.isFinite(t) ||
      o === null || h === null || l === null || c === null ||
      !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c) ||
      o <= 0 || h <= 0 || l <= 0 || c <= 0
    ) {
      continue;
    }

    const rOpen = round2(o);
    const rClose = round2(c);
    const rHigh = round2(Math.max(h, rOpen, rClose));
    const rLow = round2(Math.min(l, rOpen, rClose));
    const { istLabel, sessionDate } = formatIst(t);

    candles.push({
      time: t,
      istLabel,
      sessionDate,
      open: rOpen,
      high: rHigh,
      low: rLow,
      close: rClose,
      volume: Math.max(0, Math.round(Number.isFinite(v) ? v : 0)),
    });
  }

  if (candles.length === 0) {
    throw new Error(`No valid OHLCV bars found for ${symbol}.NS.`);
  }

  const meta = result.meta || {};
  const lastCandle = candles[candles.length - 1];
  const latestSession = lastCandle.sessionDate;
  const sessionCandles = candles.filter((c) => c.sessionDate === latestSession);
  const prevSessionCandles = candles.filter((c) => c.sessionDate !== latestSession);

  const ltp = Number.isFinite(meta.regularMarketPrice) ? round2(meta.regularMarketPrice) : lastCandle.close;
  const previousClose =
    prevSessionCandles.length > 0
      ? prevSessionCandles[prevSessionCandles.length - 1].close
      : Number.isFinite(meta.previousClose)
      ? round2(meta.previousClose)
      : Number.isFinite(meta.chartPreviousClose)
      ? round2(meta.chartPreviousClose)
      : sessionCandles[0].open;

  const changePct = previousClose > 0 ? round2(((ltp - previousClose) / previousClose) * 100) : 0;
  const dayHigh = round2(Math.max(...sessionCandles.map((c) => c.high)));
  const dayLow = round2(Math.min(...sessionCandles.map((c) => c.low)));
  const sessionVol = sessionCandles.reduce((acc, c) => acc + c.volume, 0);

  return {
    candles,
    quote: {
      symbol,
      ltp,
      previousClose,
      changePct,
      dayHigh,
      dayLow,
      volume: sessionVol,
      lastBarIst: lastCandle.istLabel,
      sourceLabel: 'Yahoo Finance Public NSE Feed (.NS, Near-Realtime/Delayed)',
    },
  };
}

export function parseYahooSparkResponse(payload: Record<string, any>): Record<string, BatchQuoteItem> {
  const out: Record<string, BatchQuoteItem> = {};
  if (!payload || typeof payload !== 'object') return out;

  for (const [key, entry] of Object.entries(payload)) {
    if (!entry || typeof entry !== 'object') continue;
    const sym = key.replace(/\.NS$/i, '').toUpperCase();
    const closes: number[] = Array.isArray(entry.close)
      ? entry.close.filter((x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0)
      : [];

    const fulldayPrice = typeof entry.fulldayPrice === 'number' && Number.isFinite(entry.fulldayPrice)
      ? round2(entry.fulldayPrice)
      : closes.length > 0
      ? round2(closes[closes.length - 1])
      : 0;

    if (fulldayPrice <= 0) continue;

    const prevClose =
      closes.length >= 2
        ? round2(closes[closes.length - 2])
        : typeof entry.previousClose === 'number' && Number.isFinite(entry.previousClose)
        ? round2(entry.previousClose)
        : typeof entry.chartPreviousClose === 'number' && Number.isFinite(entry.chartPreviousClose)
        ? round2(entry.chartPreviousClose)
        : fulldayPrice;

    const changePct =
      typeof entry.fulldayChangePercent === 'number' && Number.isFinite(entry.fulldayChangePercent)
        ? round2(entry.fulldayChangePercent)
        : prevClose > 0
        ? round2(((fulldayPrice - prevClose) / prevClose) * 100)
        : 0;

    out[sym] = {
      symbol: sym,
      ltp: fulldayPrice,
      previousClose: prevClose,
      changePct,
    };
  }
  return out;
}

export async function fetchPublicBatchQuotes(symbols: string[]): Promise<Record<string, BatchQuoteItem>> {
  const now = Date.now();
  const result: Record<string, BatchQuoteItem> = {};
  const toFetch: string[] = [];

  for (const rawSym of symbols) {
    const sym = rawSym.toUpperCase().trim();
    if (!sym || sym.includes('-')) continue;
    const cached = batchQuoteCache.get(sym);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      result[sym] = cached.data;
    } else {
      toFetch.push(sym);
    }
  }

  if (toFetch.length === 0) return result;

  const chunks: string[][] = [];
  for (let i = 0; i < toFetch.length; i += 15) {
    chunks.push(toFetch.slice(i, i + 15));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const joined = chunk.map((s) => `${s}.NS`).join(',');
      const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(
        joined
      )}&range=5d&interval=1d`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (!res.ok) return;
        const json = await res.json();
        const parsed = parseYahooSparkResponse(json);
        const ts = Date.now();
        for (const [sym, item] of Object.entries(parsed)) {
          batchQuoteCache.set(sym, { fetchedAt: ts, data: item });
          result[sym] = item;
        }
      } catch {
        // Ignore transient batch failures cleanly
      } finally {
        clearTimeout(timer);
      }
    })
  );

  return result;
}

export function resolveYahooTicker(symbol: string): string {
  const cleanSym = symbol.toUpperCase().trim();
  if (cleanSym === 'NIFTY50' || cleanSym === '^NSEI') return '^NSEI';
  if (cleanSym === 'BANKNIFTY' || cleanSym === '^NSEBANK') return '^NSEBANK';
  if (cleanSym === 'SENSEX' || cleanSym === '^BSESN') return '^BSESN';
  if (cleanSym === 'INDIAVIX' || cleanSym === '^INDIAVIX') return '^INDIAVIX';
  return cleanSym.endsWith('.NS') || cleanSym.startsWith('^') ? cleanSym : `${cleanSym}.NS`;
}

export async function fetchPublicNseCandles(
  symbol: string,
  timeframe: Timeframe | '1d',
  customRange?: string
): Promise<PublicCandleResult> {
  const cleanSym = symbol.toUpperCase().trim();
  const range =
    customRange ??
    (timeframe === '1m' ? '7d' : timeframe === '1d' ? '3y' : '60d');
  const key = `${cleanSym}_${timeframe}_${range}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const yahooTicker = resolveYahooTicker(cleanSym);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooTicker
  )}?interval=${timeframe}&range=${range}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) {
      throw new Error(`NSE public chart feed returned HTTP ${res.status} for ${yahooTicker}`);
    }
    const json = await res.json();
    const parsed = parseYahooChartResponse(cleanSym, json);
    cache.set(key, { fetchedAt: Date.now(), data: parsed });
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}


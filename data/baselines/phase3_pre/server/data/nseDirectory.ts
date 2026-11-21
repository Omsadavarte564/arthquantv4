import fs from 'node:fs';
import path from 'node:path';
import { NseDirectoryEntry, NseDirectoryResponse } from '../../src/types/trading.ts';
import { formatNowIst } from '../quant/riskEngine.ts';
import { STOCK_MAP, STOCK_UNIVERSE } from './nseUniverse.ts';
import { fetchPublicBatchQuotes } from './publicMarketFeed.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DIRECTORY_CACHE_FILE = path.join(DATA_DIR, 'nse-instruments.json');
const KITE_NSE_INSTRUMENTS_URL = 'https://api.kite.trade/instruments/NSE';

interface CachedDirectoryPayload {
  sourceName: string;
  sourceUrl: string;
  syncedAtIst: string;
  entries: NseDirectoryEntry[];
}

let memoryCache: CachedDirectoryPayload | null = null;

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function parseKiteNseCsv(csvText: string): NseDirectoryEntry[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const entries: NseDirectoryEntry[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    if (cols.length < 12) continue;

    const instrumentToken = cols[0].trim();
    const exchangeToken = cols[1].trim();
    const symbol = cols[2].trim().toUpperCase();
    const name = cols[3].trim() || symbol;
    const tickSize = Number(cols[7]) || 0.05;
    const lotSize = Number(cols[8]) || 1;
    const instrumentType = cols[9].trim().toUpperCase();
    const segment = cols[10].trim().toUpperCase();
    const exchange = cols[11].trim().toUpperCase();

    if (exchange !== 'NSE' || segment !== 'NSE' || instrumentType !== 'EQ' || !symbol) {
      continue;
    }
    if (seen.has(symbol)) continue;
    seen.add(symbol);

    const isStandardEquity = !symbol.includes('-') && !/^\d/.test(symbol);
    const meta = STOCK_MAP.get(symbol);

    entries.push({
      symbol,
      name: meta?.name || name,
      exchange: 'NSE',
      segment,
      instrumentType,
      instrumentToken,
      exchangeToken,
      tickSize: meta?.tickSize || tickSize,
      lotSize: meta?.lotSize || lotSize,
      isStandardEquity,
      hasResearchCandles: Boolean(meta),
      sector: meta?.sector,
    });
  }

  entries.sort((a, b) => {
    if (a.hasResearchCandles !== b.hasResearchCandles) {
      return a.hasResearchCandles ? -1 : 1;
    }
    if (a.isStandardEquity !== b.isStandardEquity) {
      return a.isStandardEquity ? -1 : 1;
    }
    return a.symbol.localeCompare(b.symbol);
  });

  return entries;
}

function buildBuiltinFallbackPayload(): CachedDirectoryPayload {
  return {
    sourceName: 'Built-in 24-Stock Quant Research Seed (Offline Fallback)',
    sourceUrl: 'local://server/data/nseUniverse.ts',
    syncedAtIst: formatNowIst(),
    entries: STOCK_UNIVERSE.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      exchange: 'NSE',
      segment: 'NSE',
      instrumentType: 'EQ',
      instrumentToken: '',
      exchangeToken: '',
      tickSize: s.tickSize,
      lotSize: s.lotSize,
      isStandardEquity: true,
      hasResearchCandles: true,
      sector: s.sector,
    })),
  };
}

function loadCachedDirectory(): CachedDirectoryPayload | null {
  if (memoryCache) return memoryCache;
  try {
    if (fs.existsSync(DIRECTORY_CACHE_FILE)) {
      const raw = fs.readFileSync(DIRECTORY_CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as CachedDirectoryPayload;
      if (Array.isArray(parsed.entries) && parsed.entries.length > 0) {
        memoryCache = parsed;
        return parsed;
      }
    }
  } catch {
    // ignore corrupt cache and refresh
  }
  return null;
}

export async function syncNseDirectory(): Promise<CachedDirectoryPayload> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(KITE_NSE_INSTRUMENTS_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ArthQuant-NSE-Directory/1.0' },
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching NSE instrument master`);
    }

    const csvText = await res.text();
    const entries = parseKiteNseCsv(csvText);
    if (entries.length < 100) {
      throw new Error('Parsed NSE master CSV contained too few equity records.');
    }

    const payload: CachedDirectoryPayload = {
      sourceName: 'Public NSE Instrument Master (Kite Instruments CSV)',
      sourceUrl: KITE_NSE_INSTRUMENTS_URL,
      syncedAtIst: formatNowIst(),
      entries,
    };

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DIRECTORY_CACHE_FILE, JSON.stringify(payload), 'utf-8');
    memoryCache = payload;
    return payload;
  } catch (err) {
    const existing = loadCachedDirectory();
    if (existing) {
      return existing;
    }
    throw err;
  }
}

export async function queryNseDirectory(params: {
  q?: string;
  scope?: 'clean' | 'all' | 'research';
  page?: number;
  limit?: number;
  watchlist?: Set<string>;
}): Promise<NseDirectoryResponse> {
  let payload = loadCachedDirectory();
  let syncWarning: string | undefined;

  if (!payload) {
    try {
      payload = await syncNseDirectory();
    } catch (err) {
      payload = buildBuiltinFallbackPayload();
      syncWarning =
        err instanceof Error
          ? `Live NSE master fetch unavailable (${err.message}); showing built-in 24-stock universe.`
          : 'Live NSE master fetch unavailable; showing built-in 24-stock universe.';
    }
  }

  const scope = params.scope || 'clean';
  const query = (params.q || '').trim().toUpperCase();
  const page = Math.max(1, Math.floor(params.page || 1));
  const limit = Math.max(10, Math.min(200, Math.floor(params.limit || 50)));
  const watchlist = params.watchlist || new Set<string>();

  const standardCount = payload.entries.filter((e) => e.isStandardEquity).length;
  const totalCashCount = payload.entries.length;
  const researchCount = payload.entries.filter((e) => e.hasResearchCandles).length;

  let filtered = payload.entries;
  if (scope === 'clean') {
    filtered = filtered.filter((e) => e.isStandardEquity);
  } else if (scope === 'research') {
    filtered = filtered.filter((e) => e.hasResearchCandles);
  }

  if (query) {
    filtered = filtered.filter(
      (e) =>
        e.symbol.includes(query) ||
        e.name.toUpperCase().includes(query) ||
        (e.sector ? e.sector.toUpperCase().includes(query) : false)
    );
  }

  const totalMatches = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalMatches / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;

  const pageSlice = filtered.slice(start, start + limit);
  const batchQuotes = await fetchPublicBatchQuotes(pageSlice.map((e) => e.symbol));

  const items = pageSlice.map((e) => {
    const q = batchQuotes[e.symbol];
    return {
      ...e,
      hasResearchCandles: STOCK_MAP.has(e.symbol),
      inWatchlist: watchlist.has(e.symbol),
      ltp: q?.ltp,
      changePct: q?.changePct,
    };
  });

  return {
    sourceName: payload.sourceName,
    sourceUrl: payload.sourceUrl,
    syncedAtIst: payload.syncedAtIst,
    syncWarning,
    counts: {
      standardEquities: standardCount,
      totalCashInstruments: totalCashCount,
      researchUniverse: researchCount,
    },
    scope,
    page: safePage,
    limit,
    totalMatches,
    totalPages,
    items,
  };
}

export async function findNseDirectoryEntry(symbol: string): Promise<NseDirectoryEntry | null> {
  const target = symbol.toUpperCase().trim();
  if (!target) return null;
  let payload = loadCachedDirectory();
  if (!payload) {
    try {
      payload = await syncNseDirectory();
    } catch {
      payload = buildBuiltinFallbackPayload();
    }
  }
  return payload.entries.find((e) => e.symbol === target) ?? null;
}

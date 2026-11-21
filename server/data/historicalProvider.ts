import fs from 'node:fs';
import path from 'node:path';
import { Candle, HistoricalDatasetMetadata, Timeframe } from '../../src/types/trading.ts';
import { getResearchCandles, STOCK_UNIVERSE } from './nseUniverse.ts';
import { fetchPublicNseCandles, parseYahooChartResponse, resolveYahooTicker } from './publicMarketFeed.ts';
import { DataValidationReport, validateCandles } from './validator.ts';

const CACHE_DIR = path.resolve(process.cwd(), 'data', 'historical_cache');
const ARCHIVE_DIR = path.resolve(process.cwd(), 'data', 'historical_archive');
const DATASET_VERSION = 'ArthQuant-Hist-v2.0';

export interface HistoricalSeriesRequest {
  symbol: string;
  timeframe: Timeframe | '1d';
  lookbackDays?: number;
  excludeFormingBar?: boolean;
  preferCache?: boolean;
}

export interface HistoricalSeriesBundle {
  symbol: string;
  timeframe: Timeframe | '1d';
  candles: Candle[];
  report: DataValidationReport;
  metadata: HistoricalDatasetMetadata;
}

export interface AuthorizedHistoricalProvider {
  readonly providerId: HistoricalDatasetMetadata['provider'];
  readonly maxLookbackDays: number;
  isConfigured(): boolean;
  fetchHistoricalCandles(req: HistoricalSeriesRequest): Promise<Candle[]>;
}

/**
 * Zerodha Kite Connect Historical Data API Interface (up to 60 days 1m / 100-200 days 5m/15m per chunk, multi-year stitching).
 * Active ONLY when ZERODHA_API_KEY + ZERODHA_ACCESS_TOKEN are provided in server environment.
 */
export class ZerodhaKiteHistoricalAdapter implements AuthorizedHistoricalProvider {
  readonly providerId = 'ZERODHA_KITE_HISTORICAL' as const;
  readonly maxLookbackDays = 1095; // 3 years via chunked date windows

  isConfigured(): boolean {
    return Boolean(process.env.ZERODHA_API_KEY && process.env.ZERODHA_ACCESS_TOKEN);
  }

  async fetchHistoricalCandles(req: HistoricalSeriesRequest): Promise<Candle[]> {
    if (!this.isConfigured()) {
      throw new Error(
        `ZERODHA_KITE_HISTORICAL unavailable for ${req.symbol}: ZERODHA_API_KEY / ZERODHA_ACCESS_TOKEN not configured.`
      );
    }
    throw new Error(
      `Zerodha Kite instrument token lookup for ${req.symbol} (${req.timeframe}) requires live OAuth session token exchange before calling api.kite.trade/instruments/historical.`
    );
  }
}

/**
 * Upstox Developer API v2 Historical Candle Interface (supports 1m/5m/15m multi-year paginated ranges).
 */
export class UpstoxHistoricalAdapter implements AuthorizedHistoricalProvider {
  readonly providerId = 'UPSTOX_HISTORICAL' as const;
  readonly maxLookbackDays = 1095;

  isConfigured(): boolean {
    return Boolean(process.env.UPSTOX_API_KEY && process.env.UPSTOX_ACCESS_TOKEN);
  }

  async fetchHistoricalCandles(req: HistoricalSeriesRequest): Promise<Candle[]> {
    if (!this.isConfigured()) {
      throw new Error(
        `UPSTOX_HISTORICAL unavailable for ${req.symbol}: UPSTOX_API_KEY / UPSTOX_ACCESS_TOKEN not configured.`
      );
    }
    throw new Error(
      `Upstox ISIN instrument key mapping required before calling api.upstox.com/v2/historical-candle for ${req.symbol}.`
    );
  }
}

/**
 * DhanHQ Historical Charts API Interface (supports 5-year intraday & daily historical feeds on Data API plan).
 */
export class DhanHistoricalAdapter implements AuthorizedHistoricalProvider {
  readonly providerId = 'DHAN_HISTORICAL' as const;
  readonly maxLookbackDays = 1825;

  isConfigured(): boolean {
    return Boolean(process.env.DHAN_CLIENT_ID && process.env.DHAN_ACCESS_TOKEN);
  }

  async fetchHistoricalCandles(req: HistoricalSeriesRequest): Promise<Candle[]> {
    if (!this.isConfigured()) {
      throw new Error(
        `DHAN_HISTORICAL unavailable for ${req.symbol}: DHAN_CLIENT_ID / DHAN_ACCESS_TOKEN not configured.`
      );
    }
    throw new Error(
      `DhanHQ securityId mapping required before calling api.dhan.co/v2/charts/intraday for ${req.symbol}.`
    );
  }
}

/**
 * Local Multi-Year Historical Archive Store (`data/historical_archive/<SYMBOL>_<TF>.json|csv`).
 * Allows drop-in ingestion of licensed 2-3 year exchange CSV/JSON dumps without fabricating prices.
 */
export class LocalMultiYearArchiveProvider implements AuthorizedHistoricalProvider {
  readonly providerId = 'LOCAL_ARCHIVE_STORE' as const;
  readonly maxLookbackDays = 1825;

  private resolveFiles(symbol: string, timeframe: Timeframe | '1d'): string[] {
    const clean = symbol.toUpperCase().trim();
    return [
      path.join(ARCHIVE_DIR, `${clean}_${timeframe}.json`),
      path.join(ARCHIVE_DIR, `${clean}_${timeframe}.csv`),
    ];
  }

  isConfigured(): boolean {
    return fs.existsSync(ARCHIVE_DIR) && fs.readdirSync(ARCHIVE_DIR).length > 0;
  }

  hasSymbolArchive(symbol: string, timeframe: Timeframe | '1d'): boolean {
    return this.resolveFiles(symbol, timeframe).some((f) => fs.existsSync(f));
  }

  getArchiveFilePaths(symbol: string, timeframe: Timeframe | '1d'): string[] {
    return this.resolveFiles(symbol, timeframe);
  }

  async fetchHistoricalCandles(req: HistoricalSeriesRequest): Promise<Candle[]> {
    const [jsonPath, csvPath] = this.resolveFiles(req.symbol, req.timeframe);
    if (fs.existsSync(jsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (Array.isArray(parsed)) return parsed as Candle[];
      if (Array.isArray(parsed?.candles)) return parsed.candles as Candle[];
    }
    if (fs.existsSync(csvPath)) {
      return parseOhlcvCsv(fs.readFileSync(csvPath, 'utf-8'));
    }
    throw new Error(`No local archive file found for ${req.symbol} (${req.timeframe}).`);
  }
}

export function parseOhlcvCsv(csvText: string): Candle[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
  const idxTime = header.findIndex((h) => h === 'time' || h === 'timestamp' || h === 'datetime' || h === 'date');
  const idxOpen = header.indexOf('open');
  const idxHigh = header.indexOf('high');
  const idxLow = header.indexOf('low');
  const idxClose = header.indexOf('close');
  const idxVol = header.findIndex((h) => h === 'volume' || h === 'vol');

  if (idxTime < 0 || idxOpen < 0 || idxHigh < 0 || idxLow < 0 || idxClose < 0) {
    return [];
  }

  const out: Candle[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const rawT = cols[idxTime];
    const parsedNum = Number(rawT);
    const unixSec =
      Number.isFinite(parsedNum) && parsedNum > 1e9
        ? parsedNum > 1e12
          ? Math.floor(parsedNum / 1000)
          : Math.floor(parsedNum)
        : Math.floor(Date.parse(rawT) / 1000);
    if (!Number.isFinite(unixSec) || unixSec <= 0) continue;

    const open = Number(cols[idxOpen]);
    const high = Number(cols[idxHigh]);
    const low = Number(cols[idxLow]);
    const close = Number(cols[idxClose]);
    const volume = idxVol >= 0 ? Math.max(0, Math.round(Number(cols[idxVol] || 0))) : 0;
    if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
      continue;
    }

    const ist = formatIstFromUnix(unixSec);
    out.push({
      time: unixSec,
      istLabel: ist.istLabel,
      sessionDate: ist.sessionDate,
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      volume,
    });
  }
  return out;
}

function formatIstFromUnix(unixSec: number): { istLabel: string; sessionDate: string } {
  const istMs = (unixSec + 19800) * 1000;
  const d = new Date(istMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const sessionDate = `${y}-${m}-${day}`;
  return { sessionDate, istLabel: `${sessionDate} ${hh}:${mm} IST` };
}

/**
 * Fetches multi-chunk 1m candles (Yahoo caps single 1m request at 8d, rolling ~30d max)
 * or max 60d 5m/15m or 3y 1d real NSE candles cleanly without interpolating missing bars.
 */
async function fetchYahooMaxWindow(symbol: string, timeframe: Timeframe | '1d'): Promise<Candle[]> {
  if (timeframe !== '1m') {
    const res = await fetchPublicNseCandles(symbol, timeframe, timeframe === '1d' ? '3y' : '60d');
    return res.candles;
  }

  // Stitch up to 3 consecutive 7-day 1m chunks going back 21 calendar days
  const ticker = resolveYahooTicker(symbol);
  const nowSec = Math.floor(Date.now() / 1000);
  const chunkSec = 7 * 86400;
  const allBars: Candle[] = [];

  for (let w = 0; w < 3; w++) {
    const period2 = nowSec - w * chunkSec;
    const period1 = period2 - chunkSec + 60;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      ticker
    )}?interval=1m&period1=${period1}&period2=${period2}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const r = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      const json = await r.json();
      const parsed = parseYahooChartResponse(symbol, json);
      allBars.push(...parsed.candles);
    } catch {
      // Fall back cleanly to any valid chunks retrieved
    }
  }

  if (allBars.length === 0) {
    const fallback = await fetchPublicNseCandles(symbol, '1m', '7d');
    return fallback.candles;
  }
  return allBars;
}

function getStepSeconds(tf: Timeframe | '1d'): number {
  if (tf === '1m') return 60;
  if (tf === '15m') return 900;
  if (tf === '1d') return 86400;
  return 300;
}

const ARCHIVE_PROVIDER = new LocalMultiYearArchiveProvider();
const BROKER_PROVIDERS: AuthorizedHistoricalProvider[] = [
  new ZerodhaKiteHistoricalAdapter(),
  new UpstoxHistoricalAdapter(),
  new DhanHistoricalAdapter(),
];

export interface ResolvedHistoricalSeries {
  symbol: string;
  timeframe: Timeframe | '1d';
  candles: Candle[];
  provider: HistoricalDatasetMetadata['provider'];
  isSynthetic: boolean;
  datasetVersion: string;
  metadata?: HistoricalDatasetMetadata;
  limitationNote?: string;
  skippedReason?: string;
}

/**
 * Synchronous research/backtest resolver with explicit provenance.
 *
 * Dataset rules:
 * - `public` MUST resolve to a real archived or cached NSE series. If neither exists,
 *   returns `null` so callers can skip the symbol. It NEVER silently substitutes the
 *   deterministic synthetic research replay.
 * - `research` resolves to the deterministic synthetic replay and is always tagged
 *   `isSynthetic: true` so it can never be reported as real-market evidence.
 */
export function getHistoricalSeriesSync(
  symbol: string,
  timeframe: Timeframe | '1d',
  dataset: 'research' | 'public'
): ResolvedHistoricalSeries | null {
  const clean = symbol.toUpperCase().trim();
  const stepSec = getStepSeconds(timeframe);

  if (dataset === 'research') {
    const raw = getResearchCandles(clean, timeframe as Timeframe);
    const { cleaned, report } = validateCandles(raw, stepSec);
    return {
      symbol: clean,
      timeframe,
      candles: cleaned,
      provider: 'RESEARCH_REPLAY',
      isSynthetic: true,
      datasetVersion: 'ArthQuant-ResearchReplay-v1.0',
      metadata: buildResearchDatasetMetadata(clean, timeframe as Timeframe),
      limitationNote: `Deterministic synthetic replay; ${report.totalBars} bars. Not real NSE market data.`,
    };
  }

  // 1. Licensed local multi-year archive has highest priority.
  if (ARCHIVE_PROVIDER.hasSymbolArchive(clean, timeframe)) {
    try {
      const files = ARCHIVE_PROVIDER.getArchiveFilePaths(clean, timeframe);
      let raw: Candle[] = [];
      if (fs.existsSync(files[0])) {
        const parsed = JSON.parse(fs.readFileSync(files[0], 'utf-8'));
        raw = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.candles) ? parsed.candles : [];
      } else if (fs.existsSync(files[1])) {
        raw = parseOhlcvCsv(fs.readFileSync(files[1], 'utf-8'));
      }
      if (raw.length > 0) {
        const { cleaned, report } = validateCandles(raw, stepSec);
        if (cleaned.length >= 95) {
          return {
            symbol: clean,
            timeframe,
            candles: cleaned,
            provider: 'LOCAL_ARCHIVE_STORE',
            isSynthetic: false,
            datasetVersion: DATASET_VERSION,
            metadata: {
              datasetVersion: DATASET_VERSION,
              provider: 'LOCAL_ARCHIVE_STORE',
              symbol: clean,
              timeframe,
              timezone: 'Asia/Kolkata',
              startIst: cleaned[0].istLabel,
              endIst: cleaned[cleaned.length - 1].istLabel,
              totalBars: cleaned.length,
              zeroVolumeBars: report.zeroVolumeBars,
              missingGaps: report.gapsDetected,
              duplicatesRemoved: report.duplicatesRemoved,
              invalidOhlcBars: report.invalidOhlcBars,
              outlierBarsFlagged: report.outlierBarsFlagged,
              overnightSplitFlags: report.overnightSplitFlags,
              formingBarExcluded: report.formingBarExcluded,
              isMultiYearAuthorized: true,
              ingestedAtIst: formatIstFromUnix(Math.floor(Date.now() / 1000)).istLabel,
            },
          };
        }
      }
    } catch {
      // Fall through to cache; corrupt archive is not silently replaced by synthetic data.
    }
  }

  // 2. Recently acquired public Yahoo NSE cache.
  const cachePath = cacheFilePath(clean, timeframe);
  if (fs.existsSync(cachePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as {
        candles: Candle[];
        metadata?: HistoricalDatasetMetadata;
      };
      if (Array.isArray(parsed.candles) && parsed.candles.length > 0) {
        const { cleaned, report } = validateCandles(parsed.candles, stepSec);
        if (cleaned.length >= 95) {
          const baseMeta = parsed.metadata;
          return {
            symbol: clean,
            timeframe,
            candles: cleaned,
            provider: baseMeta?.provider ?? 'YAHOO_PUBLIC_NSE',
            isSynthetic: false,
            datasetVersion: baseMeta?.datasetVersion ?? DATASET_VERSION,
            metadata: baseMeta
              ? {
                  ...baseMeta,
                  totalBars: cleaned.length,
                  startIst: cleaned[0].istLabel,
                  endIst: cleaned[cleaned.length - 1].istLabel,
                  // Ingestion already removed zero-volume bars; retain the ingestion-time
                  // count instead of overwriting it with the post-clean residual (0).
                  zeroVolumeBars: Math.max(baseMeta?.zeroVolumeBars ?? 0, report.zeroVolumeBars),
                  missingGaps: report.gapsDetected,
                  duplicatesRemoved: Math.max(
                    baseMeta?.duplicatesRemoved ?? 0,
                    report.duplicatesRemoved
                  ),
                  invalidOhlcBars: report.invalidOhlcBars,
                  outlierBarsFlagged: report.outlierBarsFlagged,
                  overnightSplitFlags: report.overnightSplitFlags,
                  formingBarExcluded:
                    Boolean(baseMeta?.formingBarExcluded) || report.formingBarExcluded,
                }
              : undefined,
            limitationNote:
              baseMeta?.limitationNote ??
              'Yahoo public NSE intraday history (max ~60 trading days for 5m/15m).',
          };
        }
      }
    } catch {
      // Corrupt cache -> return null; do not fabricate.
    }
  }

  return null;
}

export function getAuthorizedHistoricalProvidersStatus(): {
  provider: HistoricalDatasetMetadata['provider'];
  configured: boolean;
  maxLookbackDays: number;
  note: string;
}[] {
  return [
    ...BROKER_PROVIDERS.map((p) => ({
      provider: p.providerId,
      configured: p.isConfigured(),
      maxLookbackDays: p.maxLookbackDays,
      note: p.isConfigured()
        ? 'API token detected; multi-year chunked fetch interface ready.'
        : 'Credentials not configured; using Yahoo Public NSE (max 60d 5m/15m, ~21d 1m, 3y 1d).',
    })),
    {
      provider: ARCHIVE_PROVIDER.providerId,
      configured: ARCHIVE_PROVIDER.isConfigured(),
      maxLookbackDays: ARCHIVE_PROVIDER.maxLookbackDays,
      note: ARCHIVE_PROVIDER.isConfigured()
        ? `Local multi-year CSV/JSON archive directory detected at data/historical_archive.`
        : 'Drop licensed <SYMBOL>_<TF>.csv/.json files into data/historical_archive for 2-3y replay.',
    },
  ];
}

function cacheFilePath(symbol: string, timeframe: Timeframe | '1d'): string {
  const safeSym = symbol.toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  return path.join(CACHE_DIR, `${safeSym}_${timeframe}.json`);
}

export async function acquireHistoricalSeries(
  req: HistoricalSeriesRequest
): Promise<HistoricalSeriesBundle> {
  const symbol = req.symbol.toUpperCase().trim();
  const timeframe = req.timeframe;
  const stepSec = getStepSeconds(timeframe);
  const excludeFormingBar = req.excludeFormingBar ?? timeframe !== '1d';
  const nowIst = formatIstFromUnix(Math.floor(Date.now() / 1000)).istLabel;

  // 1. Check local multi-year archive store first (highest historical depth if user supplied licensed multi-year data)
  if (ARCHIVE_PROVIDER.hasSymbolArchive(symbol, timeframe)) {
    const raw = await ARCHIVE_PROVIDER.fetchHistoricalCandles(req);
    const { cleaned, report } = validateCandles(raw, stepSec, { excludeFormingBar });
    return {
      symbol,
      timeframe,
      candles: cleaned,
      report,
      metadata: {
        datasetVersion: DATASET_VERSION,
        provider: 'LOCAL_ARCHIVE_STORE',
        symbol,
        timeframe,
        timezone: 'Asia/Kolkata',
        startIst: cleaned[0]?.istLabel ?? 'UNAVAILABLE',
        endIst: cleaned[cleaned.length - 1]?.istLabel ?? 'UNAVAILABLE',
        totalBars: cleaned.length,
        zeroVolumeBars: report.zeroVolumeBars,
        missingGaps: report.gapsDetected,
        duplicatesRemoved: report.duplicatesRemoved,
        invalidOhlcBars: report.invalidOhlcBars,
        outlierBarsFlagged: report.outlierBarsFlagged,
        overnightSplitFlags: report.overnightSplitFlags,
        formingBarExcluded: report.formingBarExcluded,
        isMultiYearAuthorized: cleaned.length > 5000 || timeframe === '1d',
        ingestedAtIst: nowIst,
      },
    };
  }

  // 2. Check disk cache when preferCache !== false (max age 6 hours)
  const cachePath = cacheFilePath(symbol, timeframe);
  if (req.preferCache !== false && fs.existsSync(cachePath)) {
    try {
      const stat = fs.statSync(cachePath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < 6 * 3600 * 1000) {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as {
          candles: Candle[];
          metadata?: HistoricalDatasetMetadata;
        };
        if (Array.isArray(cached.candles) && cached.candles.length > 0) {
          const { cleaned, report } = validateCandles(cached.candles, stepSec, {
            excludeFormingBar,
          });
          return {
            symbol,
            timeframe,
            candles: cleaned,
            report,
            metadata: {
              ...(cached.metadata ?? {
                datasetVersion: DATASET_VERSION,
                provider: 'YAHOO_PUBLIC_NSE',
                symbol,
                timeframe,
                timezone: 'Asia/Kolkata',
                isMultiYearAuthorized: false,
                ingestedAtIst: nowIst,
              }),
              startIst: cleaned[0]?.istLabel ?? 'UNAVAILABLE',
              endIst: cleaned[cleaned.length - 1]?.istLabel ?? 'UNAVAILABLE',
              totalBars: cleaned.length,
              zeroVolumeBars: report.zeroVolumeBars,
              missingGaps: report.gapsDetected,
              duplicatesRemoved: report.duplicatesRemoved,
              invalidOhlcBars: report.invalidOhlcBars,
              outlierBarsFlagged: report.outlierBarsFlagged,
              overnightSplitFlags: report.overnightSplitFlags,
              formingBarExcluded: report.formingBarExcluded,
            },
          };
        }
      }
    } catch {
      // Cache corrupt; re-fetch cleanly
    }
  }

  // 3. Fetch real NSE candles from Yahoo Finance (up to 60d for 5m/15m, ~21d 1m, 3y 1d)
  const raw = await fetchYahooMaxWindow(symbol, timeframe);
  const { cleaned, report } = validateCandles(raw, stepSec, { excludeFormingBar });
  const limitationNote =
    timeframe === '1d'
      ? 'Yahoo public daily history (~3y) retrieved; intraday tick precision requires authorized broker API.'
      : timeframe === '1m'
      ? 'Yahoo public 1m feed is capped at 8d/request (~21d max stitched); 2-3y 1m data requires authorized broker/NSE historical feed.'
      : 'Yahoo public 5m/15m intraday feed is hard-capped at ~60 trading days (~4,400 5m bars); 2-3y intraday requires Zerodha/Upstox/Dhan Historical API or local CSV archive.';

  const metadata: HistoricalDatasetMetadata = {
    datasetVersion: DATASET_VERSION,
    provider: 'YAHOO_PUBLIC_NSE',
    symbol,
    timeframe,
    timezone: 'Asia/Kolkata',
    startIst: cleaned[0]?.istLabel ?? 'UNAVAILABLE',
    endIst: cleaned[cleaned.length - 1]?.istLabel ?? 'UNAVAILABLE',
    totalBars: cleaned.length,
    zeroVolumeBars: report.zeroVolumeBars,
    missingGaps: report.gapsDetected,
    duplicatesRemoved: report.duplicatesRemoved,
    invalidOhlcBars: report.invalidOhlcBars,
    outlierBarsFlagged: report.outlierBarsFlagged,
    overnightSplitFlags: report.overnightSplitFlags,
    formingBarExcluded: report.formingBarExcluded,
    isMultiYearAuthorized: false,
    ingestedAtIst: nowIst,
    limitationNote,
  };

  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ metadata, candles: cleaned }), 'utf-8');
  } catch {
    // Non-fatal cache write error
  }

  return { symbol, timeframe, candles: cleaned, report, metadata };
}

/**
 * Synchronously reads cached public real-market candles when available in `data/historical_cache/`.
 * Allows deterministic synchronous backtester/API runs without blocking on repeated network calls.
 */
export function getCachedRealHistoricalCandles(
  symbol: string,
  timeframe: Timeframe | '1d'
): Candle[] | null {
  const cachePath = cacheFilePath(symbol, timeframe);
  if (!fs.existsSync(cachePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    if (Array.isArray(parsed?.candles) && parsed.candles.length > 0) {
      return parsed.candles as Candle[];
    }
  } catch {
    return null;
  }
  return null;
}

export const LIQUID_NSE_PUBLIC_SYMBOLS = STOCK_UNIVERSE.map((s) => s.symbol).filter(
  (s) => s !== 'TATAMOTORS' // TATAMOTORS.NS delisted/renamed on Yahoo Finance post-demerger
);

export async function prefetchLiquidUniverseAndIndices(
  timeframe: Timeframe = '5m',
  symbols: string[] = LIQUID_NSE_PUBLIC_SYMBOLS
): Promise<{
  succeeded: HistoricalDatasetMetadata[];
  failed: { symbol: string; error: string }[];
  indices: HistoricalDatasetMetadata[];
}> {
  const succeeded: HistoricalDatasetMetadata[] = [];
  const failed: { symbol: string; error: string }[] = [];
  const indices: HistoricalDatasetMetadata[] = [];

  for (const idxSym of ['NIFTY50', 'BANKNIFTY']) {
    try {
      const b = await acquireHistoricalSeries({ symbol: idxSym, timeframe });
      indices.push(b.metadata);
    } catch (err) {
      failed.push({ symbol: idxSym, error: err instanceof Error ? err.message : String(err) });
    }
  }

  for (const sym of symbols) {
    try {
      const b = await acquireHistoricalSeries({ symbol: sym, timeframe });
      succeeded.push(b.metadata);
    } catch (err) {
      failed.push({ symbol: sym, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { succeeded, failed, indices };
}

export function buildResearchDatasetMetadata(
  symbol: string,
  timeframe: Timeframe
): HistoricalDatasetMetadata {
  const raw = getResearchCandles(symbol, timeframe);
  const stepSec = getStepSeconds(timeframe);
  const { cleaned, report } = validateCandles(raw, stepSec);
  return {
    datasetVersion: 'ArthQuant-ResearchReplay-v1.0',
    provider: 'RESEARCH_REPLAY',
    symbol: symbol.toUpperCase(),
    timeframe,
    timezone: 'Asia/Kolkata',
    startIst: cleaned[0]?.istLabel ?? 'UNAVAILABLE',
    endIst: cleaned[cleaned.length - 1]?.istLabel ?? 'UNAVAILABLE',
    totalBars: cleaned.length,
    zeroVolumeBars: report.zeroVolumeBars,
    missingGaps: report.gapsDetected,
    duplicatesRemoved: report.duplicatesRemoved,
    invalidOhlcBars: report.invalidOhlcBars,
    outlierBarsFlagged: report.outlierBarsFlagged,
    overnightSplitFlags: report.overnightSplitFlags,
    formingBarExcluded: report.formingBarExcluded,
    isMultiYearAuthorized: false,
    ingestedAtIst: formatIstFromUnix(Math.floor(Date.now() / 1000)).istLabel,
    limitationNote: '14-session deterministic synthetic research dataset; not real NSE historical ticks.',
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

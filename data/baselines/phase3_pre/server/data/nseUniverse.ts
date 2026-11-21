import { Candle, StockMetadata, Timeframe } from '../../src/types/trading.ts';

export const NSE_HOLIDAYS_2026 = new Set<string>([
  '2026-01-26',
  '2026-03-03',
  '2026-03-26',
  '2026-03-31',
  '2026-04-03',
  '2026-04-14',
  '2026-05-01',
  '2026-08-15',
  '2026-09-14',
  '2026-10-02',
  '2026-10-20',
  '2026-11-09',
  '2026-11-24',
  '2026-12-25',
]);

interface InternalStockSeed extends StockMetadata {
  basePrice: number;
  dailyVolPct: number;
  trendBias: number;
  sessionProfile: 'TREND' | 'MEAN_REVERT' | 'BREAKOUT' | 'MIXED';
}

const STOCK_SEEDS: InternalStockSeed[] = [
  {
    symbol: 'RELIANCE',
    name: 'Reliance Industries Ltd',
    exchange: 'NSE',
    sector: 'Energy & Petrochemicals',
    marketCapCr: 1984200,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 9400000,
    beta: 1.08,
    peRatio: 27.4,
    roePct: 9.8,
    institutionalHoldingPct: 38.4,
    basePrice: 1465,
    dailyVolPct: 1.45,
    trendBias: 0.00018,
    sessionProfile: 'TREND',
  },
  {
    symbol: 'TCS',
    name: 'Tata Consultancy Services Ltd',
    exchange: 'NSE',
    sector: 'IT Services',
    marketCapCr: 1492000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 2800000,
    beta: 0.78,
    peRatio: 29.8,
    roePct: 51.2,
    institutionalHoldingPct: 24.6,
    basePrice: 4120,
    dailyVolPct: 1.15,
    trendBias: 0.0001,
    sessionProfile: 'MEAN_REVERT',
  },
  {
    symbol: 'HDFCBANK',
    name: 'HDFC Bank Ltd',
    exchange: 'NSE',
    sector: 'Banking & Finance',
    marketCapCr: 1328500,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 18500000,
    beta: 1.02,
    peRatio: 19.2,
    roePct: 16.4,
    institutionalHoldingPct: 68.2,
    basePrice: 1742,
    dailyVolPct: 1.25,
    trendBias: 0.00014,
    sessionProfile: 'TREND',
  },
  {
    symbol: 'ICICIBANK',
    name: 'ICICI Bank Ltd',
    exchange: 'NSE',
    sector: 'Banking & Finance',
    marketCapCr: 912000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 14200000,
    beta: 1.11,
    peRatio: 19.8,
    roePct: 18.7,
    institutionalHoldingPct: 72.1,
    basePrice: 1295,
    dailyVolPct: 1.35,
    trendBias: 0.00022,
    sessionProfile: 'BREAKOUT',
  },
  {
    symbol: 'INFY',
    name: 'Infosys Ltd',
    exchange: 'NSE',
    sector: 'IT Services',
    marketCapCr: 764000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 7600000,
    beta: 0.89,
    peRatio: 26.5,
    roePct: 31.8,
    institutionalHoldingPct: 54.0,
    basePrice: 1848,
    dailyVolPct: 1.4,
    trendBias: -0.00008,
    sessionProfile: 'MIXED',
  },
  {
    symbol: 'SBIN',
    name: 'State Bank of India',
    exchange: 'NSE',
    sector: 'Banking & Finance',
    marketCapCr: 742000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 16900000,
    beta: 1.24,
    peRatio: 10.6,
    roePct: 17.9,
    institutionalHoldingPct: 34.8,
    basePrice: 832,
    dailyVolPct: 1.7,
    trendBias: 0.0002,
    sessionProfile: 'BREAKOUT',
  },
  {
    symbol: 'BHARTIARTL',
    name: 'Bharti Airtel Ltd',
    exchange: 'NSE',
    sector: 'Telecom',
    marketCapCr: 938000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 6400000,
    beta: 0.92,
    peRatio: 44.2,
    roePct: 14.5,
    institutionalHoldingPct: 43.2,
    basePrice: 1648,
    dailyVolPct: 1.42,
    trendBias: 0.00025,
    sessionProfile: 'TREND',
  },
  {
    symbol: 'ITC',
    name: 'ITC Ltd',
    exchange: 'NSE',
    sector: 'FMCG',
    marketCapCr: 615000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 13500000,
    beta: 0.68,
    peRatio: 28.4,
    roePct: 28.6,
    institutionalHoldingPct: 55.4,
    basePrice: 492,
    dailyVolPct: 0.98,
    trendBias: 0.00006,
    sessionProfile: 'MEAN_REVERT',
  },
  {
    symbol: 'LT',
    name: 'Larsen & Toubro Ltd',
    exchange: 'NSE',
    sector: 'Infrastructure & Capital Goods',
    marketCapCr: 498000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 3100000,
    beta: 1.15,
    peRatio: 34.1,
    roePct: 15.2,
    institutionalHoldingPct: 58.6,
    basePrice: 3625,
    dailyVolPct: 1.55,
    trendBias: 0.00016,
    sessionProfile: 'TREND',
  },
  {
    symbol: 'AXISBANK',
    name: 'Axis Bank Ltd',
    exchange: 'NSE',
    sector: 'Banking & Finance',
    marketCapCr: 368000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 9800000,
    beta: 1.18,
    peRatio: 13.8,
    roePct: 16.9,
    institutionalHoldingPct: 75.4,
    basePrice: 1188,
    dailyVolPct: 1.5,
    trendBias: 0.00012,
    sessionProfile: 'MIXED',
  },
  {
    symbol: 'KOTAKBANK',
    name: 'Kotak Mahindra Bank Ltd',
    exchange: 'NSE',
    sector: 'Banking & Finance',
    marketCapCr: 356000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 5900000,
    beta: 0.96,
    peRatio: 18.4,
    roePct: 14.1,
    institutionalHoldingPct: 56.2,
    basePrice: 1794,
    dailyVolPct: 1.32,
    trendBias: -0.00005,
    sessionProfile: 'MEAN_REVERT',
  },
  {
    symbol: 'TATAMOTORS',
    name: 'Tata Motors Ltd',
    exchange: 'NSE',
    sector: 'Automobiles',
    marketCapCr: 338000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 15400000,
    beta: 1.42,
    peRatio: 11.4,
    roePct: 24.8,
    institutionalHoldingPct: 36.1,
    basePrice: 918,
    dailyVolPct: 2.05,
    trendBias: 0.00019,
    sessionProfile: 'BREAKOUT',
  },
  {
    symbol: 'SUNPHARMA',
    name: 'Sun Pharmaceutical Industries Ltd',
    exchange: 'NSE',
    sector: 'Pharma & Healthcare',
    marketCapCr: 446000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 2900000,
    beta: 0.65,
    peRatio: 39.6,
    roePct: 16.8,
    institutionalHoldingPct: 37.5,
    basePrice: 1862,
    dailyVolPct: 1.18,
    trendBias: 0.00015,
    sessionProfile: 'TREND',
  },
  {
    symbol: 'MARUTI',
    name: 'Maruti Suzuki India Ltd',
    exchange: 'NSE',
    sector: 'Automobiles',
    marketCapCr: 388000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 620000,
    beta: 0.88,
    peRatio: 26.2,
    roePct: 15.9,
    institutionalHoldingPct: 35.8,
    basePrice: 12340,
    dailyVolPct: 1.28,
    trendBias: 0.00009,
    sessionProfile: 'MEAN_REVERT',
  },
  {
    symbol: 'TITAN',
    name: 'Titan Company Ltd',
    exchange: 'NSE',
    sector: 'Consumer Discretionary',
    marketCapCr: 312000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 1850000,
    beta: 0.94,
    peRatio: 82.4,
    roePct: 32.1,
    institutionalHoldingPct: 29.4,
    basePrice: 3510,
    dailyVolPct: 1.48,
    trendBias: -0.00004,
    sessionProfile: 'MIXED',
  },
  {
    symbol: 'BAJFINANCE',
    name: 'Bajaj Finance Ltd',
    exchange: 'NSE',
    sector: 'Banking & Finance',
    marketCapCr: 432000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 1600000,
    beta: 1.31,
    peRatio: 28.9,
    roePct: 21.4,
    institutionalHoldingPct: 35.9,
    basePrice: 6980,
    dailyVolPct: 1.85,
    trendBias: 0.00017,
    sessionProfile: 'BREAKOUT',
  },
  {
    symbol: 'HCLTECH',
    name: 'HCL Technologies Ltd',
    exchange: 'NSE',
    sector: 'IT Services',
    marketCapCr: 492000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 3400000,
    beta: 0.85,
    peRatio: 28.2,
    roePct: 23.6,
    institutionalHoldingPct: 33.7,
    basePrice: 1815,
    dailyVolPct: 1.3,
    trendBias: 0.00014,
    sessionProfile: 'TREND',
  },
  {
    symbol: 'WIPRO',
    name: 'Wipro Ltd',
    exchange: 'NSE',
    sector: 'IT Services',
    marketCapCr: 294000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 7100000,
    beta: 0.91,
    peRatio: 24.5,
    roePct: 15.1,
    institutionalHoldingPct: 18.2,
    basePrice: 562,
    dailyVolPct: 1.38,
    trendBias: 0.00005,
    sessionProfile: 'MEAN_REVERT',
  },
  {
    symbol: 'ADANIENT',
    name: 'Adani Enterprises Ltd',
    exchange: 'NSE',
    sector: 'Metals & Diversified',
    marketCapCr: 342000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 4800000,
    beta: 1.78,
    peRatio: 64.2,
    roePct: 10.4,
    institutionalHoldingPct: 19.8,
    basePrice: 2965,
    dailyVolPct: 2.55,
    trendBias: 0.00021,
    sessionProfile: 'BREAKOUT',
  },
  {
    symbol: 'NTPC',
    name: 'NTPC Ltd',
    exchange: 'NSE',
    sector: 'Energy & Power',
    marketCapCr: 394000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 14800000,
    beta: 0.98,
    peRatio: 18.8,
    roePct: 13.2,
    institutionalHoldingPct: 43.1,
    basePrice: 406,
    dailyVolPct: 1.44,
    trendBias: 0.00019,
    sessionProfile: 'TREND',
  },
  {
    symbol: 'POWERGRID',
    name: 'Power Grid Corporation of India',
    exchange: 'NSE',
    sector: 'Energy & Power',
    marketCapCr: 308000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 12100000,
    beta: 0.82,
    peRatio: 19.4,
    roePct: 18.5,
    institutionalHoldingPct: 41.2,
    basePrice: 331,
    dailyVolPct: 1.22,
    trendBias: 0.00011,
    sessionProfile: 'MEAN_REVERT',
  },
  {
    symbol: 'ONGC',
    name: 'Oil & Natural Gas Corporation',
    exchange: 'NSE',
    sector: 'Energy & Power',
    marketCapCr: 356000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 18200000,
    beta: 1.19,
    peRatio: 7.8,
    roePct: 14.9,
    institutionalHoldingPct: 27.6,
    basePrice: 283,
    dailyVolPct: 1.68,
    trendBias: -0.00007,
    sessionProfile: 'MIXED',
  },
  {
    symbol: 'COALINDIA',
    name: 'Coal India Ltd',
    exchange: 'NSE',
    sector: 'Metals & Mining',
    marketCapCr: 292000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 11200000,
    beta: 1.05,
    peRatio: 8.6,
    roePct: 42.3,
    institutionalHoldingPct: 31.4,
    basePrice: 474,
    dailyVolPct: 1.52,
    trendBias: 0.00013,
    sessionProfile: 'TREND',
  },
  {
    symbol: 'TATASTEEL',
    name: 'Tata Steel Ltd',
    exchange: 'NSE',
    sector: 'Metals & Mining',
    marketCapCr: 194000,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 36500000,
    beta: 1.48,
    peRatio: 24.1,
    roePct: 7.4,
    institutionalHoldingPct: 39.2,
    basePrice: 155.4,
    dailyVolPct: 2.1,
    trendBias: 0.00015,
    sessionProfile: 'BREAKOUT',
  },
];

export const STOCK_UNIVERSE: StockMetadata[] = STOCK_SEEDS.map(
  ({ basePrice: _bp, dailyVolPct: _dv, trendBias: _tb, sessionProfile: _sp, ...meta }) => meta
);

export const STOCK_MAP = new Map<string, InternalStockSeed>(
  STOCK_SEEDS.map((s) => [s.symbol, s])
);

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundToTick(price: number, tickSize = 0.05): number {
  const rounded = Math.round(price / tickSize) * tickSize;
  return Math.round(rounded * 100) / 100;
}

export const BENCHMARK_SYMBOLS = new Set(['NIFTY50', 'BANKNIFTY', 'SENSEX']);

export function isValidSymbol(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  return STOCK_MAP.has(upper) || BENCHMARK_SYMBOLS.has(upper);
}

export function getNseMarketClockStatus(nowMs = Date.now()): {
  isMarketOpen: boolean;
  istTimeLabel: string;
  istDate: string;
  marketStatusLabel: 'OPEN' | 'PRE_OPEN' | 'MARKET_CLOSED';
  reason: string;
} {
  const ist = new Date(nowMs + 19800 * 1000);
  const istDate = ist.toISOString().slice(0, 10);
  const hhmm = ist.toISOString().slice(11, 16);
  const dow = ist.getUTCDay();

  if (dow === 0 || dow === 6) {
    return {
      isMarketOpen: false,
      istTimeLabel: `${istDate} ${hhmm} IST`,
      istDate,
      marketStatusLabel: 'MARKET_CLOSED',
      reason: 'Weekend (NSE/BSE equity cash market closed)',
    };
  }
  if (NSE_HOLIDAYS_2026.has(istDate)) {
    return {
      isMarketOpen: false,
      istTimeLabel: `${istDate} ${hhmm} IST`,
      istDate,
      marketStatusLabel: 'MARKET_CLOSED',
      reason: `NSE Trading Holiday (${istDate})`,
    };
  }
  if (hhmm >= '09:00' && hhmm < '09:15') {
    return {
      isMarketOpen: false,
      istTimeLabel: `${istDate} ${hhmm} IST`,
      istDate,
      marketStatusLabel: 'PRE_OPEN',
      reason: 'NSE Pre-Open Call Auction (09:00–09:15 IST)',
    };
  }
  if (hhmm >= '09:15' && hhmm <= '15:30') {
    return {
      isMarketOpen: true,
      istTimeLabel: `${istDate} ${hhmm} IST`,
      istDate,
      marketStatusLabel: 'OPEN',
      reason: 'Normal NSE Cash Equity Session (09:15–15:30 IST)',
    };
  }
  return {
    isMarketOpen: false,
    istTimeLabel: `${istDate} ${hhmm} IST`,
    istDate,
    marketStatusLabel: 'MARKET_CLOSED',
    reason: 'Outside NSE Cash Equity Hours (09:15–15:30 IST)',
  };
}

function formatIstLabel(unixSec: number): { label: string; sessionDate: string; minuteOfDay: number } {
  const istMs = (unixSec + 19800) * 1000; // +05:30
  const d = new Date(istMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return {
    label: `${y}-${m}-${day} ${hh}:${mm} IST`,
    sessionDate: `${y}-${m}-${day}`,
    minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

function getRecentTradingDates(count: number): string[] {
  const dates: string[] = [];
  // Anchor ending on 2026-11-18 IST
  let cursor = new Date(Date.UTC(2026, 10, 18, 0, 0, 0));
  while (dates.length < count) {
    const dow = cursor.getUTCDay();
    const iso = cursor.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !NSE_HOLIDAYS_2026.has(iso)) {
      dates.unshift(iso);
    }
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return dates;
}

const CANDLE_CACHE = new Map<string, Candle[]>();

export function getResearchCandles(symbol: string, timeframe: Timeframe = '5m'): Candle[] {
  const upper = symbol.toUpperCase();
  const cacheKey = `${upper}:${timeframe}`;
  const cached = CANDLE_CACHE.get(cacheKey);
  if (cached) return cached;

  const seed = STOCK_MAP.get(upper) ?? {
    symbol: upper,
    name: upper,
    exchange: 'NSE' as const,
    sector: 'Index',
    marketCapCr: 0,
    lotSize: 1,
    tickSize: 0.05,
    avgDailyVolume: 50000000,
    beta: 1,
    peRatio: 22,
    roePct: 16,
    institutionalHoldingPct: 50,
    basePrice: upper === 'NIFTY50' ? 24380 : upper === 'BANKNIFTY' ? 51920 : 80140,
    dailyVolPct: upper === 'BANKNIFTY' ? 1.15 : 0.85,
    trendBias: 0.00012,
    sessionProfile: 'TREND' as const,
  };

  // Generate 5m base bars across 14 trading days (1050 bars), then resample or subdivide
  const tradingDays = getRecentTradingDates(14);
  const rng = createMulberry32(hashString(`ARTHQUANT_2026_${upper}`));
  const candles5m: Candle[] = [];

  let price = seed.basePrice;
  const barVolSigma = (seed.dailyVolPct / 100) / Math.sqrt(75);
  const avg5mVol = seed.avgDailyVolume / 75;

  for (let dIdx = 0; dIdx < tradingDays.length; dIdx++) {
    const dateStr = tradingDays[dIdx];
    const [yr, mo, dy] = dateStr.split('-').map(Number);
    // 09:15 IST in UTC seconds = 03:45 UTC
    const sessionStartUtc = Math.floor(Date.UTC(yr, mo - 1, dy, 3, 45, 0) / 1000);

    // Deterministic day regime wave so every stock experiences Trend, Mean-Revert, and Breakout sessions
    const dayRoll = rng();
    const dayTrendDir =
      seed.sessionProfile === 'TREND'
        ? dIdx % 3 === 2 ? -1 : 1
        : seed.sessionProfile === 'BREAKOUT'
        ? dIdx % 2 === 0 ? 1 : -1
        : dayRoll > 0.48 ? 1 : -1;

    const isSidewaysDay =
      seed.sessionProfile === 'MEAN_REVERT'
        ? dIdx % 3 !== 0
        : dIdx % 4 === 1;

    const isBreakoutDay =
      seed.sessionProfile === 'BREAKOUT'
        ? dIdx % 2 === 0
        : dIdx % 5 === 3;

    // Overnight gap bounded realistically
    const gap = (rng() - 0.49) * (seed.dailyVolPct / 100) * 0.45;
    price = roundToTick(price * (1 + gap), seed.tickSize);
    let sessionAnchor = price;
    let momentumState = 0;

    for (let b = 0; b < 75; b++) {
      const barTime = sessionStartUtc + b * 300;
      const ist = formatIstLabel(barTime);

      // U-shaped intraday volume profile (high 09:15-09:50 & 14:30-15:25)
      const uShape = b < 7 ? 2.1 - b * 0.14 : b > 60 ? 1.15 + (b - 60) * 0.07 : 0.72;
      const noise = (rng() + rng() + rng() - 1.5) * 1.15;

      let drift = seed.trendBias;
      if (isSidewaysDay) {
        // Mean-reverting pull back toward sessionAnchor
        const dev = (price - sessionAnchor) / sessionAnchor;
        drift += -dev * 0.18;
      } else if (isBreakoutDay && b >= 6 && b <= 24) {
        // Opening range expansion wave
        drift += dayTrendDir * barVolSigma * 0.55;
      } else {
        // Persistent institutional trend drift
        drift += dayTrendDir * barVolSigma * 0.24;
      }

      // Mild momentum autocorrelation + regime-consistent structure
      momentumState = 0.35 * momentumState + 0.65 * (drift + noise * barVolSigma);
      const ret = momentumState;

      const open = roundToTick(price, seed.tickSize);
      const close = roundToTick(Math.max(seed.tickSize * 10, open * (1 + ret)), seed.tickSize);

      const wickUp = Math.abs((rng() + 0.15) * barVolSigma * open * 0.65);
      const wickDown = Math.abs((rng() + 0.15) * barVolSigma * open * 0.65);

      const high = roundToTick(Math.max(open, close) + wickUp, seed.tickSize);
      const low = roundToTick(Math.max(seed.tickSize, Math.min(open, close) - wickDown), seed.tickSize);

      const volSpike = isBreakoutDay && b >= 6 && b <= 14 ? 1.85 : 1.0;
      const volume = Math.max(
        100,
        Math.round(avg5mVol * uShape * volSpike * (0.65 + rng() * 0.85))
      );

      candles5m.push({
        time: barTime,
        istLabel: ist.label,
        sessionDate: ist.sessionDate,
        open,
        high,
        low,
        close,
        volume,
      });

      price = close;
      sessionAnchor = sessionAnchor * 0.96 + close * 0.04;
    }
  }

  let result: Candle[];
  if (timeframe === '5m') {
    result = candles5m;
  } else if (timeframe === '15m') {
    result = resampleCandles(candles5m, 3, seed.tickSize);
  } else {
    // 1m derived deterministically from the last 4 days of 5m bars so volume/prices reconcile
    result = subdivideTo1m(candles5m.slice(-300), seed.tickSize, hashString(upper));
  }

  CANDLE_CACHE.set(cacheKey, result);
  return result;
}

function resampleCandles(bars: Candle[], factor: number, tickSize: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < bars.length; i += factor) {
    const chunk = bars.slice(i, i + factor);
    if (chunk.length === 0) continue;
    const open = chunk[0].open;
    const close = chunk[chunk.length - 1].close;
    const high = roundToTick(Math.max(...chunk.map((c) => c.high)), tickSize);
    const low = roundToTick(Math.min(...chunk.map((c) => c.low)), tickSize);
    const volume = chunk.reduce((acc, c) => acc + c.volume, 0);
    out.push({
      time: chunk[0].time,
      istLabel: chunk[0].istLabel,
      sessionDate: chunk[0].sessionDate,
      open,
      high,
      low,
      close,
      volume,
    });
  }
  return out;
}

function subdivideTo1m(bars5m: Candle[], tickSize: number, seedNum: number): Candle[] {
  const rng = createMulberry32(seedNum ^ 0x9e3779b9);
  const out: Candle[] = [];
  for (const bar of bars5m) {
    let cur = bar.open;
    const totalMove = bar.close - bar.open;
    for (let m = 0; m < 5; m++) {
      const subTime = bar.time + m * 60;
      const ist = formatIstLabel(subTime);
      const isLast = m === 4;
      const stepTarget = isLast
        ? bar.close
        : roundToTick(cur + totalMove / 5 + (rng() - 0.5) * (bar.high - bar.low) * 0.35, tickSize);
      const clampedClose = Math.min(bar.high, Math.max(bar.low, stepTarget));
      const subHigh = roundToTick(Math.min(bar.high, Math.max(cur, clampedClose) + rng() * (bar.high - bar.low) * 0.18), tickSize);
      const subLow = roundToTick(Math.max(bar.low, Math.min(cur, clampedClose) - rng() * (bar.high - bar.low) * 0.18), tickSize);
      out.push({
        time: subTime,
        istLabel: ist.label,
        sessionDate: ist.sessionDate,
        open: roundToTick(cur, tickSize),
        high: subHigh,
        low: subLow,
        close: roundToTick(clampedClose, tickSize),
        volume: Math.max(20, Math.round(bar.volume / 5 * (0.7 + rng() * 0.6))),
      });
      cur = clampedClose;
    }
  }
  return out;
}

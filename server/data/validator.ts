import { Candle } from '../../src/types/trading.ts';

export interface DataValidationReport {
  valid: boolean;
  totalBars: number;
  duplicatesRemoved: number;
  invalidOhlcBars: number;
  zeroVolumeBars: number;
  outlierBarsFlagged: number;
  overnightSplitFlags: number;
  gapsDetected: number;
  formingBarExcluded: boolean;
  formingBarIstLabel?: string;
  staleFeed: boolean;
  latestBarAgeSeconds: number;
  latestSourceTimestampIst: string;
  issues: string[];
}

function isRegularNseTradingTime(istLabel: string): boolean {
  const hhmm = istLabel.slice(11, 16);
  return hhmm >= '09:15' && hhmm <= '15:25';
}

/**
 * Validates OHLCV candle streams against timestamp monotonicity, duplicates,
 * OHLC integrity, zero-volume anomalies, abnormal spikes, corporate-action splits,
 * forming (incomplete) candles, session gaps, and feed freshness.
 * Never fabricates missing bars.
 */
export function validateCandles(
  candles: Candle[],
  expectedStepSec = 300,
  options: {
    enforceLiveFreshness?: boolean;
    maxStaleSeconds?: number;
    nowUnixSec?: number;
    excludeFormingBar?: boolean;
    /**
     * Exclude zero-volume bars traded during regular NSE hours from the cleaned series.
     * Zero-volume bars cannot be transacted and produce flat/stale OHLC prints that
     * contaminate EMA/VWAP/ATR and inflate apparent liquidity. Defaults to true so
     * every downstream indicator, label and fill path sees executable bars only.
     */
    excludeZeroVolumeBars?: boolean;
  } = {}
): {
  cleaned: Candle[];
  report: DataValidationReport;
} {
  const seen = new Set<number>();
  const cleaned: Candle[] = [];
  let duplicatesRemoved = 0;
  let invalidOhlcBars = 0;
  let zeroVolumeBars = 0;
  let outlierBarsFlagged = 0;
  let overnightSplitFlags = 0;
  let gapsDetected = 0;
  let formingBarExcluded = false;
  let formingBarIstLabel: string | undefined;
  const issues: string[] = [];

  const sorted = [...candles].sort((a, b) => a.time - b.time);

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    if (seen.has(c.time)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(c.time);

    if (
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close) ||
      c.open <= 0 ||
      c.high < Math.max(c.open, c.close) ||
      c.low > Math.min(c.open, c.close) ||
      c.volume < 0
    ) {
      invalidOhlcBars++;
      continue;
    }

    if (c.volume === 0 && isRegularNseTradingTime(c.istLabel)) {
      zeroVolumeBars++;
      if (options.excludeZeroVolumeBars !== false) {
        continue;
      }
    }

    const intrabarRangePct = (c.high - c.low) / Math.max(0.01, c.close);
    if (intrabarRangePct > 0.08) {
      outlierBarsFlagged++;
    }

    if (cleaned.length > 0) {
      const prev = cleaned[cleaned.length - 1];
      if (c.sessionDate === prev.sessionDate) {
        if (c.time - prev.time > expectedStepSec * 1.5) {
          gapsDetected++;
        }
        const barJumpPct = Math.abs(c.close - prev.close) / Math.max(0.01, prev.close);
        if (barJumpPct > 0.1) {
          outlierBarsFlagged++;
        }
      } else {
        const overnightJumpPct = Math.abs(c.open - prev.close) / Math.max(0.01, prev.close);
        if (overnightJumpPct > 0.15) {
          overnightSplitFlags++;
        }
      }
    }

    cleaned.push(c);
  }

  const nowSec = options.nowUnixSec ?? Math.floor(Date.now() / 1000);
  if (options.excludeFormingBar && cleaned.length > 1) {
    const last = cleaned[cleaned.length - 1];
    const barAge = nowSec - last.time;
    if (barAge >= 0 && barAge < expectedStepSec && isRegularNseTradingTime(last.istLabel)) {
      formingBarExcluded = true;
      formingBarIstLabel = last.istLabel;
      cleaned.pop();
    }
  }

  const latestBar = cleaned[cleaned.length - 1];
  const latestBarAgeSeconds = latestBar ? Math.max(0, nowSec - latestBar.time) : Number.MAX_SAFE_INTEGER;
  const maxStale = options.maxStaleSeconds ?? expectedStepSec * 2;
  const staleFeed = Boolean(options.enforceLiveFreshness && latestBarAgeSeconds > maxStale);

  if (duplicatesRemoved > 0) issues.push(`Removed ${duplicatesRemoved} duplicate timestamps`);
  if (invalidOhlcBars > 0) issues.push(`Filtered ${invalidOhlcBars} malformed OHLC bars`);
  if (zeroVolumeBars > 0) {
    issues.push(
      options.excludeZeroVolumeBars === false
        ? `Detected ${zeroVolumeBars} zero-volume bars during regular NSE hours (retained by request)`
        : `Excluded ${zeroVolumeBars} zero-volume bars during regular NSE hours`
    );
  }
  if (gapsDetected > 0) issues.push(`Detected ${gapsDetected} intraday session gaps`);
  if (outlierBarsFlagged > 0) issues.push(`Flagged ${outlierBarsFlagged} abnormal bar spike/range anomalies`);
  if (overnightSplitFlags > 0) issues.push(`Flagged ${overnightSplitFlags} >15% overnight gap/split discontinuities`);
  if (formingBarExcluded && formingBarIstLabel) {
    issues.push(`Excluded forming candle (${formingBarIstLabel}) from closed-bar inference`);
  }
  if (staleFeed) issues.push(`Stale live feed detected (${latestBarAgeSeconds}s > ${maxStale}s threshold)`);

  return {
    cleaned,
    report: {
      valid:
        cleaned.length > 0 &&
        !staleFeed &&
        invalidOhlcBars <= Math.max(1, Math.ceil(sorted.length * 0.005)),
      totalBars: cleaned.length,
      duplicatesRemoved,
      invalidOhlcBars,
      zeroVolumeBars,
      outlierBarsFlagged,
      overnightSplitFlags,
      gapsDetected,
      formingBarExcluded,
      formingBarIstLabel,
      staleFeed,
      latestBarAgeSeconds,
      latestSourceTimestampIst: latestBar?.istLabel ?? 'UNAVAILABLE',
      issues,
    },
  };
}

/**
 * One-off public NSE history prefetch used for verified real-data evaluation.
 * Writes reproducible metadata to data/historical_cache/ (provider, symbol,
 * timeframe, timezone, bar counts, gap/duplicate/zero-volume/split flags).
 *
 * Run: npx tsx data/baselines/phase3_post/prefetch.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { acquireHistoricalSeries } from '../../server/data/historicalProvider.ts';

const SYMBOLS_5M = [
  'RELIANCE',
  'TCS',
  'HDFCBANK',
  'INFY',
  'ICICIBANK',
  'SBIN',
  'AXISBANK',
  'LT',
  'NIFTY50',
  'BANKNIFTY',
];
const SYMBOLS_15M = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'NIFTY50', 'BANKNIFTY'];
const SYMBOLS_1M = ['RELIANCE', 'TCS', 'HDFCBANK'];

async function main() {
  const manifest: unknown[] = [];
  const jobs: { symbol: string; timeframe: '1m' | '5m' | '15m' }[] = [
    ...SYMBOLS_5M.map((symbol) => ({ symbol, timeframe: '5m' as const })),
    ...SYMBOLS_15M.map((symbol) => ({ symbol, timeframe: '15m' as const })),
    ...SYMBOLS_1M.map((symbol) => ({ symbol, timeframe: '1m' as const })),
  ];

  for (const job of jobs) {
    try {
      const bundle = await acquireHistoricalSeries({ ...job, preferCache: false });
      manifest.push({
        symbol: bundle.symbol,
        timeframe: bundle.timeframe,
        bars: bundle.candles.length,
        provider: bundle.metadata.provider,
        startIst: bundle.metadata.startIst,
        endIst: bundle.metadata.endIst,
        zeroVolumeBars: bundle.report.zeroVolumeBars,
        duplicatesRemoved: bundle.report.duplicatesRemoved,
        gapsDetected: bundle.report.gapsDetected,
        invalidOhlcBars: bundle.report.invalidOhlcBars,
        overnightSplitFlags: bundle.report.overnightSplitFlags,
        formingBarExcluded: bundle.report.formingBarExcluded,
        limitationNote: bundle.metadata.limitationNote ?? null,
      });
      console.log(`${job.symbol} ${job.timeframe}: ${bundle.candles.length} bars`);
    } catch (err) {
      manifest.push({ ...job, error: String(err) });
      console.error(`${job.symbol} ${job.timeframe}: FAILED ${String(err)}`);
    }
  }

  const outPath = path.resolve(process.cwd(), 'data', 'baselines', 'phase3_post', 'public_prefetch_manifest.json');
  fs.writeFileSync(outPath, JSON.stringify({ capturedAt: new Date().toISOString(), manifest }, null, 2), 'utf-8');
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

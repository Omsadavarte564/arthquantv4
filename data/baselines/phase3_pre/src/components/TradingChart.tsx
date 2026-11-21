import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  IChartApi,
  LineSeries,
  Time,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import { Candle, IndicatorPoint, TradingSignal } from '../types/trading';

interface TradingChartProps {
  candles: Candle[];
  indicators: IndicatorPoint[];
  darkMode: boolean;
  showEma: boolean;
  showVwap: boolean;
  showBollinger: boolean;
  showSupertrend: boolean;
  activeSignal?: TradingSignal | null;
}

export function TradingChart({
  candles,
  indicators,
  darkMode,
  showEma,
  showVwap,
  showBollinger,
  showSupertrend,
  activeSignal,
}: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || candles.length === 0) return;

    const bgColor = darkMode ? '#0F1623' : '#FFFFFF';
    const textColor = darkMode ? '#94A3B8' : '#475569';
    const gridColor = darkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(15, 23, 42, 0.06)';

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: bgColor },
        textColor,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      width: el.clientWidth,
      height: 440,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: gridColor,
      },
      rightPriceScale: {
        borderColor: gridColor,
      },
      crosshair: {
        mode: 1,
      },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#16A34A',
      downColor: '#DC2626',
      borderVisible: false,
      wickUpColor: '#16A34A',
      wickDownColor: '#DC2626',
    });

    // Offset timestamps by +19800s so Lightweight Charts axis labels read in IST
    const toIstTime = (t: number) => (t + 19800) as Time;

    candleSeries.setData(
      candles.map((c) => ({
        time: toIstTime(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    // Volume histogram at bottom 18%
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    volumeSeries.setData(
      candles.map((c) => ({
        time: toIstTime(c.time),
        value: c.volume,
        color: c.close >= c.open ? 'rgba(22, 163, 74, 0.35)' : 'rgba(220, 38, 38, 0.35)',
      }))
    );

    if (showVwap && indicators.length === candles.length) {
      const vwapSeries = chart.addSeries(LineSeries, {
        color: '#F59E0B',
        lineWidth: 2,
        title: 'VWAP',
      });
      vwapSeries.setData(indicators.map((ind) => ({ time: toIstTime(ind.time), value: ind.vwap })));
    }

    if (showEma && indicators.length === candles.length) {
      const ema9Series = chart.addSeries(LineSeries, {
        color: '#0EA5E9',
        lineWidth: 1,
        title: 'EMA 9',
      });
      ema9Series.setData(indicators.map((ind) => ({ time: toIstTime(ind.time), value: ind.ema9 })));

      const ema21Series = chart.addSeries(LineSeries, {
        color: '#A855F7',
        lineWidth: 1,
        title: 'EMA 21',
      });
      ema21Series.setData(indicators.map((ind) => ({ time: toIstTime(ind.time), value: ind.ema21 })));
    }

    if (showBollinger && indicators.length === candles.length) {
      const bbUp = chart.addSeries(LineSeries, {
        color: 'rgba(100, 116, 139, 0.6)',
        lineWidth: 1,
        lineStyle: 2,
        title: 'BB Upper',
      });
      bbUp.setData(indicators.map((ind) => ({ time: toIstTime(ind.time), value: ind.bbUpper })));

      const bbLow = chart.addSeries(LineSeries, {
        color: 'rgba(100, 116, 139, 0.6)',
        lineWidth: 1,
        lineStyle: 2,
        title: 'BB Lower',
      });
      bbLow.setData(indicators.map((ind) => ({ time: toIstTime(ind.time), value: ind.bbLower })));
    }

    if (showSupertrend && indicators.length === candles.length) {
      const stSeries = chart.addSeries(LineSeries, {
        color: '#14B8A6',
        lineWidth: 2,
        title: 'Supertrend',
      });
      stSeries.setData(
        indicators.map((ind) => ({ time: toIstTime(ind.time), value: ind.supertrend }))
      );
    }

    // Signal Entry / Stop-Loss / Target horizontal lines
    if (activeSignal && (activeSignal.direction === 'BUY' || activeSignal.direction === 'SELL')) {
      candleSeries.createPriceLine({
        price: activeSignal.entryPrice,
        color: '#0EA5E9',
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `Entry (${activeSignal.direction})`,
      });
      candleSeries.createPriceLine({
        price: activeSignal.stopLoss,
        color: '#DC2626',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Stop-Loss',
      });
      candleSeries.createPriceLine({
        price: activeSignal.target1,
        color: '#16A34A',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Target 1',
      });
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null;
    resizeObserver?.observe(el);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, indicators, darkMode, showEma, showVwap, showBollinger, showSupertrend, activeSignal]);

  if (candles.length === 0) {
    return (
      <div className="w-full h-[440px] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F1623] flex items-center justify-center text-xs text-slate-500">
        No OHLCV candle data available for the selected instrument and timeframe.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-[440px] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800"
    />
  );
}

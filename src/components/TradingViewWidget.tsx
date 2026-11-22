import React, { useEffect, useRef } from 'react';

interface TradingViewWidgetProps {
  symbol: string;
  darkMode: boolean;
  interval?: string;
}

function resolveTradingViewSymbol(rawSymbol: string): string {
  const s = rawSymbol.trim().toUpperCase();
  if (s === 'NIFTY' || s === 'NIFTY 50' || s === 'NIFTY50') return 'NSE:NIFTY';
  if (s === 'BANKNIFTY' || s === 'BANK NIFTY') return 'NSE:BANKNIFTY';
  if (s === 'SENSEX') return 'BSE:SENSEX';
  if (s.startsWith('NSE:') || s.startsWith('BSE:')) return s;
  return `NSE:${s}`;
}

export const TradingViewWidget: React.FC<TradingViewWidgetProps> = ({
  symbol,
  darkMode,
  interval = '5',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';

    const widgetInner = document.createElement('div');
    widgetInner.className = 'tradingview-widget-container__widget';
    widgetInner.style.height = '100%';
    widgetInner.style.width = '100%';
    container.appendChild(widgetInner);

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;

    const tvSymbol = resolveTradingViewSymbol(symbol);

    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: interval,
      timezone: 'Asia/Kolkata',
      theme: darkMode ? 'dark' : 'light',
      style: '1',
      locale: 'en',
      enable_publishing: false,
      hide_side_toolbar: false,
      allow_symbol_change: true,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    });

    container.appendChild(script);

    return () => {
      container.innerHTML = '';
    };
  }, [symbol, darkMode, interval]);

  return (
    <div className="w-full h-[540px] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
      <div
        className="tradingview-widget-container"
        ref={containerRef}
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  );
};

import { BrokerAdapterInfo } from '../../src/types/trading.ts';

/**
 * Returns truthful broker adapter readiness based strictly on server-side
 * environment variables. Live real-money execution remains locked unless
 * Static IP whitelisting, Exchange Algo ID, and OAuth/2FA sessions are verified.
 */
export function getBrokerAdaptersStatus(): BrokerAdapterInfo[] {
  const hasZerodha = Boolean(process.env.ZERODHA_API_KEY && process.env.ZERODHA_API_SECRET);
  const hasUpstox = Boolean(process.env.UPSTOX_API_KEY && process.env.UPSTOX_API_SECRET);
  const hasDhan = Boolean(process.env.DHAN_CLIENT_ID && process.env.DHAN_ACCESS_TOKEN);
  const hasAngel = Boolean(process.env.ANGELONE_API_KEY && process.env.ANGELONE_CLIENT_CODE);

  return [
    {
      id: 'zerodha',
      name: 'Zerodha Kite Connect',
      status: hasZerodha ? 'CONFIGURED_READY_FOR_OAUTH' : 'DISCONNECTED_CREDENTIALS_NOT_SET',
      liveExecutionEnabled: false,
      pricingSummary: '₹500/mo Connect tier (waived with ₹2,000+ monthly brokerage credits); ₹0 Personal order API without data',
      rateLimits: '10 req/s orders · 400 req/min · 5,000 orders/day · 3 historical req/s · 3 WebSockets',
      staticIpRequired: true,
      authFlow: 'OAuth + TOTP 2FA daily handshake (expires before next session)',
      algoTaggingRequired: true,
      complianceNotes: 'SEBI Feb 4, 2025 Circular requires Static IP registration in Kite Developer Console for all order APIs.',
    },
    {
      id: 'upstox',
      name: 'Upstox Developer API',
      status: hasUpstox ? 'CONFIGURED_READY_FOR_OAUTH' : 'DISCONNECTED_CREDENTIALS_NOT_SET',
      liveExecutionEnabled: false,
      pricingSummary: '₹0 Standard trading & market data API (Upstox Plus paid tier for expired F&O instruments)',
      rateLimits: '10 req/s standard orders (up to 50 req/s registered) · up to 50 req/s OHLC',
      staticIpRequired: true,
      authFlow: 'OAuth 2.0 + 2FA daily token',
      algoTaggingRequired: true,
      complianceNotes: 'Static IP whitelisting mandatory via Upstox developer portal for order placement.',
    },
    {
      id: 'dhan',
      name: 'Dhan (DhanHQ API)',
      status: hasDhan ? 'CONFIGURED_READY_FOR_OAUTH' : 'DISCONNECTED_CREDENTIALS_NOT_SET',
      liveExecutionEnabled: false,
      pricingSummary: '₹0 Trading APIs · ₹499 + GST/mo for real-time & 5-yr historical Data APIs',
      rateLimits: '10 req/s orders · 20 req/s non-trading · 1–5 req/s market data',
      staticIpRequired: true,
      authFlow: 'Access Token / OAuth daily rotation',
      algoTaggingRequired: true,
      complianceNotes: 'Mandatory Static IP mapping for order placement, modification, and cancellation.',
    },
    {
      id: 'angelone',
      name: 'Angel One SmartAPI',
      status: hasAngel ? 'CONFIGURED_READY_FOR_OAUTH' : 'DISCONNECTED_CREDENTIALS_NOT_SET',
      liveExecutionEnabled: false,
      pricingSummary: '₹0 Free SmartAPI including SDKs, historical candles, and WebSocket feeds',
      rateLimits: '10 req/s orders · 400–600 req/min · 5,000 orders/day · 50 symbols/quote req',
      staticIpRequired: true,
      authFlow: 'Client Code + MPIN + TOTP (tokens expire at midnight)',
      algoTaggingRequired: true,
      complianceNotes: 'Up to 5 static IPs can be bound per SmartAPI key per NSE/BSE guidelines.',
    },
  ];
}

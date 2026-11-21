# Broker Integration & Readiness (`BROKER_INTEGRATION.md`)

**Research Date:** November 18, 2026  
**Status:** Interface Implemented; **Live Real-Money Execution Locked by Default**

## 1. Indian Broker API Comparison

| Broker | Data Pricing | Trading API Pricing | Order Rate Limit | Static IP Mandatory | Auth & Session Expiry |
|---|---|---|---|---|---|
| **Zerodha Kite Connect** | ₹500/mo (waived with ₹2,000+ monthly brokerage credits) | ₹0 (Personal) / ₹500/mo (Connect) | 10 req/s, 400 req/min, 5,000/day | Yes (Order APIs) | OAuth + TOTP 2FA; expires daily |
| **Upstox Developer API** | ₹0 Standard (Upstox Plus for expired/extended feeds) | ₹0 | 10 req/s (up to 50 req/s registered) | Yes (Developer console) | OAuth 2.0 + 2FA; daily expiry |
| **Dhan (DhanHQ)** | ₹499 + GST/mo (Data APIs) | ₹0 | 10 req/s (Orders), 20 req/s (General) | Yes (Order modify/place/cancel) | Access Token / OAuth; daily rotation |
| **Angel One SmartAPI** | ₹0 (Free SmartAPI) | ₹0 | 10 req/s, 5,000/day | Yes (up to 5 static IPs) | Client code + MPIN + TOTP; expires midnight |

## 2. Decoupled Broker Adapter Interface
All brokers implement `IBrokerAdapter` (`authenticate`, `fetchQuote`, `fetchHistoricalCandles`, `placeOrder`, `cancelOrder`, `reconcilePositions`). Credentials live strictly in server-side environment secrets and are never serialized to the React frontend.

# Indian Regulatory & Compliance Research (`REGULATORY_COMPLIANCE.md`)

**Research Date:** November 18, 2026  
**Disclaimer:** This document is a technical compliance engineering analysis, **not legal advice or regulatory certification**. Live real-money execution in ArthQuant remains **disabled by default**.

## 1. Authoritative Framework: SEBI Retail Algorithmic Trading Circular (Feb 4, 2025)

- **Reference:** SEBI Circular No. `SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/0000013` (*"Safer participation of retail investors in Algorithmic trading"*, issued February 4, 2025), followed by NSE/BSE operational implementation standards through 2025–2026.
- **Sources:** `sebi.gov.in`, `nseindia.com`, official broker compliance notices (Zerodha Kite, Upstox, Dhan, Angel One).

## 2. Mandatory Technical Requirements for Live Broker Execution

1. **Mandatory Static IP Whitelisting:**
   - Retail API keys placing orders must bind to a registered **Static IPv4/IPv6** (1 primary + optional 1 backup static IP).
   - Orders arriving from unregistered cloud IPs (e.g., ephemeral serverless IPs without a static NAT gateway) are rejected by the broker/exchange.
   - *ArthQuant Requirement:* Cloud Run deployments must route outbound broker API traffic through a VPC Connector + Cloud NAT with a reserved Static External IP.
2. **Unique Exchange-Assigned Algo ID & Order Tagging:**
   - Every algorithmic order must carry an exchange-assigned **Algo ID** for audit traceability.
3. **10 Orders-Per-Second (OPS) Threshold & Registration:**
   - Self-coded/personal DIY APIs operating **below 10 OPS** still require Static IP binding and OAuth/2FA authentication, though exchange strategy registration differs from high-OPS or commercial/black-box algos.
   - Above 10 OPS, or when distributing strategies externally, formal exchange registration and broker empanelment are mandatory.
4. **White-Box vs. Black-Box Classification:**
   - **White-Box Algos:** Logic is fully transparent and inspectable by the user (all ArthQuant built-in strategies expose exact rules, indicators, and math).
   - **Black-Box Algos:** Proprietary hidden logic requires empanelment as an algo provider via the broker and appropriate SEBI Research Analyst (RA) / Investment Adviser (IA) registration where applicable.
5. **Authentication & Session Expiry:**
   - Mandatory OAuth + 2FA login; all active broker access tokens expire daily prior to the next trading session and must never be stored in browser `localStorage`.
6. **Kill Switch & Audit Logs:**
   - Both broker and client platform must enforce an immediate Kill Switch and retain immutable order/risk audit trails.

## 3. Product Positioning Distinction

- **Permitted Without RA/IA Registration:** Self-hosted personal decision-support tools, educational backtesting, paper trading simulators, and white-box quantitative analytics where the user configures and controls their own rules.
- **Restricted / Regulated Activities:** Providing personalized buy/sell tips for consideration (SEBI IA/RA regulations), advertising guaranteed returns or unverified win rates (explicitly prohibited by SEBI), or operating commercial black-box copy trading without exchange empanelment.

## 4. Unresolved Compliance Checklist Before Enabling Live Trading

- [ ] Provision static NAT egress IP and register with broker developer console.
- [ ] Obtain exchange Algo ID / broker API approval for automated equity cash orders.
- [ ] Verify whether user deployment qualifies as personal white-box (<10 OPS) or commercial distribution.
- [ ] Complete broker-specific TOTP/OAuth daily handshake and position reconciliation tests.

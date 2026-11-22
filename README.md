---
title: ArthQuant Terminal
emoji: 📈
colorFrom: blue
colorTo: indigo
sdk: gradio
sdk_version: 5.20.0
app_file: app.py
pinned: false
---

# ArthQuant — AI-Powered Quantitative Intraday Trading Platform for Indian Stock Markets

ArthQuant is a modular, research-backed quantitative trading terminal built for **NSE & BSE cash equity intraday trading**. It combines StockWise-style market intelligence, StrykeX-style no-code strategy composition, causal quantitative machine learning with probability calibration, no-lookahead event-driven backtesting with exact NSE statutory cost modeling, simulated paper trading, an independent deterministic risk-management gatekeeper, and SEBI-compliant broker integration readiness.

## Current System Mode & Truthfulness Notice

- **Market Data Mode:** `HISTORICAL_RESEARCH_DATASET` (Deterministic multi-session 1m/5m/15m NSE equity OHLCV dataset for 24 liquid NIFTY constituents + NIFTY 50, BANK NIFTY, SENSEX). Live exchange WebSocket feeds require an authorized broker subscription (Zerodha Kite Connect, DhanHQ, Upstox, or Angel One SmartAPI).
- **Execution Mode:** `SIMULATED_PAPER_TRADING` (Event-driven simulated order execution with persisted state). **Live real-money broker execution is locked by default** pending Static IP whitelisting, Exchange Algo ID registration, and SEBI Circular `SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/0000013` compliance verification.
- **70% Win-Rate Research Target:** Treated strictly as an empirical out-of-sample research objective, never fabricated or guaranteed. All backtest and ML results display sample sizes (`N`), net P&L after NSE statutory charges, profit factor, expectancy, and 95% Wilson score confidence intervals.

## Architecture Overview

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, TradingView Lightweight Charts (`lightweight-charts`), Recharts (`recharts`), Lucide Icons.
- **Backend:** Node.js + Express (`server.ts`) serving typed REST APIs (`/api/*`), persisted state store (`data/arthquant-state.json`), deterministic quantitative engine (`server/quant/`), and server-side Gemini AI explainability (`@google/genai`).
- **Python ML Offload Blueprint:** Documented FastAPI + LightGBM/XGBoost/PyTorch microservice interface (`ML_SERVICE_URL`) for large-scale multi-year tick training on Google Cloud Run.

## Quick Start

```bash
npm install
npm run dev      # Starts Express + Vite dev server on port 3000
npm run lint     # TypeScript type check
npm run test     # Runs unit & integration tests (tsx --test)
npm run build    # Production Vite build
```

## Documentation Index

See root and `/docs` files:
- `RESEARCH.md` — Platform, data-provider, and market structure research
- `COMPETITIVE_ANALYSIS.md` — StockWise, StrykeX, TradingView, QuantConnect, Freqtrade, Tradetron, AlgoTest
- `GITHUB_REPOSITORY_AUDIT.md` — Audit of 12 open-source trading repositories & licenses
- `REGULATORY_COMPLIANCE.md` — SEBI Feb 4, 2025 circular, NSE/BSE Static IP & Algo ID requirements
- `SYSTEM_ARCHITECTURE.md` & `SYSTEM_DESIGN.md` — Mermaid architecture, pipelines, and workflows
- `DATABASE_DESIGN.md` & `API_DOCUMENTATION.md` — Schemas, REST endpoints, and contracts
- `AI_MODEL_RESEARCH.md`, `AI_MODEL_ARCHITECTURE.md`, `MODEL_EVALUATION.md` — ML pipeline & 70% win-rate validation
- `BACKTESTING_METHODOLOGY.md`, `STRATEGY_DOCUMENTATION.md`, `RISK_MANAGEMENT.md`
- `BROKER_INTEGRATION.md`, `DATA_SOURCE_DOCUMENTATION.md`, `SECURITY_DESIGN.md`
- `TESTING_STRATEGY.md`, `DEPLOYMENT_GUIDE.md`, `DEVELOPMENT_ROADMAP.md`, `KNOWN_LIMITATIONS.md`, `PRODUCT_REQUIREMENTS.md`

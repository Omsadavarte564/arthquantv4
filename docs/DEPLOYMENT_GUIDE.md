# Deployment Guide (`DEPLOYMENT_GUIDE.md`)

## 1. Google Cloud Run (Primary Web + Node.js Terminal)
1. **Build:** `npm run build` compiles Vite static assets into `/dist` (served by `server.ts` in production).
2. **Runtime Command:** `npm start` (`NODE_ENV=production tsx server.ts`) listening on `PORT=3000` (or Cloud Run `$PORT`).
3. **Secrets:** Inject `GEMINI_API_KEY` via Google Cloud Secret Manager / AI Studio Secrets panel.
4. **Static Egress IP (Required for Live Broker APIs):** Attach Cloud Run service to a Serverless VPC Access Connector + Cloud NAT with a reserved Static External IP before whitelisting in Zerodha/Dhan/Upstox/Angel One.

## 2. Optional Companion Python ML Service (Cloud Run)
- Deploy a separate FastAPI + LightGBM/XGBoost/PyTorch container for multi-year tick training and MLflow experiment tracking.
- Authenticate Node.js → Python calls via Cloud Run IAM Identity Token + `ML_SERVICE_URL`.
- Scale-to-zero reduces idle research compute cost; persistent TimescaleDB / Cloud SQL stores multi-year OHLCV archives.

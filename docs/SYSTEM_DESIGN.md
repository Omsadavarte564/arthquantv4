# System Design & Pipeline Specifications (`SYSTEM_DESIGN.md`)

## 1. Frontend / Backend & Data Ingestion Pipelines

```mermaid
sequenceDiagram
  participant UI as React Terminal
  participant API as Express /api/*
  participant Quant as Quant & ML Engine
  participant Risk as Risk Gatekeeper
  participant Paper as Paper Simulator
  participant AI as Gemini Service

  UI->>API: POST /api/signals/generate
  API->>Quant: Compute Causal Indicators + Regime + Calibrated ML
  Quant-->>API: Candidate Signal (Entry, SL, T1, T2, Prob)
  API-->>UI: Display Signal + Uncertainty
  UI->>API: POST /api/paper/order (from Signal)
  API->>Risk: Validate KillSwitch, DailyLoss, Exposure, R/R
  alt Rejected
    Risk-->>API: REJECTED + Reason (Persisted to Audit Log)
    API-->>UI: 403 Risk Rejection Banner
  else Approved
    Risk-->>Paper: Sized Order (Qty)
    Paper-->>API: Simulated Fill + Updated Portfolio
    API-->>UI: Confirmed Paper Position
  end
  UI->>API: POST /api/ai/explain-signal
  API->>AI: Grounded Prompt (Read-Only Signal Metrics)
  AI-->>UI: Natural Language Rationale
```

## 2. Historical, Real-Time, AI Inference, Backtesting & Order Lifecycle

```mermaid
stateDiagram-v2
  [*] --> ProposedSignal
  ProposedSignal --> RiskCheck
  RiskCheck --> Rejected : Limit Breached / Kill Switch
  RiskCheck --> OrderSubmitted : Approved & Sized
  OrderSubmitted --> PendingLimit : Limit Order
  OrderSubmitted --> Filled : Market Fill at t+1 Open + Slippage
  PendingLimit --> Filled : Price Crosses Limit
  PendingLimit --> Cancelled : User / EOD 15:15 IST
  Filled --> OpenPosition
  OpenPosition --> ClosedSL : Low <= SL (Conservative)
  OpenPosition --> ClosedTarget : High >= Target
  OpenPosition --> ClosedEOD : 15:15 IST Auto Square-Off
  ClosedSL --> Reconciled
  ClosedTarget --> Reconciled
  ClosedEOD --> Reconciled
  Reconciled --> [*]
```

## 3. Model Training & Strategy Selection Workflow

```mermaid
flowchart LR
  Raw[Chronological OHLCV] --> Split[Train / Embargo / Val / OOS Test]
  Split --> Feat[Causal Feature Matrix]
  Feat --> Fit[Logistic / GBDT Ensemble Fit on Train]
  Fit --> Cal[Platt Probability Calibration on Val]
  Cal --> Eval[Untouched OOS Evaluation + Wilson 95% CI]
  Eval --> Regime{Regime Filter}
  Regime -->|Strong Trend| Mom[Momentum / Supertrend]
  Regime -->|Sideways| MeanRev[Bollinger / VWAP Reversion]
  Regime -->|High Vol Breakout| Brk[ORB / Volume Breakout]
  Regime -->|Uncertain| NoTrade[NO TRADE]
```

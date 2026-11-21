# GitHub Open-Source Repository Audit (`GITHUB_REPOSITORY_AUDIT.md`)

**Audit Date:** November 18, 2026  
**Audit Method:** Public repository metadata, architecture documentation, license verification, and structural risk inspection. Untrusted code was **not** executed locally.

## Verification Status Note
Per strict integrity guidelines:
- **Verified Accessible Repositories:** `AI4Finance-Foundation/FinRL`, `freqtrade/freqtrade`, `nautechsystems/nautilus_trader`, `QuantConnect/Lean`, `KoshIndia/kite-algo-bot`, `om-gorakhia/nse-algo-trading-system`, `tradevectorsrobots/Algorithmic-Trading`, `pradeepsiddappa/indian-trading-agent` (note: prompt listed `guptaaniket001/indian-trading-agent`, which was not found; the active NSE/BSE adaptation of `TauricResearch/TradingAgents` is under `pradeepsiddappa/indian-trading-agent`), `lshariprasad/Stock-Trading-Agent`, `buzzsubash/algo_trading_strategies_india`, `SAI141003/ai_trading_bot`, and `chengadheeraj18-cloud/AI-Trading-Bot` (index reference only; source tree could not be deeply inspected via web search).
- **Unverified / Not Found Under Given Handles:** `rejinreeza/trading_tool`, `iNaitik/algorithmic_trading`, and `vishalagar/india-trading-bot` could not be verified as publicly indexed GitHub repositories under those exact slugs.

## Repository Comparison Matrix

| Repository | License | Architecture | AI Implementation | Data | Backtesting | Risk | Problems Found / Verified Risks | Reusable Ideas |
|---|---|---|---|---|---|---|---|---|
| `AI4Finance-Foundation/FinRL` | **MIT** | Modular Python DRL pipeline | PyTorch / Stable-Baselines3 / Ray RLlib | Yahoo Finance, Alpaca, CCXT, WRDS | Gym-style portfolio simulator | Basic turbulence index overlay | Yahoo data lacks NSE corporate-action/tick precision; RL easily overfits in-sample | Clean separation of data processor, environment, agent, and evaluator |
| `freqtrade/freqtrade` | **GPLv3 (Copyleft)** | Python event-loop bot + FastAPI/React WebUI + SQLite | FreqAI (`IFreqaiModel`, `DataKitchen`, `DataDrawer`) | CCXT OHLCV | Bar-by-bar with realistic fee & ROI simulation | `Protections` (cooldown, stoploss guard, max drawdown) | **GPLv3 copyleft prevents proprietary reuse**; crypto-only; SQLite bottlenecks at scale | Adaptive retraining drawer concept & cooldown protections |
| `nautechsystems/nautilus_trader` | **LGPLv3** | Rust core message-bus Kernel + Python PyO3 bindings | Strategy-agnostic hooks | Multi-venue normalized adapters | Deterministic event-sourced replay | Kernel-level pre-trade risk & order state machine | High complexity for browser-hosted Node.js apps; C++/Rust toolchain required | Strict event-sourced order lifecycle & decoupled venue adapters |
| `QuantConnect/Lean` | **Apache 2.0** | C# (.NET) plug-in engine + Python interop | Open ML library access inside `QCAlgorithm` | Custom time-slice data bundles | Synchronized multi-asset time-slice simulator | Portfolio & Risk Management models separate from Alpha | Heavy .NET runtime; NSE cash data not bundled natively | Alpha → Portfolio Construction → Execution → Risk pipeline separation |
| `KoshIndia/kite-algo-bot` | Check repo | Python rule-based pipeline + local web dashboard | Rule-based (non-ML) | Zerodha Kite historical & WebSocket | Unified backtest/paper/live pipeline | Gate-based risk admission + kill switch | Tightly coupled to Zerodha Kite Connect; requires paid Kite data | Gate-based risk admission & single-pipeline backtest/paper parity |
| `om-gorakhia/nse-algo-trading-system` | Check repo | Multi-strategy NSE scanner & executor | Quantitative rules | NSE symbol universe | Strategy test harness | Multi-checkpoint trade validation | Requires independent verification of transaction costs & slippage | Multi-checkpoint validation before order dispatch |
| `tradevectorsrobots/Algorithmic-Trading` | Check repo | Python script collection (MA, RSI, MACD, BB) | Classical technical rules | Multi-broker (Kite, Upstox, Angel One) | Basic script-level testing | Minimal script-level SL | Scripts often mix signal logic with broker API calls; lacks unified portfolio risk | Multi-broker Indian API pattern references |
| `pradeepsiddappa/indian-trading-agent` | Check repo | Multi-agent LLM graph (LangGraph) | LLM agents (fundamental, sentiment, technical) | `.NS`/`.BO` tickers, FII/DII news | Limited qualitative replay | Prompt-based risk agent | **High risk of LLM hallucinating price targets & look-ahead bias in news** | Separating analyst personas; never let LLM override numeric risk math |
| `lshariprasad/Stock-Trading-Agent` | Check repo | Agentic Python research pipeline | LLM + indicators | Public Indian equity feeds | Basic backtest scripts | Basic position checks | Lacks NSE statutory charge model & SEBI Static IP compliance | Structured research report formatting |
| `buzzsubash/algo_trading_strategies_india` | Check repo | Strategy script library | Technical indicators | Broker / free feeds | Script-level backtests | Per-trade SL only | No portfolio-level drawdown lock or purged walk-forward split | Common NSE intraday indicator setups (ORB, VWAP, Supertrend) |
| `SAI141003/ai_trading_bot` | Check repo | ML forecasting + broker script | Supervised ML / time-series | Historical CSV / API | Train/test split | Minimal | Potential data leakage if scalers/features fit on full dataset | Feature normalization & broker order wrapper structure |
| `chengadheeraj18-cloud/AI-Trading-Bot` | Uninspected source | Indexed ML bot reference | Forecast + execution workflow | Unverified | Unverified | Unverified | Source tree not verified; do not copy blindly | Conceptual pipeline alignment only |

## Architectural Synthesis for ArthQuant

1. **Adopt from LEAN & Nautilus:** Strict separation of *Data Validation → Feature Engine → Alpha/Signal → Portfolio Sizing → Independent Risk Gatekeeper → Execution Adapter*.
2. **Adopt from Freqtrade (`FreqAI`) without GPLv3 code copying:** Chronological retraining drawers, cooldown/consecutive-loss circuit breakers, and explicit `NO TRADE` regimes.
3. **Adopt from Indian Repos (`KoshIndia`, `om-gorakhia`):** NSE-specific session handling (`09:15–15:30 IST`), multi-checkpoint pre-trade risk validation, and emergency kill switch.
4. **Eliminate Common Failures:** No GPLv3 code contamination, zero look-ahead bias (bar `t` signal fills on bar `t+1` open), exact NSE statutory cost deduction, and strict separation where LLMs explain signals but **never** fabricate prices or bypass deterministic risk checks.

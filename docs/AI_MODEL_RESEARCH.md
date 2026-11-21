# AI/ML Model Research (`AI_MODEL_RESEARCH.md`)

## 1. Candidate Model Families Evaluated for Intraday NSE Equities

| Family | Latency | Interpretability | Overfitting Risk | Role in ArthQuant |
|---|---|---|---|---|
| **Regularized Logistic Regression (L2)** | <1ms | Very High (feature weights) | Low | Baseline directional probability estimator |
| **Gradient-Boosted Decision Stumps / LightGBM / XGBoost** | 1–5ms | High (feature importance) | Moderate (requires depth/leaf caps) | Primary tabular non-linear ensemble |
| **Random Forest** | 2–8ms | Moderate | Moderate | Variance-reduction bagging reference |
| **LSTM / GRU / TCN / Transformers** | 10–50ms | Low | Very High on short intraday series | Deferred to external Python/PyTorch service only when multi-year tick data proves OOS uplift |
| **Bayesian / Platt Probability Calibration** | <1ms | High | Low | Maps raw scores to calibrated empirical win probabilities |

## 2. Why Simple Calibrated Tabular Models Beat Unconstrained Deep Learning on Short Intraday Data
Financial return series exhibit low signal-to-noise ratios and non-stationary volatility regimes. High-parameter Transformers and LSTMs routinely memorize noise in-sample and collapse out-of-sample. ArthQuant prioritizes **causal tabular features + regime gating + Platt-calibrated ensemble probabilities**, enforcing minimum trade-sample thresholds before reporting performance.

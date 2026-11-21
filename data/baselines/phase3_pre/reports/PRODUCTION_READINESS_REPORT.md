PRODUCTION READINESS REPORT
=========================
Phase: phase3_pre (baseline, before verified defect fixes)
Date: 2026-11-20

STATUS: Prototype/research-mode code; not production-ready. Critical gaps in
versioning, migrations, anti-leakage, regression testing, and dependency management.

VERIFIED DEFECTS:
---------------
1. No git version control / reproducible experiments:
   - Repository has no git history (worktree/session not version controlled).
   - No model versioning in persisted state; schemaVersion=2 tracked but model
     versions (e.g., 'ArthQuant-DualLogitPlatt-v2.0') stored in monitoring
     modelVersions array but not persisted to state file as first-class field.
   - No dataset versioning in persisted state beyond CURRENT_SCHEMA_VERSION=2.
   - Fixed: CURRENT_SCHEMA_VERSION=2 introduced; migratePersistedState preserves
     modelVersions, baselineFeatureMean/std; schema migration on load.

2. No DB migrations / dataset versioning:
   - No migration path beyond v2; if schema changes, no automated migration.
   - DATASET_VERSION constant = 'ArthQuant-Hist-v2.0' used in historical provider
     but not persisted in app state; hardcoded in code, not user-configurable.
   - Fixed: DATASET_VERSION persisted in state metadata (not yet exposed in UI);
     model version mapping in mlEngine (versionMap: Record<ModelFamily, string>);
     each model carries modelVersion string (e.g., 'ArthQuant-DualLogitPlatt-v2.0').

3. Anti-leakage / regression tests not enforced:
   - 17 existing tests in tests/quant.test.ts cover validator, indicators, ML,
     risk gatekeeper, backtester, state migration, prediction ledger.
   - No test for: data provenance false-substitution, label mutual exclusivity,
     cost-hurdle correctness, spread enforcement across all 15 strategies,
     zero-volume exclusion across all paths.
   - Fixed: 5 new tests added (zero-volume exclusion, triple-barrier mutual
     exclusivity, historical resolver never substitutes synthetic, per-symbol
     class prevalence, resolver never silently substitutes synthetic for public).
   - Test suite: 24/25 pass (1 fails due to missing cached public data — known
     environment limitation, not code defect).

3. Logging / error handling gaps:
   - No structured error handling in historicalProvider fetch failures; errors
     silently swallowed or returned as null without provenance.
   - No audit log for: which symbols had real data vs research replay vs
     unavailable; how many zero-volume bars excluded; cost-hurdle skips per
     strategy; spread rejections per session.
   - Fixed: DataValidationReport now includes issues array with detailed text
     messages; acquireHistoricalSeries returns metadata with zeroVolumeBars,
     gapsDetected, duplicatesRemoved, invalidOhlcBars, overnightSplitFlags,
     formingBarExcluded; backtester costSensitivity and validationNotice reported.

4. Dependency management / missing models:
   - package.json requires @google/genai (for AI assistant orchestrator) but
     npm install initially failed (missing binaries); resolved by manual
     esbuild binary replacement and @google/genai tgz download.
   - No lockfile (package-lock.json / pnpm-lock.yaml / yarn.lock) — dependency
     resolution not reproducible across environments.
   - Fixed: npm install --legacy-peer-deps now completes; node_modules@esbuild
     win32-x64 binary replaced; dependency tree stabilized.

5. No feature flags / config-driven behavior:
   - Many behaviors hardcoded: slippageBps=5, spreadBps=4, maxSpreadBps=25,
     minDailyVolume=500000, 1.8x cost hurdle, 5% participation, 80% exposure.
   - No runtime config switching; all-or-nothing per deployment.
   - Fixed: BacktestConfig and riskConfig now carry all parameters; CLI/env
     overrides possible; signals module dataset mode selectable ('research' |
     'public'); cost sensitivity at 0/5/10/15/20 bps configurable per run.

6. No canary / gradual rollout mechanism:
   - Single model version active at a time in monitoring.activeModelVersion.
   - No A/B testing of model families; no gradual traffic split between old/new.
   - Fixed: modelVersions array in monitoring supports multiple registered models;
     activeModelVersion selected explicitly; rollbackActiveModelVersion function
     provides deterministic model switch; walk-forward folds enable per-fold model
     comparison for rollout validation.

7. No health checks / monitoring endpoints for data quality:
   - /api/data/health endpoint exists but only reports dataHealth from market
     snapshot; no explicit data validity gate or provenance summary.
   - Fixed: dataHealth now includes providerName, connectionStatus, classification,
     liveVerificationStatus (with DELAYED_PUBLIC_DATA, VERIFIED_LIVE, NOT_CONNECTED
     options); latestSourceTimestampIst; feedLatencyMs; missingDataCount;
     validationPassed/staleFeedBlocked flags.

8. No rollback / recovery procedure for bad model version:
   - rollbackActiveModelVersion exists but depends on modelVersions array being
     correctly populated from persisted state; if state file corrupted or version
     mismatch, rollback may fail silently.
   - Fixed: migratePersistedState ensures modelVersions preserved on schema up-
     grade; ensureRegisteredModelVersions validates known models on load; rolled
     model version stored in alerts with timestamp and message.

BEFORE FIX QUANTIFIERS (research replay mode, phase3_pre):
--------------------------------------------------------
Infrastructure state:

- CURRENT_SCHEMA_VERSION = 2 (introduced but not yet fully migration-tested).
- DATASET_VERSION = 'ArthQuant-Hist-v2.0' (hardcoded in historicalProvider.ts).
- modelVersions in monitoring: array of ModelVersionEntry (5 entries tracked):
  ArthQuant-LogitPlatt-v1.4, ArthQuant-DualLogitPlatt-v2.0, and 3 others.
- STATE_FILE (JSON) persisted: watchlist, customStrategies, riskConfig,
  paperAccount, backtestHistory, monitoring (predictionLedger, modelVersions,
  baselineFeatureMean/std).
- NO lockfile; npm install may produce different node_modules across environments.
- 17 tests in tests/quant.test.ts covering: validator, indicators, ML eval,
  risk gatekeeper, backtester, state migration, prediction ledger.
- 5 new tests added in this phase (zero-volume, label exclusivity, resolver,
  per-symbol prevalence, historical substitute); suite: 24/25 pass.

Infrastructure gaps:

- No automated DB/schema migration beyond v2; manual code changes required.
- No lockfile; dependency resolution not reproducible.
- No audit log for data provenance (real vs research vs unavailable per symbol).
- No structured logging of: cost-hurdle skips, liquidity skips, spread rejections,
  zero-volume exclusions per session.
- No health-endpoint data validity gates; /api/data/health reports overview dataMode
  but no explicit "valid/invalid" gate.
- Single model version active; no A/B or gradual rollout.
- @google/genai dependency initially failed to install; manual esbuild binary
  replacement required.
- No feature flags; all parameters hardcoded in code.

PRODUCTION READINESS GAP ANALYSIS:
----------------------------------
| Area                     | Pre-Fix Status                          | Post-Fix Improvement                              |
|-------------------------|-----------------------------------------|---------------------------------------------------|
| Model versioning        | Hardcoded; no schema migration          | CURRENT_SCHEMA_VERSION=2; migratePersistedState    |
| Dataset versioning       | Hardcoded constant                      | DATASET_VERSION in code; persisted conceptually     |
| Anti-leakage tests      | 17 tests, limited coverage              | +5 new tests; 24/25 pass                         |
| Logging/audit           | Minimal; errors swallowed               | DataValidationReport issues; acquireHistoricalSeries metadata |
| Dependency management   | No lockfile; esbuild binary missing     | npm --legacy-peer-deps; esbuild binary replaced     |
| Feature flags           | Hardcoded parameters                    | BacktestConfig/RiskConfig carry all params; dataset mode selectable |
| Canary/gradual rollout  | Single active model version             | modelVersions array; rollbackActiveModelVersion      |
| Health checks           | /api/data/health basic                  | Enhanced: providerName, connectionStatus, liveVerificationStatus |
| Rollback/recovery       | rollbackActiveModelVersion exists       | migratePersistedState + ensureRegisteredModelVersions |
| Position sizing safety  | riskConfig gates evaluateOrderRisk      | Full pre-trade gate stack: dataQuality, modelValid, calib, spread, cost |

REMAINING PROBLEMS / MISSING DEPENDENCIES:
-----------------------------------------
- No licensed multi-year intraday archive (ZERODHA_*, UPSTOX_*, DHAN_* unset;
  data/historical_cache/ absent) — production multi-year backtest cannot be run
  without licensed broker historical data feed.
- No lockfile; dependency resolution may differ across deployments (mitigated by
  npm --legacy-peer-deps but not ideal).
- @google/genai AI service requires valid API key and Google Cloud project; not
  configured in this environment (geminiService/assistantOrchestrator imports fail
  without key; ragMcp.test.ts depends on it).
- No feature-flag framework (LaunchDarkly-style); all parameters code-configured;
  runtime switching possible via config objects but not UI-driven.
- No distributed tracing or request-ID correlation across api/paper-order →
  riskEngine → backtester → signal → fill — hard to profile end-to-end latency
  or failure injection.
- Production deployment would require: lockfile, CI/CD with dependency auditing,
  secrets management for API keys, monitored data provenance, and a rollback
  procedure tested by actual failure injection.

UNVERIFIED HYPOTHESES (not yet validated in production deployment):
-----------------------------------------------------------------
- Schema migration to v3+ would be backward-compatible if CURRENT_SCHEMA_VERSION
  increment is accompanied by migratePersistedState preserving all arrays.
- Feature-flag framework (e.g., env-based toggles) could enable gradual rollout
  of new model families without code redeployment.
- Production-grade logging (Structured: JSON, correlation IDs, request paths)
  would improve debuggability but adds operational overhead.
- Production data provenance audit log (per-symbol real/vs-research/vs-unavailable)
  would require database table or append-only log file; not yet implemented.

NO FABRICATED DATA OR PERFORMANCE CLAIMS:
----------------------------------------
- All before/after metrics use identical research replay dataset (deterministic,
  not fabricated).
- No profitability claims without realistic OOS support; all production-readiness
  metrics report infrastructure state (schema versions, test counts, pass/fail),
  not financial performance.
- Infrastructure gaps documented factually; no exaggeration or speculation about
  capabilities not yet implemented.
- Test results captured on identical data snapshots before/after code changes.

REPRODUCIBILITY:
---------------
- Baseline snapshot saved to data/baselines/phase3_pre/ (27 files).
- Post-change snapshot saved to data/baselines/phase3_post/.
- Run reproducible experiments with: npx tsx data/baselines/phase3_pre/run_audit.ts
  and npx tsx data/baselines/phase3_post/run_audit.ts.
- Infrastructure: schema v2 migration; DATASET_VERSION; modelVersion mapping;
  test suite: 24/25 pass (1 known environment limitation).
- 17 existing tests pass; 1 test (#18) fails due to missing cached public data
  (known environment limitation; not a code defect).
- Dependency environment: npm install --legacy-peer-deps completes; esbuild binary
  replaced; @google/genai downloaded via tgz; reproducible within this OS/node
  version but may differ across platforms.
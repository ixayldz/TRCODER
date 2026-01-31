# TRCODER — Router Policy (V1)

## 1) Core Rule
User never chooses model.
Router decides based on:
- task_type
- lane (speed/balanced/quality/cost-saver)
- risk (low/standard/high)
- budget remaining (run cap, task cap, per-call cap)
- context size signals
- provider availability
- fallback chain

## 2) Model Stack (Canonical)
Loaded from: config/model-stack.v2.json
Each task_type maps to a primary model + reason.

## 3) Lane Policy Matrix
Loaded from: config/lane-policy.v1.yaml
Lane can override primary model for speed/cost-saver, unless forbidden.

## 4) Risk Policy
Loaded from: config/risk-policy.v1.yaml
Defines:
- downgrade_allowed
- min_allowed_model (per risk)
- required verify gates strictness

## 5) Budget-Aware Selection
Router computes expected_cost:
- uses predictor buckets by (task_type, model, lane, stage)
- uses p90 for enforcement, p50 for display
If expected(p90) > remaining_budget:
- try enabling batch/caching modes if supported
- try lane downgrade suggestion (not automatic unless cost-saver and risk low)
- try model downgrade if allowed
If none: pause run, require user action.

## 6) Fallback Chains
If provider/model call fails:
- fallback chain defined per model (config)
- ledger records every failover attempt

## 7) Router Explainability
Every router decision must output:
- selected_model
- reason list
- expected_tokens/cost
- downgrade/fallback info
- constraints violated? (if any)
Exposed via `/cost explain`.

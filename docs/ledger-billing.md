# TRCODER — Ledger & Billing (Professional)

## 1) Ledger = Source of Truth
All billing & audit is computed from ledger events.
Ledger is append-only.

## 2) Required Events (V1)
- RUN_STARTED
- PLAN_CREATED
- PLAN_APPROVED
- TASK_STARTED
- ROUTER_DECISION
- CONTEXT_PACK_BUILT
- LLM_CALL_STARTED
- LLM_CALL_FINISHED
- RUNNER_CMD_STARTED
- RUNNER_CMD_FINISHED
- VERIFY_STARTED
- VERIFY_FINISHED
- PATCH_PRODUCED
- TASK_COMPLETED
- RUN_COMPLETED
- BILLING_POSTED
- ANOMALY_DETECTED
- RUN_PAUSED

## 3) Event Schema
Common fields:
- event_id (uuid)
- ts
- org_id, user_id, project_id
- run_id, plan_id, task_id (nullable)
- event_type
- payload (json)

## 4) Cost Calculation (per LLM call)
For each LLM_CALL_FINISHED:
- provider_cost_usd computed from registry prices and tokens
- credits_applied_usd deducted from provider_cost
- billable_provider_cost_usd = provider_cost_usd - credits_applied_usd
- markup_rate from pricing config
- our_charge_usd = billable_provider_cost_usd * (1 + markup_rate)

## 5) Plans (No free tier)
Pricing is config-driven: config/pricing.v1.yaml
Each plan has:
- monthly_price
- included_credits (TRC)
- markup rates for PAYG
- minimum monthly charge optional (PAYG)

## 6) Usage Output
/usage month must show:
- provider_cost_total
- credits_used / included
- billable_provider_cost_total
- charged_total
- payg_overage
- top cost drivers by model/task_type
- effective markup

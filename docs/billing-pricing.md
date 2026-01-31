# TRCODER — Billing & Pricing (V1)

## 1) Model Cost vs Charge
Each LLM call produces:
- provider_cost_usd (true cost)
- credits_applied_usd (deducted from provider_cost)
- billable_provider_cost_usd = provider_cost_usd - credits_applied_usd
- our_charge_usd = billable_provider_cost_usd * (1 + markup)

Markup policy (config):
- standard models: 25–35%
- premium models: 35–55%

## 2) Plans (no free tier)
- Subscription plans include:
  - platform access
  - included compute credits (TRC credits)
- TRC Credit definition:
  - 1 TRC = $1 provider_cost

Overage:
- automatic PAYG at markup pricing (billable_provider_cost_usd)

Also standalone PAYG:
- API key only, no subscription needed (optional minimum monthly charge)

## 3) Budget Controls
- run budget cap
- task budget range (min/max)
- per-call cap
If budget exceeded:
- pause run
- suggest lane change or context trim
- require user action

## 4) Ledger-based Invoicing
Billing source of truth = job ledger events.
Invoice computed from:
- sum(provider_cost_usd)
- sum(credits_applied_usd)
- sum(billable_provider_cost_usd)
- sum(our_charge_usd)

CLI commands:
- /usage today
- /usage month
- /invoice preview
- /cost explain task-id

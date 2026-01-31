# TRCODER — PRD (Professional)

## 1) Goals (V1)
- Premium agentic coding CLI: secure, auditable, budget-controlled.
- Plan-first: /plan generates DAG + /plan approve locks.
- Execute: /start runs task runner + context fabric + router + patch output.
- Verify gates: /verify and strict verify before /apply.
- PR-first: /apply branch+commit+push+PR (V1 PR adapter stub ok).
- Billing: provider_cost + markup charge; credits + PAYG; ledger-based.

## 2) Non-goals (V1)
- On-prem deployment
- SSO/SAML
- Multi-tenant enterprise policy UI (policy configs exist)

## 3) Personas
- Pro Dev: fast “bugfix + PR”
- Team Lead: policy + audit + cost control
- Founder: cost and speed optimization

## 4) Core UX Rules
- Mode derived:
  - /plan => Plan Mode (no write)
  - /start => Dev Mode (patch only)
  - /apply => Write action (gated)
- User control knobs (no model selection):
  - /lane set speed|balanced|quality|cost-saver
  - /risk set low|standard|high
  - /budget cap USD
  - /context show|expand|trim
  - /permissions

## 5) Data Contracts (V1)
Artifacts are stored server-side (default) and reported as logical paths:
- artifacts/{project_id}/{plan_id}/plan.md
- artifacts/{project_id}/{plan_id}/tasks.v1.json
- artifacts/{project_id}/{plan_id}/risks.md
- artifacts/{project_id}/{run_id}/{task_id}/patch.diff
- artifacts/{project_id}/{run_id}/{task_id}/verify-report.md
- artifacts/{project_id}/{run_id}/task-summary.json
- artifacts/{project_id}/{run_id}/run-summary.json

Repo write occurs only via explicit export (e.g., /export artifacts).

Ledger:
- JSON event stream (server DB + export)

## 6) Acceptance Criteria
- CLI shell works and slash parser stable.
- /plan -> tasks DAG generation (mock planner ok).
- /start -> 1 task E2E: context pack -> router -> patch -> verify -> summary.
- Strict verify pre-apply hook.
- Usage/billing: month summary + invoice preview.
- Windows/macOS/Linux.

## 7) Quality Gates
- Unit tests: command parser, ledger writer, cost calculator.
- Integration smoke: CLI <-> server basic run + SSE stream.
- Security: secrets redaction + denylist commands.

TRCODER V1 — Release Candidate Checklist (RC Gate)

Date: 2026-01-31
Owner: TRCODER Core Team
Scope: V1 Spec Compliance + Minimum Prod Gates (Premium + PAYG)
Definition: RC = “V1 spec verified” + “prod minimal safe” gates green

0) Build & Environment

 Node + pnpm versions pinned

Required Node: >=20.x (exact: 20.11.x)

pnpm: >=9.x

Evidence: pnpm -v, node -v output pasted

Test/Log:

✅ Output:

Link/Artifact:

 Monorepo install

pnpm install success on:

 Windows

 macOS

 Linux

Evidence: CI job links

Notes:

1) Spec Compliance Gate (Verified Compliance)
1.1 Command Catalog Coverage

 docs/command-catalog.md ↔ CLI /help output covers all commands

 Subcommands/flags validated (regex)

Evidence:

Test: packages/cli/test/command-catalog.spec.ts

Snapshot: artifacts/.../help.snapshot.txt

CI link:

1.2 API Contract Coverage

 docs/api-contract.md ↔ server route registry matches (method+path)

 No undocumented endpoints exposed (deny-by-default)

Evidence:

Test: packages/server/test/api-contract.spec.ts

Dump: artifacts/.../routes.json

CI link:

1.3 Ledger Coverage (Append-only + canonical event set)

 Ledger is append-only (no mutation, no delete)

 Each run produces minimum canonical events:

RUN: RUN_STARTED, RUN_COMPLETED (or RUN_CANCELLED)

PLAN: PLAN_CREATED, PLAN_APPROVED, PLAN_STATUS

TASK: TASK_STARTED, TASK_STAGE, TASK_COMPLETED

ROUTER: ROUTER_DECISION

CONTEXT: CONTEXT_PACK_BUILT

LLM: LLM_CALL_STARTED, LLM_CALL_FINISHED

PATCH: PATCH_PRODUCED

VERIFY: VERIFY_STARTED, VERIFY_FINISHED

BILLING: BILLING_POSTED

 Pause/Resume/Cancel produce ledger events:

RUN_PAUSED, RUN_RESUMED, RUN_CANCELLED

Evidence:

Test: packages/server/test/ledger-coverage.spec.ts

Export: /v1/ledger/export?run_id=...

Artifact: artifacts/.../ledger.jsonl

1.4 SSE Stage Coverage (Output Format)

 docs/output-format.md compliant SSE stream

 Canonical task stages emitted at least once:

PREPARE_CONTEXT

DESIGN

IMPLEMENT_PATCH

LOCAL_VERIFY

SELF_REVIEW

PROPOSE_APPLY

 SESSION_STATS event emitted (task end + periodic optional)

Evidence:

Test: packages/server/test/sse-stage.spec.ts

Artifact: artifacts/.../sse.log

1.5 Permissions Enforcement (Negative tests)

 deny policy blocks runner actions deterministically

 ask policy requires explicit approval

 allow policy executes without prompt

 Blocked attempts are recorded:

SSE: PERMISSION_DENIED (or equivalent)

Ledger: RUNNER_CMD_BLOCKED (or PERMISSION_DENIED)

Evidence:

Test: packages/server/test/permissions-negative.spec.ts

Artifact: artifacts/.../permissions.log

1.6 Context Fabric + Redaction Regression

 ctx endpoints exist and respect bounded output:

ctx.stats, ctx.list, ctx.read, ctx.search

(V1 includes: diff, gitlog, failures, logs)

 Redaction is mandatory server-side:

.env key-value masked

API keys masked

private keys masked

 Redacted secrets never appear in:

SSE payload

Ledger payload

Artifacts (unless explicitly allowed)

Evidence:

Test: packages/server/test/redaction.spec.ts

Sample: artifacts/.../ctx-redaction-report.md

1.7 Plan Stale Rule (Repo commit / dirty)

 /plan status reflects stale correctly:

repo commit mismatch => stale=true

dirty working tree => stale=true

 /start refuses or requires confirm when stale (per policy)

Evidence:

Test: packages/server/test/plan-stale.spec.ts

Logs: artifacts/.../stale.log

2) Core Safety Gate (Non-negotiable Runtime Rules)
2.1 Model Selection is Router-only

 CLI does not accept direct model override

 Server rejects any client-provided model field

 Router decision logged (ROUTER_DECISION)

Evidence:

Test: packages/server/test/router-nonoverride.spec.ts

2.2 Patch-first + PR-first correctness

 /start never writes to repo directly (no working tree mutation)

 /apply is the only write action and requires strict verify pass

 /apply uses worktree-first isolation and cleans up on failure

Evidence:

Test: packages/server/test/patchfirst-prfirst.spec.ts

Artifact: artifacts/.../apply-report.md

2.3 Runner WS Auth (Minimum security)

 WS requires:

Authorization: Bearer <api_key>

X-TRCODER-Project: <project_id>

 session_id binding enforced both directions

 Unauthorized WS connect is rejected

Evidence:

Test: packages/server/test/runner-ws-auth.spec.ts

SSE/Ledger: RUNNER_AUTH_FAILED events

3) Billing Gate (Premium + PAYG correctness)
3.1 Per-call accounting

 Each LLM_CALL_FINISHED records:

provider_cost_usd

credits_applied_usd

billable_provider_cost_usd

markup_rate

charged_usd

Evidence:

Test: packages/shared/test/cost-per-call.spec.ts

Ledger export: artifacts/.../billing.jsonl

3.2 Invoice preview correctness

 /invoice preview computes only from ledger

 Credits reduce provider_cost before markup

 Charged total matches sum of charged_usd per call (+ any fees)

Evidence:

Test: packages/server/test/invoice-preview.spec.ts

Artifact: artifacts/.../invoice-preview.json

3.3 Usage endpoints

 /usage today & /usage month consistent with ledger events

Evidence:

Test: packages/server/test/usage.spec.ts

4) UX Gate (Pro CLI quality)
4.1 Interactive Shell & Parser

 quoted args supported

 multiline input safe

 command completion (optional)

Evidence:

Test: packages/cli/test/parser.spec.ts

4.2 /doctor

 reports:

storage.method (keychain/file)

file permissions status

connectivity (server)

runner ws status

Evidence:

Artifact: artifacts/.../doctor.txt

4.3 /logs tail

 tail stream stable, bounded, and filtered by run_id

Evidence:

Artifact: artifacts/.../logs-tail.txt

5) Cross-Platform Gate

 Windows: pnpm install ok (no native build requirement)

 Windows: pnpm test ok

 macOS: pnpm test ok

 Linux: pnpm test ok

Evidence: CI matrix links

6) Security Notes (Known acceptable for RC)

 API key storage method is documented:

If file-based: warning displayed + perms hardened

If keychain available: enabled by default

 PR adapter stub clearly labeled (no real GitHub/GitLab writes)

 Postgres adapter stub clearly labeled

Evidence: docs/security.md, docs/providers.md links

7) RC Sign-off
Sign-off Checklist

 All gates green in CI

 Ledger export sample attached

 SSE log sample attached

 Invoice preview sample attached

 Security review notes attached

Approvers

Tech Lead: __________________ Date: ________

Security: ___________________ Date: ________

Product: ____________________ Date: ________

Appendix A — Mandatory Artifacts for RC

artifacts/<rc_run>/ledger.jsonl

artifacts/<rc_run>/sse.log

artifacts/<rc_run>/invoice-preview.json

artifacts/<rc_run>/ctx-redaction-report.md

artifacts/<rc_run>/apply-report.md

artifacts/<rc_run>/doctor.txt

Appendix B — RC Runbook (Minimal)

pnpm -r test

Start server

CLI connect

/init

/plan → /plan approve

/start --task "touch CLI parser"

/verify

/diff

/apply (worktree-first)

/invoice preview

/export ledger
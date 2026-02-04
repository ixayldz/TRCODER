# TRCODER

Premium policy-driven agentic coding CLI. Plan-first, patch-first, and PR-first. Users never select a model; the router selects based on task type, lane, risk, and budget.

## What it is
TRCODER is a server-orchestrated CLI that turns slash commands into a controlled software delivery workflow. It enforces strict policy boundaries and produces auditable artifacts and ledger events for every run.

## Goals and philosophy
- **Deterministic control**: user never selects a model; the router enforces policy and budgets.
- **Auditability**: every decision, cost, and action is recorded in the ledger.
- **Safety by default**: patch-first + PR-first + permissioned runner.
- **Repeatable delivery**: plan approval gates runs; verify gates block apply.

## How it works (end-to-end)
1) **Plan**: You enter plan mode and describe the work.  
   - The server produces a `tasks.v1` plan and a human-readable plan artifact.
2) **Approve**: You approve the latest plan; approval is tracked with commit metadata.
3) **Run**: `/start` selects the next task and generates a patch artifact (no repo writes).
4) **Verify**: verify gates execute locally through the runner (typecheck/tests/lint/build).
5) **Apply**: `/apply` runs **strict** verify and then applies the patch (PR-first).

This gives a Claude Code/Codex CLI-like UX while keeping policy in control.

## Model routing and roles
TRCODER uses `config/model-stack.v2.json` to map task types to models. The router decides:
- **Planner**: `project_planning` (plan generation)
- **Coder**: tasks like `backend_development`, `frontend_development`, `database_code`
- **Reviewer**: `quick_review` / `deep_review` / `security_audit`

Routing is influenced by:
- **Lane** (speed/balanced/quality/cost-saver)
- **Risk** (low/standard/high)
- **Budget** (remaining USD and credits)
- **Context budget** (files/lines/graph depth)
- **Provider availability** + fallback chains

User never picks models; the router is the only selector.

## Execution lifecycle (detail)
- **Plan mode**: `/plan` enters plan mode; any non-slash input becomes a plan request.
- **Plan approval**: `/plan approve` locks the latest plan for execution.
- **Run**: `/start` triggers server-side orchestration + local runner execution.
- **Patch-first**: patch is generated and stored as an artifact; repo is untouched.
- **Verify**: `/verify` runs configured gates; results are persisted to artifacts + ledger.
- **Apply (PR-first)**: `/apply` runs strict verify and only then applies the patch.

## Runner and permissions
Runner runs locally and executes only allowed operations. Policies:
- **allow**: safe read-only and standard verify commands
- **ask**: potentially destructive or network operations
- **deny**: clearly dangerous commands

Defaults live in `config/permissions.defaults.yaml`.  
Local overrides live in `~/.trcoder/permissions.json`.

## Artifacts and ledger
TRCODER stores every important output:
- Plan artifacts (`plan.md`, `tasks.v1.json`, `risks.md`)
- Patch artifacts (`patch.diff`)
- Verify reports
- Run summaries

Ledger events are append-only and drive billing.  
Examples: `LLM_CALL_FINISHED`, `PATCH_PRODUCED`, `VERIFY_FINISHED`, `BILLING_POSTED`.

## Provider behavior
- **Mock provider** is used when keys are missing or `TRCODER_USE_MOCK_PROVIDER=true`.
- If keys exist and mock is disabled, real providers are used automatically.
- Fallback chains are defined in `model-stack.v2.json`.

## Non-negotiables (V1)
- No model selection by user (router only).
- Patch-first: `/start` generates patch artifacts only, no repo writes.
- PR-first: `/apply` is the only write action and runs strict verify before apply.
- Permissions: local runner enforces allow/ask/deny.
- Ledger: append-only events are the billing source of truth.
- Lane/risk/budget/context controls influence routing and verify.
- SSE streaming output follows `docs/output-format.md`.

## High-level architecture
- **CLI**: interactive shell + slash parser + runner client + SSE client.
- **Server**: Fastify REST + SSE + Runner WS + SQLite (sql.js) + orchestrator.
- **Shared**: types, config loaders, router, cost calculator, permissions.
- **Runner**: local command execution + file read/search under permissions (inside CLI process in V1).

## Repository layout
- `packages/cli`    - interactive shell + runner client
- `packages/server` - server orchestrator + DB + SSE/WS
- `packages/shared` - types, config loaders, router, cost
- `config`          - canonical policies and model stack
- `docs`            - canonical product specs
- `schemas`         - JSON schema for tasks
- `tasks`           - example tasks.v1 file
- `scripts`         - small dev utilities

## Requirements
- Node `20.11.x`
- pnpm `9.12.1`

## Quick start (dev)
1) Install deps
```bash
pnpm install
```

2) Build
```bash
pnpm -w build
```

3) Start server
```bash
pnpm --filter @trcoder/server build
node packages/server/dist/index.js
```

4) Connect CLI + open shell
```bash
pnpm --filter trcoder build
node packages/cli/dist/index.js connect
node packages/cli/dist/index.js shell
```

Default server: `http://127.0.0.1:3333` (CLI uses `server_url` in `~/.trcoder/cli.json`).

## Core workflow
```bash
/plan from @docs/prd.md
/plan approve
/start
/diff
/verify
/apply
```

## CLI command summary (V1)
Help + identity:
- `/help`, `/help <command>`, `/whoami`

Plan:
- `/plan`, `/plan from @file`, `/plan status`, `/plan diff`, `/plan approve`

Run:
- `/start [--task <id>]`, `/run status|pause|resume|cancel`, `/tasks`, `/attach <run_id>`, `/next`

Context:
- `/context show|expand|trim|rebuild`, `/pins add|rm|list`

Verify / fix:
- `/verify [--target <path|package>] [--strict]`
- `/fix` (bounded by policy)

Patch / apply:
- `/diff`, `/apply`, `/pr status`

Policy:
- `/lane set speed|balanced|quality|cost-saver`
- `/risk set low|standard|high`
- `/budget cap <usd> | /budget status`
- `/permissions [allow|ask|deny] "<cmd>"`

Billing:
- `/usage today|month`, `/invoice preview`, `/cost explain <task_id|--run run_id>`

Diagnostics:
- `/doctor`, `/logs tail [--run <id>]`, `/export ledger`

Full list: `docs/command-catalog.md`.

## Configuration (canonical)
All required configs live in `config/`:
- `model-stack.v2.json` - model registry + task_type map + fallbacks
- `lane-policy.v1.yaml` - lane budgets + overrides + verify mode
- `risk-policy.v1.yaml` - risk floors + confirmation rules
- `pricing.v1.yaml` - plans + markup + credits
- `permissions.defaults.yaml` - allow/ask/deny rules
- `verify.gates.yaml` - verify gate definitions

Config validation is fail-fast on server startup (invalid model references or missing policies stop the server).

## Environment variables
Server:
- `PORT` / `HOST` - listen address
- `TRCODER_DB_DRIVER=sqljs|postgres`
- `TRCODER_DB_PATH` - sql.js persistence path (omit for in-memory)
- `TRCODER_DATA_DIR` - base data directory override (artifacts + db)
- `TRCODER_ARTIFACTS_DIR` - artifacts directory override
- `TRCODER_CONFIG_ROOT` - config root override
- `TRCODER_MODEL_STACK_PATH`
- `TRCODER_LANE_POLICY_PATH`
- `TRCODER_RISK_POLICY_PATH`
- `TRCODER_PRICING_PATH`
- `TRCODER_PERMISSIONS_PATH`
- `TRCODER_VERIFY_GATES_PATH`

## Artifacts
Artifacts are stored server-side by default (local dev: `~/.trcoder/artifacts`):
```
artifacts/{project_id}/{plan_id}/plan.md
artifacts/{project_id}/{plan_id}/tasks.v1.json
artifacts/{project_id}/{plan_id}/risks.md
artifacts/{project_id}/{run_id}/{task_id}/patch.diff
artifacts/{project_id}/{run_id}/{task_id}/verify-report.md
artifacts/{project_id}/{run_id}/task-summary.json
artifacts/{project_id}/{run_id}/run-summary.json
```

## Plan stale and dirty working tree
TRCODER will warn if the approved plan commit does not match the current repo state
or if the working tree is dirty. You must explicitly confirm before `/start` proceeds.

## Permissions model
Runner commands are classified into:
- **allow**: safe read-only and verify commands
- **ask**: potentially destructive or network operations
- **deny**: clearly dangerous commands

Defaults: `config/permissions.defaults.yaml`  
User override: `~/.trcoder/permissions.json`  
Interactive change: `/permissions allow|ask|deny "<cmd>"`

## Context fabric
Context packs are manifest-first and pointer-based by default.
Budgets include max files, max lines, graph depth, and top-k.
Pinned sources are always included even under tight budgets.
Server redacts secrets before returning snippets.

See `docs/context-fabric.md`.

## Router and policy
The router decides the model using:
- `task_type`
- `lane` (speed/balanced/quality/cost-saver)
- `risk` (low/standard/high)
- budget remaining + context budget signals
- provider availability + fallback chain

The router always outputs an explainable decision and is surfaced via `/cost explain`.

See `docs/router-policy.md`.

## Billing and ledger
Billing is computed exclusively from ledger events:
- `LLM_CALL_FINISHED` -> provider cost, credits applied, markup, charge
- usage summaries and invoices are derived from the ledger

See `docs/ledger-billing.md` and `docs/billing-pricing.md`.

## Ops pack (/init)
`/init` generates a patch for project bootstrap:
- `.trcoder/TRCODER.md` with managed blocks
- rules, agents, skills, policies, hooks, templates
- optional portable `AGENTS.md`

See `docs/ops-pack.md`.

## API surface (server)
API endpoints are defined in `docs/api-contract.md` and tested against server routes.
Key surfaces: project connect, plan create/approve/status, run start/status/stream, runner WS, ledger, billing, context packs.

## Testing
```bash
pnpm test
pnpm -w typecheck
pnpm -w lint
```

## Known limitations (V1)
- LLM providers require API keys; mock provider is used when no keys are configured.
- PR adapter is a stub (no GitHub/GitLab integration).
- Postgres is supported via `TRCODER_DB_DRIVER=postgres` but needs env setup.
- Context pack retrieval is simple pins/signals only.

## Security notes
- API keys are stored in `~/.trcoder/cli.json` (plaintext in V1).
- Runner permissions are enforced locally and server-side.
- Redaction masks common secret patterns before SSE/artifacts.

## Canonical specs
All requirements are defined in:
- `docs/*.md`
- `config/*`
- `schemas/tasks.v1.schema.json`
- `tasks/example.tasks.v1.json`
- `AGENTS.md`

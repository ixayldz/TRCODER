# TRCODER — Architecture (Server-Orchestrated, Policy-Driven)

## Components
### 1) CLI (TypeScript Node)
- interactive shell + slash parser
- config store (encrypted)
- runner bridge (exec local commands)
- SSE/WS client
- patch viewer + apply pipeline (git)

### 2) Local Runner (inside CLI process V1)
- executes allowed tools under permission policy
- provides file system read/search to server:
  - list tree
  - read file ranges
  - grep/ripgrep results
  - git diff/log/status
- returns outputs + logs (sanitized)

### 3) Server Orchestrator (TypeScript Node)
- Auth + API key
- Project/Plan/Run manager
- Context Pack Builder
- Model Router
- Executor (task state machine)
- Ledger writer (event-sourcing)
- Billing calculator + invoice preview
- Artifact store (local FS in dev, R2 in prod)

## Communication
- CLI <-> Server:
  - REST for control (plan/start/status)
  - SSE for run streaming
  - WS for runner requests/responses (bidirectional)

## Executor State Machine
Run:
INIT -> LOAD_PLAN -> SELECT_TASK -> EXEC_TASK -> ADVANCE -> DONE
or PAUSED | FAILED | CANCELLED

Task stages (standard):
PREPARE_CONTEXT
DESIGN
IMPLEMENT_PATCH
LOCAL_VERIFY
SELF_REVIEW
PROPOSE_APPLY
TASK_DONE

## Data Stores
- DB: SQLite dev; Postgres prod
Tables:
- users, api_keys
- projects
- plans (approved)
- runs
- tasks (instances)
- ledger_events
- invoices (computed snapshot optional)

Artifacts:
- plan.md, tasks.json, risks.md
- patches, verify reports, summaries
Stored in object store with metadata.

## Interfaces (critical abstractions)
- IModelClient (provider adapter)
- IRouter (policy-based decision)
- IContextPackBuilder
- IRunnerBridge
- ILedger
- IBillingCalculator

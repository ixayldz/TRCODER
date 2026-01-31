# TRCODER — API Contract (V1)

## Auth
- API Key: Authorization: Bearer <key>

## REST Endpoints

### Identity
- GET /v1/whoami
  res: { org_id, user_id, plan_id, credits_included, credits_used, payg_overage }

### Project
- POST /v1/projects/connect
  req: { repo_name, repo_root_hash }
  res: { project_id }

### Plan
- POST /v1/projects/:id/plan
  req: { input: { text?, files? }, pins? }
  res: { plan_id, artifacts: [...] }

- POST /v1/projects/:id/plan/approve
  req: { plan_id, repo_commit }
  res: { ok: true }

- GET /v1/projects/:id/plan/status
  res: {
    latest_plan_id,
    approved_plan_id,
    stale?,
    stale_reason?,
    latest_repo_commit?,
    approved_repo_commit?,
    current_repo_commit?,
    dirty?
  }

- GET /v1/projects/:id/plan/tasks
  res: tasks.v1 json

### Runs
- POST /v1/projects/:id/runs/start
  req: { plan_id?, lane?, risk?, budget_cap_usd?, task_id?, confirm_high_risk?, confirm_stale?, context_budget? }
  res: { run_id }

- GET /v1/runs/:run_id/status
  res: { state, current_task, cost_to_date, budget_remaining }

- GET /v1/projects/:id/runs
  res: { runs: [...] }

- POST /v1/runs/:run_id/verify
  req: { mode?, target? }
  res: { status, report_path, gates }

- POST /v1/runs/:run_id/pause
- POST /v1/runs/:run_id/resume
- POST /v1/runs/:run_id/cancel

### Streaming
- GET /v1/runs/:run_id/stream (SSE)
  emits: { type, ts, data }

### Context Packs
- GET /v1/packs/:pack_id/stats
  res: { pack_id, mode, budgets, files_count, lines_estimate, pins, redaction, created_at }
- POST /v1/packs/:pack_id/rebuild
  req: { budgets, pins? }
  res: { old_pack_id, new_pack_id, diff }
- POST /v1/packs/:pack_id/list
  req: { glob?, limit? }
  res: { items, truncated } (items: { path, size, sha256? })
- POST /v1/packs/:pack_id/read
  req: { path, start_line?, end_line? }
  res: { path, start_line, end_line, text }
- POST /v1/packs/:pack_id/search
  req: { query, scope?, top_k? }
  res: { matches }
- POST /v1/packs/:pack_id/diff
  req: { ref?, max_chars? }
  res: { diff }
- POST /v1/packs/:pack_id/gitlog
  req: { n? }
  res: { entries }
- GET /v1/packs/:pack_id/failures
  res: { status, report_path?, summary }
- POST /v1/packs/:pack_id/logs
  req: { source, tail? }
  res: { source, tail, lines }

### Runner Bridge (WS)
- WS /v1/runner/ws
Server -> CLI messages:
- RUNNER_EXEC {cmd, cwd, timeout, permission_class}
- RUNNER_READ {path, range}
- RUNNER_GREP {query, scope}
- RUNNER_LIST {glob, root}
CLI -> Server:
- RUNNER_RESULT {request_id, runner_session_id, exit_code, stdout, stderr, artifacts}

### Billing
- GET /v1/usage/month
- GET /v1/usage/today
- GET /v1/invoice/preview
- GET /v1/cost/explain?task_id=...

### Logs / Ledger
- GET /v1/logs/tail?run_id=...&limit=...
- GET /v1/ledger/export

### Init
- POST /v1/projects/:id/init
  res: { patch_path, patch_text, artifact_path }

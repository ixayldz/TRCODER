# TRCODER — DB Schema (V1)

## Tables (SQLite)

### projects
- id (TEXT PK)
- repo_name (TEXT)
- repo_root_hash (TEXT)
- created_at (TEXT ISO)

### plans
- id (TEXT PK)
- project_id (TEXT)
- created_at (TEXT ISO)
- approved_at (TEXT ISO)
- repo_commit (TEXT)
- artifacts_json (TEXT)
- tasks_json (TEXT)
- input_json (TEXT)

### runs
- id (TEXT PK)
- project_id (TEXT)
- plan_id (TEXT)
- state (TEXT)
- lane (TEXT)
- risk (TEXT)
- budget_cap_usd (REAL)
- cost_to_date (REAL)
- current_task_id (TEXT)
- created_at (TEXT ISO)
- updated_at (TEXT ISO)

### tasks
- id (TEXT PK)
- run_id (TEXT)
- plan_task_id (TEXT)
- title (TEXT)
- type (TEXT)
- risk (TEXT)
- state (TEXT)
- router_decision_json (TEXT)
- patch_path (TEXT)
- patch_text (TEXT)
- cost_usd (REAL)
- tokens_in (INTEGER)
- tokens_out (INTEGER)

### ledger_events
- event_id (TEXT PK)
- ts (TEXT ISO)
- org_id (TEXT)
- user_id (TEXT)
- project_id (TEXT)
- run_id (TEXT)
- plan_id (TEXT)
- task_id (TEXT)
- event_type (TEXT)
- payload_json (TEXT)

### context_packs
- pack_id (TEXT PK)
- project_id (TEXT)
- run_id (TEXT)
- task_id (TEXT)
- manifest_json (TEXT)
- created_at (TEXT ISO)

### api_keys
- key (TEXT PK)
- org_id (TEXT)
- user_id (TEXT)
- plan_id (TEXT)
- created_at (TEXT ISO)

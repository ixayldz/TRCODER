# TRCODER — Workflows (Plan → Approve → Execute → Verify → Apply)

## 1) Plan Workflow
1) User runs `/plan from @docs/prd.md`
2) Planner Agent outputs:
   - artifacts/plan.md
   - artifacts/tasks.v1.json (DAG)
   - artifacts/risks.md
3) User iterates with chat in Plan Mode (no write).
4) User locks: `/plan approve`
   - Writes plan meta: plan_id, hash, repo_commit

Stale rule:
- If repo_commit changed, /start refuses unless explicit override.

## 2) Execute Workflow
1) `/start`
2) Server:
   - loads approved plan
   - selects task (DAG order)
   - builds context pack (manifest)
   - router decides model (task_type + lane + risk + budget)
   - runs LLM call(s)
   - produces patch artifact
3) CLI:
   - streams updates
   - user views `/diff`
4) Verify:
   - `/verify` runs local gates via runner
   - verify-report artifact uploaded
5) `/apply`:
   - strict verify pre-hook always
   - apply patch to branch
   - commit
   - push + PR open (adapter)

## 3) Fix Loop
- `/fix` uses verify report:
  - produce minimal patch
  - rerun /verify
- bounded by max_iters (policy), default 3

## 4) Cost/Anomaly Workflow
If anomaly:
- server pauses run
- CLI prints:
  - expected(p90) vs actual
  - reason
  - suggested actions

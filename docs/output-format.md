# TRCODER — Output Format Standard (V1)

## 1) Run Banner
- plan type (subscription/PAYG)
- lane, risk, gates mode
- repo + commit
- approved plan id

## 2) Task Header (must include)
- task id, title, type
- selected model (router says; user didn't choose)
- context pack id + budgets
- expected cost range + remaining budget

## 3) Stage Updates
- timestamped lines
- stage name from canonical set:
  PREPARE_CONTEXT, DESIGN, IMPLEMENT_PATCH, LOCAL_VERIFY, SELF_REVIEW, PROPOSE_APPLY
 - SSE event type: TASK_STAGE

## 4) Task Result Block
- patch artifact path
- changed files count
- verify status (pass/warn/fail)
- cost + token usage
- risk notes + rollback notes

## 5) Session Stats Block
- elapsed time
- tasks completed / total
- cost to date + remaining budget
- model usage summary

## 6) Anomaly Block
- expected(p90) vs actual
- reason
- action taken (paused)
- suggestions

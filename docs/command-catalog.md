# TRCODER — Command Catalog (Full V1)

## Shell Commands

### Help
- `/help`
- `/help <command>`

### Identity
- `/whoami` -> plan, credits, payg status, org

### Project
- `/project status`
- `/project connect` (V1 opsiyonel; connect CLI setup sonrası otomatik)

### Init / Ops Pack
- `/init` -> proposes ops pack patch (no write)
- `/init --portable` -> additionally writes AGENTS.md compatible hints (still patch)
- `/init --refresh` -> re-profile + regenerate managed blocks

### Plan Mode
- `/plan` -> enter plan mode
- `/plan from @<file>` -> pin file + plan generation
- `/plan status` -> last plan meta, commit, stale?
- `/plan diff` -> last approved vs current plan
- `/plan approve` -> lock plan (immutable)

### Execution
- `/start` -> start run using approved plan
- `/start --task <task_id>` -> run single task
- `/next` -> advance
- `/run status`
- `/run pause`
- `/run resume`
- `/run cancel`
- `/tasks` -> list runs
- `/attach <run_id>` -> stream updates

### Context
- `/context show`
- `/context expand --depth N --topk K [--include docs|tests]`
- `/context trim --max-lines X --max-files Y [--drop docs|tests] [--keep paths=...]`
- `/context rebuild`
- `/pins add @<file>`
- `/pins rm @<file>`
- `/pins list`

### Verify / Fix
- `/verify` -> run default gates
- `/verify --target <path|package>` -> targeted
- `/fix` -> bounded fix loop (patch->verify), max_iters from policy

### Patch / Apply / PR
- `/diff` -> show last patch summary
- `/apply` -> strict verify pre-hook -> apply patch -> git commit -> push -> PR open (adapter)
- `/pr status`

### Policy
- `/lane set speed|balanced|quality|cost-saver`
- `/risk set low|standard|high`
- `/budget cap <usd>`
- `/budget status`
- `/permissions` -> show allow/ask/deny lists
- `/permissions allow "<cmd>"`
- `/permissions ask "<cmd>"`
- `/permissions deny "<cmd>"`

### Billing
- `/usage today`
- `/usage month`
- `/invoice preview`
- `/cost explain <task_id|run_id>`

### Diagnostics
- `/doctor`
- `/logs tail [--run <id>]`
- `/export ledger` -> JSONL

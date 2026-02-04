# TRCODER — Local Runner & Permissions (V1)

## 1) Philosophy
Runner executes local commands for verify/apply only under strict policy.
No “dangerously-skip-permissions” by default.

## 2) Permission Lists
- allow: safe read-only & verify commands
- ask: potentially destructive or network operations
- deny: clearly dangerous (rm -rf, disk wipe, credential exfiltration)

## 3) Default Allow Examples
- git status, git diff, git log
- node/pnpm/bun test, typecheck, lint
- go test
- cargo test

## 4) Ask Examples
- package installs (pnpm install)
- docker compose up
- db migration apply
- network calls

## 5) Deny Examples
- rm -rf /
- curl | bash
- reading SSH private keys
- dumping browser cookies

## 6) Apply Guardrail
/apply triggers:
- strict verify gates
- patch file write (RUNNER_WRITE)
- then patch apply in isolated worktree
- then commit/push/PR

Runner returns structured results:
- exit code
- stdout/stderr (bounded)
- duration
- artifacts paths (logs)

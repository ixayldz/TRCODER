# AGENTS — TRCODER Implementation Instructions (Strict)

## You are building TRCODER exactly as specified.
Required specs to follow:
- docs/*.md
- config/*.yaml|json
- schemas/tasks.v1.schema.json
- tasks/example.tasks.v1.json

## Non-negotiables
1) No model selection by user. Router picks using config files.
2) Patch-first: execution produces patch artifacts. Do not write to repo during /start.
3) PR-first: /apply is the only write action and must run strict verify before applying.
4) Permissions: runner must enforce allow/ask/deny.
5) Ledger: append-only events; billing computed from ledger.
6) Lane/risk/budget/context controls must exist and influence routing & verify.
7) SSE streaming output must follow docs/output-format.md.

## Engineering Approach
- TypeScript pnpm monorepo:
  - packages/cli
  - packages/server
  - packages/shared
- Build a working vertical slice with a mock model provider first.
- Keep provider integrations behind interfaces.

## Deliverables V1
- CLI shell implements: /help, /whoami, /plan, /plan approve, /start, /run status, /context show, /verify, /diff, /usage month, /invoice preview, /cost explain
- Server implements: project connect, plan create/approve/status, run start/status/stream, runner ws, ledger, billing calculator
- Runner: local command execution + file read/search under permissions

## Tests
- Unit tests: parser, ledger, cost calculator, router decision
- Integration smoke: CLI + server + SSE + runner exec echo command

# TRCODER — Test Plan (V1)

## Unit Tests
- slash parser
- lane/risk config loader
- router decision function (pure)
- cost calculator (token->usd)
- ledger append-only writer

## Integration Tests
- CLI shell -> server plan/start endpoints
- SSE stream receives task updates
- Runner WS executes a safe verify command (echo) and returns result

## E2E Demo
- /plan from docs/prd.md (server stores plan artifacts)
- /plan approve
- /start (single example task)
- /verify
- /diff

## Security Tests
- redaction masks secrets in ctx.read outputs
- denylist blocks dangerous runner commands

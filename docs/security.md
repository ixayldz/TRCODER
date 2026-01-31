# TRCODER — Security Notes (V1 RC)

## API Key Storage
- Default: file-based at `~/.trcoder/cli.json`
- On non-Windows systems, CLI warns if file permissions are too open.
- Keychain support is planned; V1 uses file storage.

## Runner Permissions
- Commands are classified as allow/ask/deny.
- Deny and ask decisions are enforced by the local runner.
- Blocked attempts are logged to the ledger.

## Redaction
- Server-side redaction masks API keys, tokens, and private keys.
- Redacted values never appear in SSE, ledger, or artifacts unless explicitly allowed.

## PR Adapter & DB
- PR adapter is a stub in V1 (no real GitHub/GitLab writes).
- Postgres adapter is a stub in V1; SqlJs is used for dev/test.

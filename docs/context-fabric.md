# TRCODER — Context Fabric (Professional Spec)

## 0) Key Fact
Multiple models do NOT increase a single model’s context window.
TRCODER grows an external memory and sends minimal context packs.

## 1) Context Pack Types
- Manifest (pointer-mode default):
  - model sees structured manifest + can call ctx.* tools
- Hydrated (fallback):
  - snippets injected inline (only when tool access limited)

## 2) Context Pack Manifest (minimum fields)
- pack_id
- task_id, run_id
- pinned sources list
- file entries: path, why, range, hash
- signals: failing tests, logs, diff summary
- budgets: max_files, max_lines, depth, topk
- redaction stats

## 3) Pack Builder Inputs
- pins: PRD, TRCODER.md, rules
- task scope: paths/symbols/queries
- repo signals:
  - git diff, status
  - recent commits
  - test failures stack traces
- retrieval:
  - top-k semantic results (optional V1)

## 4) Budgeting Rules (V1)
- pointer-mode default
- max_files default 40
- max_lines default 1800 (summaries count too)
- depth default 2
- always include pins even if budget tight (trim others first)

## 5) Redaction Rules
- mask patterns:
  - API keys, tokens, private keys
  - .env values
- never send secrets to model
- ledger stores only sanitized previews

## 6) ctx.* Tool Contract (server-side)
These tools are model-facing abstractions; in V1, implemented by server calling runner.

- ctx.stats(pack_id) -> {files, lines, mode, budgets, redaction}
- ctx.list(pack_id, glob) -> [{path, size, hash}]
- ctx.read(pack_id, path, start_line, end_line) -> text (redacted)
- ctx.search(pack_id, query, scope, top_k) -> matches with file+range
- ctx.diff(pack_id, ref="HEAD") -> unified diff preview
- ctx.gitlog(pack_id, n=20) -> commit messages
- ctx.failures(pack_id) -> current failing tests summary
- ctx.logs(pack_id, source, tail=200) -> logs

All tools must be:
- deterministic
- redacted
- bounded output (max chars)

## 7) User Commands Mapping
- /context show -> ctx.stats + summarized file list
- /context expand -> increases depth/topk and rebuilds pack
- /context trim -> lowers budgets and rebuilds pack

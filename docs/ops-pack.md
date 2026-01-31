# TRCODER — Ops Pack (Repo Bootstrap)

## 1) Purpose
/init generates a patch that adds:
- TRCODER.md (project memory / rules)
- skills (workflow automation contracts)
- agents (subagent instructions)
- policies (lane/risk/permissions)
- hooks (pre-apply verify, post-format)
- templates (PR body, ADR)

## 2) Managed Blocks in TRCODER.md
TRCODER updates only managed blocks:
- managed:profile
- managed:commands
- managed:ci
User-written sections are preserved.

Example:
<!-- TRCODER:BEGIN managed:commands v1 -->
Typecheck: pnpm -w typecheck
Test: pnpm -w test
Lint: pnpm -w lint
Build: pnpm -w build
<!-- TRCODER:END managed:commands v1 -->

## 3) Idempotency
Repeated /init:
- re-profiles
- updates managed blocks
- does NOT overwrite user text outside blocks

## 4) Generated Folder Layout
.trcoder/
  TRCODER.md
  rules/*.md
  skills/*/SKILL.md
  agents/*.md
  policies/*.yaml
  hooks.json
  templates/*.md
  permissions.defaults.yaml

## 5) Integration with Codex/Claude
Optional portability:
- root AGENTS.md can be generated or merged.

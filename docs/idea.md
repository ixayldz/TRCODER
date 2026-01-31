# TRCODER — Idea / Vision (Final)

## Elevator Pitch
TRCODER, premium bir agentic coding CLI platformudur.
Kullanıcı model seçmez. Kullanıcı sadece hedefini ve akışını slash command’lerle yönetir:
- /plan -> plan ve tasks DAG üret
- /start -> task’leri otonom çalıştır
- /verify -> kalite kapıları
- /diff + /apply -> PR-first teslim

Model seçimi, context yönetimi, maliyet kontrolü, güvenlik ve audit TRCODER tarafından otomatik yapılır.

## Why Now
- Agentic coding CLI’lar güçlendi fakat enterprise-grade disiplin eksik:
  - Model seçimi kullanıcıda -> yanlış karar / maliyet patlaması
  - Context şişmesi -> token maliyeti
  - Permission ve audit yok -> güvenlik riski
  - PR-first yok -> kontrolsüz repo yazma

TRCODER bu boşluğu “policy-driven orchestrator” ile kapatır.

## Principles (Non-negotiable)
1) User does NOT choose model.
2) Slash commands drive workflows; mode is derived from command context.
3) Patch-first: Repo’ya doğrudan yazma yok; her şey patch/diff artifact olarak üretilir.
4) PR-first: /apply branch+commit+push+PR açar.
5) Apply öncesi strict verify her zaman çalışır.
6) Permissions explicit: allow / ask / deny.
7) Budget-aware routing: expected vs actual cost; anomaly detection; bounded loops.
8) Auditability: her şey ledger event.

## Product Positioning
- “Claude Code / Codex CLI / OpenCode” gibi araçların en iyi yanlarını birleştirir:
  - Plan-first workflow (/plan approve -> /start)
  - Slash command productivity (komut katalogu + custom commands)
  - Subagents (planner, implementer, verifier, reviewer, simplifier)
  - Hooks (pre-apply strict verify, post-tool format)
  - Permissions system (dontAsk/ask/deny ile güvenli otonomi)
  - Ledger + billing + enterprise reporting

## V1 Deliverable
- TS monorepo: CLI + Server + Shared.
- Mock provider ile E2E: /plan -> tasks -> approve -> /start -> verify -> diff -> apply (apply V1’de stub olabilir).
- Gerçek provider entegrasyonları interface arkasında (V1 sonunda).

# TRCODER Progress Durumu (V1)

Tarih: 2026-01-31
Durum ozeti:
- V1 spesifikasyon uyumu: %100 (dokumanlara gore zorunlu tum maddeler tamam)
- V1 RC gate kapsami (lokal test+kod): %100
- Uretime hazirlik seviyesi: %94-96 (prod entegrasyonlari eksik)
- Uygulama toplam ilerleme: %98-99 (V1 + RC kanitlari tamam, prod-grade eksikler kaldı)

## 1) Kapsam ve Kaynaklar
Referans spesifikasyonlari:
- docs/*.md
- config/*
- schemas/tasks.v1.schema.json
- tasks/example.tasks.v1.json
- AGENTS.md

Non-negotiable kurallar (uygulandi):
- Kullanici model secemez, router secer.
- Patch-first (/start repo yazmaz, patch/artifact uretir).
- PR-first (/apply tek yazma aksiyonu, strict verify oncesi zorunlu).
- Permissions allow/ask/deny enforced.
- Ledger append-only ve billing kaynagi.
- Lane/risk/budget/context kontroller routing ve verify etkiler.
- SSE output docs/output-format.md standardinda.

## 2) Uygulama Durumu (Detayli)

### 2.1 Monorepo ve Paket Yapisi (Tamam)
- packages/shared: types, config loaders, router, cost calculator
- packages/server: Fastify server, sql.js DB, SSE/WS, ledger, billing
- packages/cli: interactive shell, parser, runner client, SSE client

### 2.2 CLI (Tamam)
Komutlar (docs/command-catalog.md):
- /help, /whoami
- /plan, /plan approve, /plan status, /plan diff
- /start, /start --task, /next
- /run status|pause|resume|cancel
- /tasks, /attach
- /context show|expand|trim|rebuild
- /pins add|rm|list
- /verify [--target]
- /fix (bounded by policy)
- /diff
- /apply (strict verify + worktree + commit + push; PR adapter stub)
- /usage today|month
- /invoice preview
- /cost explain
- /lane set, /risk set, /budget cap|status
- /permissions allow|ask|deny
- /doctor
- /logs tail
- /project status
- /pr status (stub)
- /init

Notlar:
- Slash parser eklendi (quoted arg destekli).
- High risk task/paths icin onay zorunlulugu (TYPE: RISK HIGH).
- /apply worktree-first izolasyonlu; basarisizlikta temizler.
- /context expand/trim server rebuild yapar; pin set gunceller.

### 2.3 Server API (Tamam)
API contract uyumlu endpointler:
- Project: /v1/projects/connect
- Plan: /v1/projects/:id/plan, /plan/approve, /plan/status, /plan/tasks
- Runs: /v1/projects/:id/runs/start, /v1/runs/:id/status, /runs list, /pause|resume|cancel
- Verify: /v1/runs/:id/verify
- Streaming: /v1/runs/:id/stream (SSE)
- Context packs: /v1/packs/:id/stats|rebuild|list|read|search|diff|gitlog|failures|logs
- Billing: /v1/usage/month, /v1/usage/today, /v1/invoice/preview, /v1/cost/explain
- Logs/Ledger: /v1/logs/tail, /v1/ledger/export
- Init: /v1/projects/:id/init

### 2.4 Context Fabric / ctx.* (Tamam, V1)
- ctx.stats/list/read/search/diff/gitlog/failures/logs hepsi mevcut.
- Redaction zorunlu ve server tarafinda uygulanir.
- Bounded output limitleri uygulandi.
- Server authoritative: /context show stats endpointi kullanir.
- expand/trim server rebuild -> yeni pack_id.

### 2.5 Routing/Policy (Tamam)
- Router model secimi: model-stack + lane-policy + risk-policy.
- Budget aware selection + downgrade rules.
- Risk min tier enforcement.
- Explainability /cost explain.
- Konfig validasyonu (fail-fast): model/lane/risk tutarliligi (server startup).

### 2.6 Ledger + Billing (Tamam)
- Ledger append-only events (RUN/PLAN/TASK/LLM/VERIFY/RUNNER/BILLING/ANOMALY).
- Billing: credits provider_costtan dusulur, markup kalan kisme uygulanir.
- /usage month & /invoice preview ledgerdan hesaplar.

### 2.7 Permissions (Tamam)
- allow/ask/deny policy enforced (server + runner).
- CLI /permissions edit; effective policy + override ayrimi.

### 2.8 Runner WS Auth (Tamam)
- Authorization: Bearer API key + X-TRCODER-Project zorunlu.
- Runner session_id ile bind.
- Resultlarda session_id dogrulama.

### 2.9 Artifacts (Tamam)
- Server-side storage (logical artifacts/ path).
- Local dev: ~/.trcoder/artifacts/
- Repo icine yazma sadece /export (opsiyonel).

### 2.10 Ops Pack (/init) (Tamam)
- TRCODER.md managed blocks idempotent.
- .trcoder/ rules, policies, hooks, templates, agents, skills.
- Portable opsiyon: AGENTS.md.

### 2.11 DB Adapter (Tamam)
- IDb interface: migrate/close/exec/query/transaction.
- SqlJsDb default (Windows/dev/test).
- PostgresDb stub (V1 icin opsiyonel).
- Testlerde in-memory sql.js.

## 3) Test Durumu
Unit:
- parser
- config loaders
- router decision
- cost calculator
- permissions classifier
- ledger append-only
 - cost-per-call (ledger based)

Integration:
- CLI/server plan-start-verify
- SSE stages + SESSION_STATS
- Runner WS
 - API contract coverage
 - Command catalog coverage
 - Ledger coverage (canonical events)
 - Permissions negative (deny/ask)
 - Plan stale detection
 - Router non-override
 - Patch-first/PR-first

Son test kosumu:
- pnpm test (basarili, Node uyarisi: engine 20.11.x yerine v24.13.0)
- pnpm -r typecheck (basarili)
- pnpm -r lint (basarili)

## 3.1 RC Checklist Durumu (docs/release/v1-rc.md)
0) Build & Environment
- pnpm pinned: packageManager=pnpm@9.12.1 (tamam)
- node pinned: package.json engines + .nvmrc/.node-version (tamam)
- Lokal kanit: node -v = v22.12.0, pnpm -v = 9.12.1 (Node versiyonu spec'teki 20.11.x ile uyumsuz; CI/RC kaniti gerekiyor)
- RC runbook otomasyonu: scripts/rc-run.ps1 duzeltildi, artifact seti uretildi (rc-20260201-015044)
 - Node 20.11.1 kullanildi ve env.txt kaydedildi
- GitHub Actions CI (node 20.11.1): https://github.com/ixayldz/TRCODER/actions/runs/21552663768

1) Spec Compliance Gate
- Command catalog coverage testi: packages/cli/test/command-catalog.test.ts (PASS)
- API contract coverage testi: packages/server/test/api-contract.test.ts (PASS)
- Ledger coverage testi: packages/server/test/ledger-coverage.test.ts (PASS)
- SSE stage coverage testi: packages/server/test/sse-stage.test.ts (PASS)
- Permissions negative testi: packages/server/test/permissions-negative.test.ts (PASS)
- Context fabric redaction testi: packages/server/test/redaction.test.ts (PASS)
- Plan stale testi: packages/server/test/plan-stale.test.ts (PASS)

2) Core Safety Gate
- Model override reject: packages/server/test/router-nonoverride.test.ts (PASS)
- Patch-first/PR-first: packages/server/test/patchfirst-prfirst.test.ts (PASS)
- Runner WS auth: packages/server/test/runner-ws-auth.test.ts (PASS)

3) Billing Gate
- Per-call accounting: packages/shared/test/cost-per-call.test.ts (PASS)
- Invoice preview: packages/server/test/invoice-preview.test.ts (PASS)
- Usage endpoints: packages/server/test/usage.test.ts (PASS)

4) UX Gate
- Parser: packages/cli/test/parser.test.ts (PASS)
- /doctor: CLI tarafinda server + runner ws status raporluyor (manual)
- /logs tail: API ve CLI akisi calisir (manual)

5) Cross-Platform Gate
- Lokal testler Windows'ta PASS
- GitHub Actions CI eklendi (ubuntu/macos/windows, node 20.11.1, pnpm 9.12.1)
- Linux: https://github.com/ixayldz/TRCODER/actions/runs/21552663768/job/62103750785 (PASS)
- macOS: https://github.com/ixayldz/TRCODER/actions/runs/21552663768/job/62103750790 (PASS)
- Windows: https://github.com/ixayldz/TRCODER/actions/runs/21552663768/job/62103750786 (PASS)

6) Security Notes
- docs/security.md ve docs/providers.md eklendi (PR adapter + Postgres stub net)

## 4) Kalanlar / Prod Hazirlik (V1 disi veya stub)
V1 dokumana gore izinli eksikler:
- PR adapter: stub (gercek GitHub/GitLab entegrasyonu yok)
- Postgres driver: stub

Prod-grade icin eksikler (V1 disi):
- Gercek model provider entegrasyonlari + retry/fallback
- Artifacts icin remote store (S3/GCS) + retention
- Secret storage tam entegrasyon (keychain)
- Observability (structured logs, tracing, metrics)
- CI/CD pipeline + release otomasyonu
- Rate limiting / abuse protection

RC sign-off icin eksikler:
- Yok (RC kanitlari ve CI linkleri tamam)

## 5) Risk / Notlar
- LF/CRLF uyarilari Windows kaynakli (kosmetik).
- Vite CJS uyari giderildi (vitest.config.mts).
- Konfig validasyonlari fail-fast: hatali config ile server baslamaz (istenen davranis).

## 6) MVP %100 icin kalanlar (neredeyse tamamlanan MVP)
MVP core akisi tamam; %100 icin kalanlar operasyonel ve kanit seti odakli:
- CI kanitlari: Windows/macOS/Linux kurulum + test pipeline linkleri.
- RC artifact seti: ledger.jsonl, sse.log, invoice-preview.json, ctx-redaction-report.md, apply-report.md, doctor.txt.
- Node 20.11.x ile dogrulanmis test ciktisi (engine uyumu kaniti).
- Minimal release runbook: V1 RC icin tek komut/script (CI veya lokal) ile kanit cikartma.
Yazilim davranisi acisindan MVP tam; eksikler denetim/kanit ve release disiplini.

## 7) Sonuc
- V1 kapsaminda TRCODER tam uyumlu ve calisir durumda.
- V1 RC gate'leri lokal testlerle karsilandi; RC kanit/artifact ve CI linkleri eksik.
- Uretim seviyesinde %85-90; kalanlar prod sertlestirme ve entegrasyonlar.


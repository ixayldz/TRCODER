# TRCODER — CLI UX Spec (Slash Command First)

## 1) UX Goals
- “Snappy” CLI: hızlı cold start, streaming updates, minimal back-and-forth.
- Pro feel: her run/task için standart blok formatı, cost/time/quality görünür.
- Paralel iş: aynı anda birden fazla run izlenebilir (V1: list + attach).
- Güven: permissions + gates + açıklanabilir router kararları.

## 2) Shell
Command style:
- `trcoder shell` -> interactive
- prompt: `trcoder[<project>]>`
- slash commands: `/plan`, `/start`, `/verify`, `/diff`, `/apply`

Non-shell:
- `trcoder connect`
- `trcoder doctor`

## 3) Output Standard Blocks
- Banner
- Task header
- Stage updates (timestamped)
- Task result block
- Session stats

Full format refer: docs/output-format.md

## 4) Attach/Detach
- V1 minimal:
  - `/tasks` run list
  - `/attach <run_id>` to stream updates
  - detach: Ctrl+C (run continues server-side)

## 5) Notifications (V2+)
- Desktop notifications when run needs input.
(V1: log line “NEEDS_INPUT”)

## 6) Safety UX
- Dangerous action -> requires explicit typed confirmation:
  - “TYPE: APPLY” gibi
- Budget anomaly -> auto pause + suggestions:
  - /context trim
  - lane change
  - rerun verify

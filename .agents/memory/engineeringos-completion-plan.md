---
name: EngineeringOS completion plan
description: How to sequence further work on the EngineeringOS project per its phased completion plan.
---

The user supplied a 10-phase plan (Arabic PDFs) to take EngineeringOS from "operational skeleton" to
a coherent platform. Canonical, code-verified versions live in the repo:

- `docs/fact-record.md` — file-by-file truth: what exists, what's missing, priority.
- `docs/completion-plan.md` — the phase sequence and acceptance criteria.

**Why a fixed order matters:** the source docs explicitly warn that starting from the UI or from the
workflow engine before data integrity is solid creates a nice-looking layer on an unstable
foundation, and that expanding the scanner before wiring it to graph/metrics produces isolated,
useless results. Sequence: data integrity → backend execution hardening → scanner/graph depth →
graph as knowledge layer → workflow engine → unified audit/traceability → tests → UI depth → docs.

**How to apply:** before picking up further phases of this project, read `docs/fact-record.md` first
(verify it against current code — it can drift), then `docs/completion-plan.md` for what's next in
sequence. Update both docs after each phase lands.

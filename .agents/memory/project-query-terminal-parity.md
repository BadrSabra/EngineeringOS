---
name: Project-query terminal parity
description: Durable rules for keeping project-query semantic acceptance, terminal diagnostics, and persisted public projections consistent.
---

Project-query acceptance must be derived from one server-owned terminal projection that carries the semantic verdict, final state, answer type, evidence identity, and diagnostic outcome through SSE, checkpoints, persisted traces, history, and dashboard reloads. When an outer forensic turn carries a `PROJECT_QUERY_*` objective, use the inner objective for evidence/terminal semantics and suppress Finding-oriented forensic status/terminal events and fallback reports.

**Why:** A live project query once read complete evidence and was accepted as SUCCEEDED, while its persisted trace omitted `objectiveVerdict` and also contained the generic forensic `NO_EVIDENCE_FOUND` / `ANALYSIS_INCOMPLETE` projection. The transient in-memory acceptance passed, but replay could not reproduce the decision. Recovery failure telemetry may remain recorded, but it is provisional after server-owned objective closure has passed.

**How to apply:** Never treat symbol mentions and complete reads as a semantic project answer. Require an answer contract that explains the requested behavior, and fail closed when `finalAnswerType`, `finalState`, objective verdict, or terminal diagnostic disagree. Project-query runs need a project-query terminal classification instead of generic forensic terminal semantics; only a passed server-owned operation/revision/claim closure may make prior provider recovery failure non-terminal. Evaluate that closure before any generic forensic incomplete-report fallback, and never let the fallback overwrite an accepted project-query response.
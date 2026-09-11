---
name: Project-query terminal parity
description: Durable rules for keeping project-query semantic acceptance, terminal diagnostics, and persisted public projections consistent.
---

Project-query acceptance must be derived from one server-owned terminal projection that carries the semantic verdict, final state, answer type, evidence identity, and diagnostic outcome through SSE, checkpoints, persisted traces, history, and dashboard reloads.

**Why:** A live project query once read complete evidence and was accepted as SUCCEEDED, while its persisted trace omitted `objectiveVerdict` and also contained the generic forensic `NO_EVIDENCE_FOUND` / `ANALYSIS_INCOMPLETE` projection. The transient in-memory acceptance passed, but replay could not reproduce the decision.

**How to apply:** Never treat symbol mentions and complete reads as a semantic project answer. Require an answer contract that explains the requested behavior, and fail closed when `finalAnswerType`, `finalState`, objective verdict, or terminal diagnostic disagree. Project-query runs need a project-query terminal classification instead of generic forensic terminal semantics.
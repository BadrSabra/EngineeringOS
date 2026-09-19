---
name: Project-query terminal parity
description: Durable rules for keeping project-query semantic acceptance, terminal diagnostics, and persisted public projections consistent.
---

Project-query acceptance must be derived from one server-owned terminal projection that carries the semantic verdict, final state, answer type, evidence identity, and diagnostic outcome through SSE, checkpoints, persisted traces, history, and dashboard reloads. When an outer forensic turn carries a `PROJECT_QUERY_*` objective, use the inner objective for evidence/terminal semantics and suppress Finding-oriented forensic status/terminal events and fallback reports.

**Why:** A live project query once read complete evidence and was accepted as SUCCEEDED, while its persisted trace omitted `objectiveVerdict` and also contained the generic forensic `NO_EVIDENCE_FOUND` / `ANALYSIS_INCOMPLETE` projection. The transient in-memory acceptance passed, but replay could not reproduce the decision. Recovery failure telemetry may remain recorded, but it is provisional after server-owned objective closure has passed.

**How to apply:** Never treat symbol mentions and complete reads as a semantic project answer. Require an answer contract that explains the requested behavior, and fail closed when `finalAnswerType`, `finalState`, objective verdict, or terminal diagnostic disagree. Project-query runs need a project-query terminal classification instead of generic forensic terminal semantics; only a passed server-owned operation/revision/claim closure may make prior provider recovery failure non-terminal. Evaluate that closure before any generic forensic incomplete-report fallback, and never let the fallback overwrite an accepted project-query response. Do not feed a targeted project-query trace with no real forensic terminal/status into the generic forensic diagnostic projector: an evidence-integrity row alone must not synthesize `ANALYSIS_INCOMPLETE`. When the route cannot pass the project-query flag explicitly, infer it from the server-owned source-selection or decision-trace step before appending any forensic diagnostic.

For project orientation, complete role coverage is the server-owned semantic closure. The final trace must derive its objective verdict and terminal state from that same orientation closure before persistence; `SUCCEEDED`/`PROVEN` must never coexist with `RECOVERY_REQUIRED` or `ANALYSIS_INCOMPLETE` in the same public trace.

**Why:** A real orientation execution completed all manifest reads and durable acceptance recorded `PROVEN`, but the earlier trace projection classified the generic objective gate as unproven, leaving a contradictory `RECOVERY_REQUIRED`/`ANALYSIS_INCOMPLETE` diagnostic in the persisted message.

**How to apply:** Add an orientation-specific terminal projection or explicitly feed `orientationCoverage.complete` into the existing objective classifier, then assert the cross-layer invariant at the orchestrator and SSE/persistence boundaries.

Historical dashboard projections must identify PROJECT_QUERY turns from the persisted turn intent or server-owned source-selection/decision markers before rendering any generic forensic diagnostic. Preserve the answer and source coverage while suppressing only the contradictory legacy diagnostic.

**Why:** Older message rows cannot be rewritten by the backend projection fix, so reloads could still show `ANALYSIS_INCOMPLETE` beside a complete project-query answer.

**How to apply:** Keep this normalization at the message-render boundary and cover both top-level `forensicDiagnostic` and `tool_trace` diagnostic entries in a history-render regression.
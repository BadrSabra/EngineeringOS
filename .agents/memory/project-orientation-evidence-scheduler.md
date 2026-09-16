---
name: Project orientation evidence scheduler
description: Project-orientation source roles must be part of the server-owned evidence manifest, not only a final coverage diagnostic.
---

Project-orientation planning and acceptance must share one server-owned manifest. The role paths for purpose, components, primary flow, and uncertainty must reach the evidence scheduler as required reads; keeping them only in query-plan metadata lets the model stop after arbitrary reads and produces a late incomplete response.

**Why:** A production session reached only two model-chosen manifest files, while the final orientation gate correctly required four roles. No forced target or recovery ran because the loop objective had no orientation paths.

**How to apply:** When changing orientation planning, verify planner fallback, valid-plan scheduling, forced missing-path reads, provider fallback, and terminal/history projections together. Fallback manifests may use only bounded structured graph paths; if the manifest is empty, stop or diagnose before model-chosen exploration because recovery cannot activate. Source-backed output exposes read-backed paths, never raw model provenance. Preserve fail-closed acceptance; do not relax the final coverage gate.

Source-backed project orientation is a separate durable acceptance contract from targeted PROJECT_QUERY objectives. It must persist complete source reads and require the server-owned role-coverage verdict without inventing targeted objective claims.

**Why:** A generic explanation has no project-query target or claim contract, so forcing it through targeted objective validation either rejects a valid explanation or weakens the objective gate.

**How to apply:** Keep `PROJECT_QUERY` and tool execution unchanged; mark orientation turns as source-evidence-required at terminalization, persist the retained reads, and accept only when orientation coverage is complete for the same operation and revision.

There is a separate terminalization invariant: orientation coverage must gate acceptance even when `proofRequired` is false. Generic complete-read evidence can otherwise be projected as `PROVEN` while the role coverage record is incomplete.

**Why:** A real orientation turn returned `ANALYSIS_INCOMPLETE` with `components` missing, but `completeAiExecution` accepted it because its orientation gate was nested under `proofRequired`; the evidence snapshot then reflected five complete reads rather than semantic orientation coverage.

**How to apply:** Treat `projectOrientation` as its own source-evidence acceptance contract. Keep the role manifest fail-closed, require `orientationCoverageComplete` at the terminal seam, and prevent incomplete orientation responses from entering session memory.

Resume handling must reuse the existing `resumeContract` and retained-evidence seed path without promoting orientation to `proofRequired`. The route should load revision-bound complete reads for persisted orientation executions; the orchestrator already seeds its prefetch statuses and tool cache from those reads.

**Why:** `proofRequired` activates targeted project-query claim acceptance, while orientation has a distinct role-coverage gate. Adding a second cache hydrator would duplicate the orchestrator's existing retained-evidence initialization and could create divergent read cursors.

**How to apply:** Extend the existing resume eligibility/load conditions for persisted `projectOrientation` requests, preserve root/revision/operation checks, and keep generic non-orientation `PROJECT_QUERY` turns non-resumable.
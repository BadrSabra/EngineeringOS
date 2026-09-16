---
name: Project orientation evidence scheduler
description: Project-orientation source roles must be part of the server-owned evidence manifest, not only a final coverage diagnostic.
---

Project-orientation planning and acceptance must share one server-owned manifest. The role paths for purpose, components, primary flow, and uncertainty must reach the evidence scheduler as required reads; keeping them only in query-plan metadata lets the model stop after arbitrary reads and produces a late incomplete response.

**Why:** A production session reached only two model-chosen manifest files, while the final orientation gate correctly required four roles. No forced target or recovery ran because the loop objective had no orientation paths.

**How to apply:** When changing orientation planning, verify planner fallback, valid-plan scheduling, forced missing-path reads, provider fallback, and terminal/history projections together. Fallback manifests may use only bounded graph-summary paths; source-backed output exposes read-backed paths, never raw model provenance. Preserve fail-closed acceptance; do not relax the final coverage gate.
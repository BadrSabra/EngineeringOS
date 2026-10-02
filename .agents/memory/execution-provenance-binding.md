---
name: Execution provenance binding
description: Durable AI executions bind source reads and acceptance to the managed root and workspace revision.
---

Managed project root and workspace revision are one provenance contract for durable AI executions. New executions must persist both before provider work, resumes must reject drift, and evidence snapshots must reject explicitly mismatched provenance. For candidate-based recipe executions, distinguish the project root from the execution workspace root: persist the latter in both the durable request and execution row.

**Why:** A successful provider turn can still be invalid if reads came from a different root or revision; accepting that result would make the proof non-reproducible. Request and row identity must also agree during idempotent recovery.

**How to apply:** Carry root and revision through the durable request, execution creation, resume checks, completion/failure paths, and acceptance snapshots. For candidate-based recipes, assert request workspace root equals the row's top-level workspace root, even when it differs from `projects.root_path`. Keep compatibility for legacy rows only when they have no persisted provenance; never weaken checks for newly created executions.
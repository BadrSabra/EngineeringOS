---
name: Execution provenance binding
description: Durable AI executions bind source reads and acceptance to the managed root and workspace revision.
---

Managed project root and workspace revision are one provenance contract for durable AI executions. New executions must persist both before provider work, resumes must reject drift, and evidence snapshots must reject explicitly mismatched provenance. For candidate-based recipe executions, distinguish the project root from the execution workspace root: persist the latter in both the durable request and execution row.

Mission Observe can ground claims from server-owned manifest prefetches; those reads remain evidence even when the provider issues no `read_file` call. Its project-context revision is a distinct identity from `projects.updatedAt` and the workspace tree hash: bind the evidence graph to the exact context revision, then independently verify the approved root, project timestamp, and tree hash around the retained source snapshot. Do not require the context revision to equal the project timestamp.

**Why:** A successful provider turn can still be invalid if reads came from a different root or revision; accepting that result would make the proof non-reproducible. Context metadata may use a different revision identity, and provider-issued reads are not the only valid source of server-retained evidence.

**How to apply:** Carry root and revision through the durable request, execution creation, resume checks, completion/failure paths, and acceptance snapshots. For Mission Observe, assert graph-to-context revision equality and independently bind server-prefetched reads to the current managed root and tree snapshot; browser tests should assert those server-owned read receipts rather than provider tool calls. For candidate-based recipes, assert request workspace root equals the row's top-level workspace root, even when it differs from `projects.root_path`. Keep compatibility for legacy rows only when they have no persisted provenance; never weaken checks for newly created executions.
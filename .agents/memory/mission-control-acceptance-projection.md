---
name: Mission Control acceptance projection
description: Targeted execution acceptance must be projected from durable acceptance rows and proof requirements, not inferred from provider success alone.
---

Mission Control should receive the server-owned acceptance snapshot for each execution and derive a visible status from its outcome, terminal state, evidence completeness, and proof requirement. A targeted run with `proofRequired` and incomplete evidence must remain visibly incomplete even when the provider or execution state says succeeded.

**Why:** The dashboard previously hid the acceptance region when the API ledger omitted the persisted acceptance row, and a successful provider response could be mistaken for accepted proof.

**How to apply:** Keep the API projection and Dashboard status mapping aligned with the public acceptance contract, including `SUCCEEDED`, `FAILED`, `INTERRUPTED`, `NONE`, and incomplete next-action states.

An accepted terminal execution must not retain a nested autonomous operation in
`validating`; the server-owned completion finalizer must close it as
`succeeded` only after objective/evidence acceptance passes.

**Why:** A real proof-bearing project analysis reached `completed`,
`SUCCEEDED`, and `PROVEN` while its checkpoint operation remained
`validating`, so recovery phase and acceptance state could disagree after
reload.

**How to apply:** Normalize terminal operation state in the shared completion
path, not in a new projection layer or provider callback, and cover project
analysis through persisted checkpoint and public reload surfaces.

Goal acceptance should also carry one server-owned projection on the existing
Goal outcome contract: accepted references, source revision, project/candidate
scope, validator IDs, receipt identity, and verdict. Task and Recipe executors
may produce different receipts, but Mission status must consume the same
projection boundary.

**Why:** Separate Task and Recipe status sync paths otherwise expose completion
without a durable, comparable proof record and make later Workflow/Delivery
adapters invent incompatible acceptance shapes.

**How to apply:** Project only allowlisted acceptance metadata after durable
finalization; never copy provider diagnostics or evidence bodies into the Goal
contract.
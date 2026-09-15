---
name: Mission Control acceptance projection
description: Targeted execution acceptance must be projected from durable acceptance rows and proof requirements, not inferred from provider success alone.
---

Mission Control should receive the server-owned acceptance snapshot for each execution and derive a visible status from its outcome, terminal state, evidence completeness, and proof requirement. A targeted run with `proofRequired` and incomplete evidence must remain visibly incomplete even when the provider or execution state says succeeded.

**Why:** The dashboard previously hid the acceptance region when the API ledger omitted the persisted acceptance row, and a successful provider response could be mistaken for accepted proof.

**How to apply:** Keep the API projection and Dashboard status mapping aligned with the public acceptance contract, including `SUCCEEDED`, `FAILED`, `INTERRUPTED`, `NONE`, and incomplete next-action states.
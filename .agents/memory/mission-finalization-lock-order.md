---
name: Mission finalization lock order
description: Prevent deadlocks between linked terminal acceptance projections and proof-gated Mission completion.
---

When terminal finalization synchronizes a linked Task or workflow Goal, acquire its Mission and Goal locks before locking the execution. Resolve the scope with non-locking identity reads, then re-read and validate under the ordered locks.

**Why:** Proof-gated completion holds Mission and Goal while reloading Canonical Proof from the execution. Execution-first finalization can form a PostgreSQL deadlock when both paths touch the same rows.

**How to apply:** Keep Mission-before-Goal-before-execution ordering for linked projections, retain the existing execution/Task lease and acceptance fences, and skip the extra scope lookup for finalizations that do not synchronize Mission state.

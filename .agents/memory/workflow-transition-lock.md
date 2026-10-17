---
name: Workflow transition serialization
description: Phase advancement must serialize the state read, condition check, and database claim.
---

Workflow phase transitions use a workflow-scoped advisory lock around the full read/check/claim sequence; a database compare-and-set alone can allow a second request to reread the newly advanced phase and perform an unintended second transition.

**Why:** Concurrent HTTP requests can otherwise execute sequentially after separate reads, producing multiple phase changes even when each individual update is atomic.

**How to apply:** Keep the lock non-blocking and return a stable conflict response; release it in a `finally` block on every exit path.

Transitions that mutate both an existing execution and its parent workflow must lock the execution first. In particular, stop must lock the latest running execution before updating the workflow; reversing the order can deadlock against phase advance, failure, retry, or rollback.

**Why:** Stop and phase transitions can reach the same running execution concurrently. If stop holds the workflow while the transition holds the execution, each can wait on the other's row lock.

**How to apply:** For paired updates to an existing execution and workflow, acquire Execution before Workflow and retain the status compare-and-set. Workflow deletion also locks running/failed executions before the workflow row, then rechecks active state before cascading history deletion. New starts remain serialized by the parent workflow row.
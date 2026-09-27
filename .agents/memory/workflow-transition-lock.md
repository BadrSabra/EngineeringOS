---
name: Workflow transition serialization
description: Phase advancement must serialize the state read, condition check, and database claim.
---

Workflow phase transitions use a workflow-scoped advisory lock around the full read/check/claim sequence; a database compare-and-set alone can allow a second request to reread the newly advanced phase and perform an unintended second transition.

**Why:** Concurrent HTTP requests can otherwise execute sequentially after separate reads, producing multiple phase changes even when each individual update is atomic.

**How to apply:** Keep the lock non-blocking and return a stable conflict response; release it in a `finally` block on every exit path.

Workflow deletion must also serialize with active and retryable executions. Lock running/failed execution rows before locking the parent workflow row, matching retry's execution-then-workflow order; then recheck active state before cascading history deletion.

**Why:** A stale dashboard state is not a safety boundary, and taking the workflow lock before a retry-held execution row can deadlock or delete history while retry is claiming it.

**How to apply:** Keep the deletion guard transactional and server-side. New starts are serialized by the parent workflow row; retryable executions are serialized by their row locks.
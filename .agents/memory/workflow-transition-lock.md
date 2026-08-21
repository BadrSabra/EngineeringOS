---
name: Workflow transition serialization
description: Phase advancement must serialize the state read, condition check, and database claim.
---

Workflow phase transitions use a workflow-scoped advisory lock around the full read/check/claim sequence; a database compare-and-set alone can allow a second request to reread the newly advanced phase and perform an unintended second transition.

**Why:** Concurrent HTTP requests can otherwise execute sequentially after separate reads, producing multiple phase changes even when each individual update is atomic.

**How to apply:** Keep the lock non-blocking and return a stable conflict response; release it in a `finally` block on every exit path.
---
name: Task progress cursors
description: Durable sequencing rules for task progress replay across retries and resumed executions.
---

Task progress sequences are a single monotonic cursor for the task, not a counter that restarts with each execution attempt. REST and SSE consumers use one task-scoped cursor, so a retry cannot make new sequence values appear older than the browser's last cursor.

**Why:** A browser reconnect can retain the previous task cursor while a retry starts a new execution. Per-execution counters then cause the reconnect query to skip the new execution's events.

**How to apply:** When adding task progress writers or replay endpoints, serialize sequence allocation with the task ownership row and compare/replay against the task-wide maximum. Keep legacy null-sequence rows as initial-snapshot compatibility data.
---
name: Task progress cursors
description: Durable sequencing rules for task progress replay across retries and resumed executions.
---

Task progress sequences are a single monotonic cursor for the task, not a counter that restarts with each execution attempt. REST and SSE consumers use one task-scoped cursor, so a retry cannot make new sequence values appear older than the browser's last cursor.

**Why:** A browser reconnect can retain the previous task cursor while a retry starts a new execution. Per-execution counters then cause the reconnect query to skip the new execution's events.

**How to apply:** When adding task progress writers or replay endpoints, serialize sequence allocation with the task ownership row and compare/replay against the task-wide maximum. Keep legacy null-sequence rows as initial-snapshot compatibility data.

Progress projections must also bind to the Task's current correlation and the exact attempt from its current linked AI execution. Resume may preserve the correlation while advancing the durable execution attempt; the highest attempt present in logs can therefore still be stale. While a running execution identity is being refreshed or cannot be validated, withhold structured progress.

**Why:** A resumed execution can advance its attempt before it emits its first new progress event, leaving prior-attempt log rows as the newest visible entries.

**How to apply:** Use the current execution endpoint's attempt together with Task and correlation identity when projecting progress. Do not infer the current attempt from the maximum log attempt; keep historical log rows visible only as history.
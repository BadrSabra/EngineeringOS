---
name: Durable session-state ordering
description: Resumable AI session state must be guarded by its own progress timestamp when concurrent streamed turns can finish out of order.
---

Streamed turn completions can acquire the session row lock in a different order from request submission. Guarding only with the session updated timestamp can allow an older completion to overwrite a newer execution plan or evidence state.

**Why:** The transaction lock serializes writes but does not encode which turn owns the newer resumable contract; late completions otherwise resurrect stale continuation state.

**How to apply:** Compare the persisted active state’s validated progress timestamp inside the SQL update, with a safe fallback to the row timestamp, and keep stateful Vitest files in separate processes when their module mocks share provider state.
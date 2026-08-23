---
name: Task execution lifecycle
description: Standalone AI task runs share durable execution ownership with chat runs while retaining task retry semantics.
---

The durable AI execution row is the source of truth for ownership, idempotency, leases, checkpoints, and attempt identity; the task row remains the user-facing state and may return to its prior retryable state after a failed attempt.

**Why:** Task execution can be initiated by both HTTP and an in-process queue, and a crash or provider failure must not allow either path to overwrite a newer claim or falsely mark a task completed.

**How to apply:** Route every AI task trigger through the shared lifecycle, claim both records conditionally, persist bounded receipts only, heartbeat long calls, and require a structured non-review result before finalizing `completed`.
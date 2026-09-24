---
name: Task execution lifecycle
description: Standalone AI task runs share durable execution ownership with chat runs while retaining task retry semantics.
---

The durable AI execution row is the source of truth for ownership, idempotency, leases, checkpoints, and attempt identity; the task row remains the user-facing state and may return to its prior retryable state after a failed attempt.

**Why:** Task execution can be initiated by both HTTP and an in-process queue, and a crash or provider failure must not allow either path to overwrite a newer claim or falsely mark a task completed.

**How to apply:** Route every AI task trigger through the shared lifecycle, claim both records conditionally, persist bounded receipts only, heartbeat long calls, and require a structured non-review result before finalizing `completed`.

Only mutation-bearing Mission tool-loop or other server-selected execution profiles need the Action/Effect spine. Read-only verification and AI reports that require human review must keep their existing acceptance semantics; neither is proof that project files changed.

**Why:** Task execution combines reporting, verification, and workspace-changing profiles. Treating every task receipt as an effect would create false mutation proof, while gating a read-only report on file deltas would break valid non-mutating work.

**How to apply:** Add action identity and direct before/after observations at the server-owned mutation boundary, bind the resulting effect bundle before successful task acceptance, and preserve the existing durable execution, lease, cancellation, and resume fences.
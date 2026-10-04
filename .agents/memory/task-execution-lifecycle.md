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

During Mission recovery, a `started` marker for a tool classified `block_after_prior_marker` means its outcome is unknown: fail closed as a non-retryable uncertainty before another provider call. Keep registry-approved safe reads replayable and preserve completed-marker behavior. Separately, a completed lifecycle status without a current-attempt acceptance must project as `UNKNOWN`, never as accepted `SUCCEEDED`.

**Why:** The marker is persisted before the tool result, so replay or synthetic success can misstate an external effect. Observation-only terminalization and lost/late acceptance also make execution status insufficient evidence of success.

**How to apply:** Classify recovery from the operational registry, persist a durable non-retryable uncertainty result without routing it through cancellation, and make terminal projections derive `SUCCEEDED` only from the matching acceptance row.

Task-level lease renewal must follow successful renewal of the authoritative AI execution lease. If either renewal fails or the task row is no longer owned, stop the local worker and leave terminalization to the current owner or reconciliation.

**Why:** Extending only the task projection after the execution lease expires makes stale work appear live and delays recovery; continuing its provider call can also produce a result after ownership has moved.

**How to apply:** Renew the execution first, extend the task lease only while its current worker/status/live lease still match, abort the local signal on a failed fence, and do not write a terminal acceptance from that attempt.
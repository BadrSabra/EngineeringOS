---
name: Durable job boundary
description: Deployment decision and invariants for scan, discovery, and AI-task recovery.
---

Postgres-backed lifecycle rows and worker leases are sufficient for the current
deployment; the in-process queue is only a bounded dispatch handle. Queued rows
must be rediscovered after restart, while expired in-flight rows are recovered
only through conditional status/lease transitions.

**Why:** Multiple API instances share the database, and a third-party queue is
not currently an operational requirement. Recovering a row without checking its
lease can interrupt a healthy worker on another instance or let two reconcilers
apply duplicate side effects.

**How to apply:** Keep claims, heartbeats, terminal writes, and reconciliation
fenced by worker identity plus status/lease predicates. Any reconciler that starts
from an unlocked lease snapshot must compare that snapshot again under the
terminal row lock before applying a recovery transition. Treat discovery as
non-checkpointable and retryable AI tasks as explicit re-trigger states rather
than silently replaying unknown work.

Queue-cap refusal is backpressure, not job completion. Keep durable rows eligible
for redispatch; if an automatic trigger uses a state that normal dispatch does not
scan, preserve an explicit retry signal or persist the dispatch intent.

**Why:** Bounding local memory prevents overload, but a refused enqueue must not
be mistaken for a durable queue entry. Some task triggers enter a verifying state
that is not itself sufficient proof of a pending dispatch.

**How to apply:** Use the detailed enqueue result when capacity matters. Leave
queued database rows unchanged on `full`; for other lifecycle states, make the
refusal visible and ensure a safe retry path rather than assuming the regular
queued-row dispatcher will recover it.

Mission recipe executions follow the same boundary: a durable `queued` row may be
rediscovered by rebuilding dispatch from the Goal action and recipe binding;
`running` or `paused` rows are not replayed automatically because their midpoint
may include an uncertain external effect.

**Why:** A queued recipe has not acquired a worker lease, while an in-flight
recipe may have crossed a side-effect boundary that cannot be inferred after a
restart.

**How to apply:** Keep recipe identity and scope derived from the persisted Goal
and execution checkpoint, enqueue through the shared bounded queue, and leave
uncertain in-flight recovery to the existing AI execution acceptance/recovery
contract.

The transactionally persisted `AiGoalRecipeDispatchRequested` event is also the outbox for the brief gap before a recipe worker creates its `ai_execution` row. If the local queue refuses the closure or the process stops before it starts, reconciliation may rebuild the request from the current Goal and retry the event, but must revalidate the event's Mission/Goal/revision/recipe binding. Existing queued, running, paused, cancelling, cancelled, or completed executions are not replayed from the event.

**Why:** A queue refusal or restart can happen after the Goal is marked running but before the recipe runner creates durable execution state. The event is committed with that Goal transition, so it can preserve dispatch intent without treating a process-local queue as durable.

**How to apply:** Treat the event as an outbox pointer, not as authorization or proof. Recompute the idempotency identity from the current persisted action, validate delegation and ownership, and let the AI execution claim/lease remain the cross-process execution boundary.

Mission external events use the existing events journal as a durable inbox:
persist the envelope before waking a Goal, deduplicate by eventId, and replay
unprocessed events when the Goal later reaches its event-wait boundary.

**Why:** Delivering an event before a Goal begins waiting must not lose the
trigger, while retries from a webhook or integration must not create duplicate
replans.

**How to apply:** Keep event payloads data-only, bind ingress to the owned Goal
and project, mark the inbox row processed only after the row-locked wake
transition succeeds, and let the normal Mission replan path continue execution.
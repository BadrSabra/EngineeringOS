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

Mission external events use the existing events journal as a durable inbox:
persist the envelope before waking a Goal, deduplicate by eventId, and replay
unprocessed events when the Goal later reaches its event-wait boundary.

**Why:** Delivering an event before a Goal begins waiting must not lose the
trigger, while retries from a webhook or integration must not create duplicate
replans.

**How to apply:** Keep event payloads data-only, bind ingress to the owned Goal
and project, mark the inbox row processed only after the row-locked wake
transition succeeds, and let the normal Mission replan path continue execution.
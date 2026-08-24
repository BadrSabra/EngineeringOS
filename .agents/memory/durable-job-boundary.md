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
fenced by worker identity plus status/lease predicates. Treat discovery as
non-checkpointable and retryable AI tasks as explicit re-trigger states rather
than silently replaying unknown work.
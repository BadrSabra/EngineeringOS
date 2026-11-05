---
name: Mission outcome snapshot idempotency
description: Keep plan outcome snapshots content-addressed and lifecycle advancement proof-bound.
---

Outcome snapshot identity must bind the decision, evidence-set hash, and complete stable evaluation payload. Exclude only `evaluatedAt`; retries with unchanged evidence must return the first persisted evaluation. Append the plan-level success lifecycle only from the server finalizer after a fresh evaluation in the same serializable transaction, and only for `ACHIEVED`.

**Why:** A retry with a different clock time is not new evidence. Comparing the whole serialized result made valid idempotent retries conflict, while binding only the evidence hash did not independently bind the stored evaluation projection.

Outcome reconciliation should scan the durable `DISPATCHED` event journal; an in-memory cursor is only a bounded paging optimization and must be disposable on restart. Since finalization performs no Goal/tool/provider work and commits snapshot plus lifecycle references transactionally, concurrency is protected by the serializable idempotent finalizer rather than a separate worker lease. Retry only known PostgreSQL serialization/deadlock conflicts, with a small bound.

**Why:** A process-local cursor cannot be the work source or survive restart. A database lease would add state without fencing external effects here; the only effects are already atomic durable writes, and an unbounded retry loop could monopolize reconciliation.

**How to apply:** Preserve the first snapshot on conflict, compare stable payloads, and verify the snapshot ID and decision/plan/dispatch bindings before accepting lifecycle references. Keep `INCONCLUSIVE` and `NOT_ACHIEVED` non-advancing; test retry identity, concurrent finalization, project scope, and the no-advance invariant. Never invoke completed Goal work during outcome recovery.

Database immutability is a separate boundary from store-level idempotency: reject ordinary UPDATE and direct DELETE in PostgreSQL, but permit referential cascades so parent cleanup remains compatible. Keep runtime access to SELECT/INSERT and schema ownership/DDL privileges in a separate migration role; table owners and superusers remain trusted administrators who can change trigger protections.

**Why:** Application-only checks cannot protect a stored evaluation from other SQL writers, while blocking FK cascades breaks existing parent cleanup. A trigger is not a defense against a role that can disable it.

**How to apply:** Install the trigger as part of the official schema-delivery command, keep that installation repeatable, and test insert/recovery, UPDATE rejection, direct DELETE rejection, and a legitimate FK cascade against PostgreSQL.

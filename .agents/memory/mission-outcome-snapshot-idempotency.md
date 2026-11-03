---
name: Mission outcome snapshot idempotency
description: Keep plan outcome snapshots content-addressed and lifecycle advancement proof-bound.
---

Outcome snapshot identity must bind the decision, evidence-set hash, and complete stable evaluation payload. Exclude only `evaluatedAt`; retries with unchanged evidence must return the first persisted evaluation. Append the plan-level success lifecycle only from the server finalizer after a fresh evaluation in the same serializable transaction, and only for `ACHIEVED`.

**Why:** A retry with a different clock time is not new evidence. Comparing the whole serialized result made valid idempotent retries conflict, while binding only the evidence hash did not independently bind the stored evaluation projection.

**How to apply:** Preserve the first snapshot on conflict, compare stable payloads, and verify the snapshot ID and decision/plan/dispatch bindings before accepting lifecycle references. Keep `INCONCLUSIVE` and `NOT_ACHIEVED` non-advancing; test both retry identity and the no-advance invariant.

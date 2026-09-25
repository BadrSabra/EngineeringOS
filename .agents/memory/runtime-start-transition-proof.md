---
name: Runtime start transition proof
description: Proof boundaries for the first P6 runtime.start World Transition.
---

For the initial P6 `runtime.start` slice:

- Preserve the existing Gate C acceptance path. World State materialization is derived post-acceptance work; failure must leave an explicit transition status and must not retroactively downgrade accepted execution.
- The runtime manager's `get()` is a local/persisted snapshot, not independent proof. Never treat a runtime row or `pid: null` alone as evidence that a runtime is absent.
- Materialize only exact observation IDs linked to the transition. The broad World State materializer can include unrelated project observations.
- Keep `restart` and `stop` outside the first slice.

**Why:** P6 needs independent before/after observations, a durable Wn→Wn+1 transition, and a later decision that consumes Wn+1. A receipt or synthetic `pending` value cannot establish the runtime effect.

**How to apply:** Add a separate, attempt-bound transition around `runtime.start`; require current direct before/after evidence before materialization, and preserve the existing acceptance result when transition materialization fails.
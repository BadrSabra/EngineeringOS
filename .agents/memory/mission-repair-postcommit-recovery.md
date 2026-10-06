---
name: Mission repair post-commit recovery
description: Safety invariants for resuming Mission repair after its aggregate commit or effect classification has been persisted.
---

For same-attempt recovery after `committed`, first verify the durable `ACTION_COMMITTED` event against the current action, execution/attempt, candidate identity, base/candidate tree hashes, validator status, and unchanged live tree. Never append the same aggregate action with changed validation semantics; a missing or conflicting commit event at a committed phase fails closed.

When the recovery manifest already has an after-observation, reuse both its before- and after-observation IDs so effect verification finds the same contract and remains idempotent. If commit exists but no after-observation was checkpointed, create a fresh observation pair only after rebuilding and revalidating the immutable candidate. Keep phase advancement monotonic, require a fresh validator receipt, and leave final acceptance to the normal proof gate. Recovery never writes to the live project root.

Attempt rotation is different from same-attempt lease recovery: rebind the immutable candidate/commit identity to the new attempt and episode, but discard validator, after-observation, effect-bundle, and effect-observed proof fields. Revalidate and rematerialize current-attempt evidence before acceptance; the new attempt must not accept the prior attempt's effect bundle.

**Why:** Recreating observations or changing commit payloads during same-attempt replay can duplicate evidence or make one action appear to have different semantics. After attempt rotation, carrying forward proof IDs would instead let stale evidence satisfy a new attempt. A checkpoint is a recovery hint, not authority to accept a mutation.

**How to apply:** For same-attempt lease handoff, verify the durable commit and reuse the recorded observation pair. For startup recovery that authorizes a new attempt, verify the immutable candidate/commit binding, require fresh validation and effect evidence, and ensure final acceptance references the new attempt's bundle. Never write the candidate into the live project root.
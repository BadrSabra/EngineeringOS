---
name: Mission repair post-commit recovery
description: Safety invariants for resuming Mission repair after its aggregate commit or effect classification has been persisted.
---

For same-attempt recovery after `committed`, first verify the durable `ACTION_COMMITTED` event against the current action, execution/attempt, candidate identity, base/candidate tree hashes, validator status, and unchanged live tree. Never append the same aggregate action with changed validation semantics; a missing or conflicting commit event at a committed phase fails closed.

When the recovery manifest already has an after-observation, reuse both its before- and after-observation IDs so effect verification finds the same contract and remains idempotent. If commit exists but no after-observation was checkpointed, create a fresh observation pair only after rebuilding and revalidating the immutable candidate. Keep phase advancement monotonic, require a fresh validator receipt, and leave final acceptance to the normal proof gate. Recovery never writes to the live project root.

**Why:** Recreating observations or changing commit payloads during replay can duplicate evidence or make one action appear to have different semantics. A checkpoint is a recovery hint, not authority to accept a mutation.

**How to apply:** Use these rules for Mission repair crash recovery across committed and effect-classified phases; keep durable event, observation, effect, and acceptance identities bound to the same execution attempt.
---
name: Execution acceptance contract
description: Proof requirements must survive recovery and terminalization even when the recovery caller has no in-memory evidence parameters.
---

The persisted execution request is the authoritative source for whether proof is required and which workspace revision it belongs to. Terminal acceptance and lease reconciliation must derive that contract from the locked execution row, then record an incomplete evidence snapshot when a proof-bearing run ends without evidence.

**Why:** Recovery paths intentionally reconstruct execution state after the original request handler is gone; trusting optional in-memory evidence parameters can silently downgrade a required proof run into an apparently complete, unproven acceptance.

**How to apply:** Lock the execution row before finalization, preserve `proofRequired` and revision binding from the stored request, and never let missing recovery parameters convert required evidence into `evidenceRequired=0`.
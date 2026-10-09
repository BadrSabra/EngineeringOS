---
name: Execution acceptance contract
description: Proof requirements must survive recovery and terminalization even when the recovery caller has no in-memory evidence parameters.
---

The persisted execution request is the authoritative source for whether proof is required and which workspace revision it belongs to. Terminal acceptance and lease reconciliation must derive that contract from the locked execution row, then record an incomplete evidence snapshot when a proof-bearing run ends without evidence.

**Why:** Recovery paths intentionally reconstruct execution state after the original request handler is gone; trusting optional in-memory evidence parameters can silently downgrade a required proof run into an apparently complete, unproven acceptance.

**How to apply:** Lock the execution row before finalization, preserve `proofRequired` and revision binding from the stored request, and never let missing recovery parameters convert required evidence into `evidenceRequired=0`.

On resume, the persisted request also drives source-read collection; the current turn-intent label cannot suppress reads required by the stored proof contract. Explicit artifact-only, mission-validation, apply-changes, and runtime-start modes remain source-free. A pending proposal can finish review-ready with `evidenceComplete=0` only when its project, session, operation, and assistant-message bindings match; that state is never Canonical Proof.

**Why:** A resumed request can be classified as a delivery-style turn even though its stored contract still requires source evidence. Separately, a valid pending proposal must remain reviewable without turning incomplete evidence into proof.

**How to apply:** Keep resume collection aligned with stored proof modes, and preserve both the valid review-ready case and a misbound-proposal rejection test whenever finalization or Canonical Proof gates change.

For generic resume-capability issuance, when the persisted request parses with `proofRequired: true`, require a current-attempt acceptance authorizing resumability; a `paused` status without that acceptance is not sufficient. Keep non-proof legacy token refresh separate from proof-bearing recovery. Malformed-request handling is a separate boundary.

**Why:** A legacy or incomplete paused row has no server-owned acceptance decision. Issuing a proof-bearing execution capability from status alone would bypass that decision boundary even though token issuance is not itself proof of success.

**How to apply:** Check the current-attempt acceptance while holding the execution/acceptance recovery transaction. Preserve the proof obligation from the persisted request, and assess operator-recovery paths under their own explicit contract rather than assuming this generic-token rule covers them.
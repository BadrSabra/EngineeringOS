---
name: Workflow phase ledger
description: Durable workflow phases use the shared AI execution ledger rather than a parallel worker state.
---

Each workflow execution/phase pair has one idempotent operation identity. An empty `phaseSteps` array is a true no-op: it may be durably recorded with `proofRequired=false`, but must not create an `AutonomousOperationContract`, Canonical Proof, or Goal/Mission projection. A non-empty phase remains fail-closed until substantive, revision-bound evidence exists. If completion throws after its transaction may have committed, reload acceptance for the same execution, attempt, and operation before persisting failure.

**Why:** A root-directory check and server-authored node status do not prove declared work was performed. A failed phase result alone also does not prove a finalization hook ran; an earlier evidence gate may have failed first.

**How to apply:** Keep production no-op phases outside Goal/Mission projection. When testing a projection seam directly, inject the projection only at the finalizer boundary; rollback fault tests must prove the injected write was reached with a witness that survives transaction rollback. For non-empty phases, require substantive revision-bound evidence before acceptance or Goal/Mission completion; do not treat local phase status as proof.
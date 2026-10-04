---
name: Workflow phase ledger
description: Durable workflow phases use the shared AI execution ledger rather than a parallel worker state.
---

Each workflow execution/phase pair has one idempotent operation identity. An empty `phaseSteps` array is a true no-op: it may be durably recorded with `proofRequired=false`, but must not create an `AutonomousOperationContract`, Canonical Proof, or Goal/Mission projection. A non-empty phase remains fail-closed until substantive, revision-bound evidence exists. If completion throws after its transaction may have committed, reload acceptance for the same execution, attempt, and operation before persisting failure.

**Why:** A root-directory check and server-authored node status do not prove declared work was performed. Keeping empty phases outside the proof-bearing operation gate preserves legacy no-op boundaries without weakening evidence requirements for real work.

**How to apply:** Use DB-backed acceptance tests for no-op response-loss recovery and verify no Goal/Mission projection occurs. For non-empty phases, require substantive revision-bound evidence before acceptance or Goal/Mission completion; do not treat local phase status as proof.
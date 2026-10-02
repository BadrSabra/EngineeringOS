---
name: Workflow phase ledger
description: Durable workflow phases use the shared AI execution ledger rather than a parallel worker state.
---

Each workflow execution/phase pair has one idempotent operation identity. The current phase helper supplies no substantive evidence, so the shared autonomous operation gate rejects its success; its mocked unit test does not exercise that durable boundary. A separate non-final Goal projection can map `evidenceComplete` to `PROVEN` if it receives a successful acceptance, but the current helper cannot reach that branch.

**Why:** A root-directory check and server-authored node status are not substantive evidence that workflow work was performed, and the generic operation acceptance contract requires operation-bound evidence. Weakening that gate to make the phase helper succeed could turn a bookkeeping boundary into proof.

**How to apply:** Test phase execution through real durable acceptance, not only mocked completion. Do not infer that a phase succeeded from its local projection or relax the shared evidence gate; first define the phase success contract and add substantive, revision-bound evidence before allowing it to contribute to Goal/Mission completion.
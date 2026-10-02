---
name: Workflow phase ledger
description: Durable workflow phases use the shared AI execution ledger rather than a parallel worker state.
---

Each workflow execution/phase pair has one idempotent operation identity. The ledger records phase-local boundary completion; it does not prove that declared phase work ran, and it must not create synthetic evidence or Canonical Proof.

**Why:** A root-directory check and server-authored node status are not substantive evidence that workflow work was performed. Treating them as `PROVEN` could complete a linked Goal without Canonical Proof.

**How to apply:** Bind phase transitions to `ai_executions` and keep their local completion idempotent. A phase that performs real work needs its own substantive, revision-bound evidence path before it can contribute to Goal/Mission completion; preserve managed-root and revision checks for those proof-required executions.
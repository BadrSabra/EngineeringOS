---
name: Workflow phase ledger
description: Durable workflow phases use the shared AI execution ledger rather than a parallel worker state.
---

Each workflow execution/phase pair has one idempotent operation identity. The server owns its checkpoint, lease, dependency/attempt record, retained evidence, and terminal state; repeated requests must reuse that identity.

**Why:** Workflow rows alone cannot prove resumability or give Mission Control the same receipt as other autonomous entry points; the acceptance gate also rejects a phase whose durable execution has no workspace root because provenance cannot be verified.

**How to apply:** Bind phase transitions to ai_executions and let startup reconciliation resume paused work conservatively; never treat a model decision or HTTP response as phase proof. Proof-required phases must persist both the managed workspace root and revision in the execution request before terminal acceptance.
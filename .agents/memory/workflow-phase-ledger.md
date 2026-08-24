---
name: Workflow phase ledger
description: Durable workflow phases use the shared AI execution ledger rather than a parallel worker state.
---

Each workflow execution/phase pair has one idempotent operation identity. The server owns its checkpoint, lease, dependency/attempt record, retained evidence, and terminal state; repeated requests must reuse that identity.

**Why:** Workflow rows alone cannot prove resumability or give Mission Control the same receipt as other autonomous entry points.

**How to apply:** Bind phase transitions to ai_executions and let startup reconciliation resume paused work conservatively; never treat a model decision or HTTP response as phase proof.
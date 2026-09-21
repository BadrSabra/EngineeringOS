---
name: Closed-loop integration fixtures
description: How to test objective replanning without accidentally satisfying every target in the initial evidence scheduler
---

Closed-loop chat integration tests should keep deterministic target selection in the pure helper tests and use a narrow seam mock for the orchestration test when the server-owned evidence scheduler would otherwise read every declared path before replan.

**Why:** The normal tool loop intentionally forces missing declared evidence paths before synthesis, so a fixture with enough budget can legitimately bypass the post-loop replan branch.

**How to apply:** Assert actual replan tool execution, bounded target count, shared execution-ledger identity, and declared-path scope in the chat test; separately test real target derivation and truncation/failure ordering in pure tests.
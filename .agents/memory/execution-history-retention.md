---
name: Execution history retention
description: Safe retention boundary for execution receipts and dependent proof history.
---

Expired AI executions are eligible for deletion only when no durable proof, replay, world-transition, lineage, or child-execution records still reference them. The retention decision must be rechecked in the DELETE itself, including the age cutoff.

**Why:** Cascading deletion can erase accepted proof and lifecycle history, while independently persisted world facts may outlive their source rows. A selection-time check can also race with updates.

**How to apply:** Keep SELECT and DELETE dependency predicates aligned, recheck status and age at deletion time, and test that a referenced expired execution remains while an unrelated expired execution is removed.

---
name: Mission recipe claim transaction
description: Transaction boundary for approved Mission recipe dispatch and execution claim.
---

For Mission recipe execution, admission and the execution-start claim must hold Mission and Goal locks in the same database transaction. Paused-resume token recovery for that recipe belongs in the same transaction.

**Why:** a plan revision or approved Goal action can change between separate commits, allowing a recipe to start under stale authorization.

**How to apply:** keep plan/action/dependency checks and token recovery coupled with the claim. A standalone preflight is useful for scheduling but is not authority at execution start.

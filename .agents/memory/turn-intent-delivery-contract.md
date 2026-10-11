---
name: Turn intent delivery contract
description: Keep output-format routing aligned with server-authorized Build handoffs.
---

When a server-owned turn intent authorizes `DELIVERY`, do not inherit an analysis-derived output contract such as `REPAIR_PLAN`. Preserve forensic task classification only as provenance; the active output contract must match the execution action.

**Why:** A benchmark Build handoff remained routed through repair-plan output despite `task_execution` and approved write/validation tools, and the model stopped after reading without proposing a change.

**How to apply:** In `resolveTurnIntent` changes, test conflicting inputs where the original prompt classifies as analysis but the server supplies authoritative `DELIVERY`; verify the final output contract is generic and the write/validation gates remain unchanged.

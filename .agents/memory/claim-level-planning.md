---
name: Claim-level evidence planning
description: Server-owned objective claims now drive bounded evidence scheduling and recovery without rereading retained proof.
---

Claim planning is a projection of the existing objective contract: objective-level paths remain ordered first, then each claim contributes only its missing evidence paths. A retained accepted claim may suppress its declared paths only when every evidence ref is still retained in the current revision.

**Why:** Path-only recovery could revisit complete files, lose the claim that required a path, or reopen a proven claim after a resumable handoff.

**How to apply:** Keep provider prose and graph hints outside planning authority. Pass current claim state into replanning, keep evidence refs bound to retained bodies, and treat missing paths as coverage gaps rather than proof of final claim closure.
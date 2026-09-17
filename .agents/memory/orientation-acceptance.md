---
name: Orientation acceptance boundary
description: Project orientation uses role coverage and a server-owned validator receipt, not targeted project-query analysis evidence.
---

Project orientation is a proof-backed read-only execution, but its acceptance contract is complete server-owned role coverage. It must not be forced through the targeted PROJECT_QUERY `analysisEvidence` gate; successful coverage still produces a bound `project-query-evidence.v1` receipt.

**Why:** Orientation has no inferred target objective, so applying the targeted evidence gate rejects complete, valid role reads even when the orientation coverage contract is satisfied.

**How to apply:** Keep orientation excluded from targeted project-query proof checks, require complete orientation coverage before terminalization, and derive objective validation only from that server-owned coverage result.
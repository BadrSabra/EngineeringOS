---
name: Orientation acceptance boundary
description: Project orientation uses role coverage and a server-owned validator receipt, not targeted project-query analysis evidence.
---

Project orientation is a proof-backed read-only execution, but its acceptance contract is complete server-owned role coverage. It must not be forced through the targeted PROJECT_QUERY `analysisEvidence` gate; successful coverage still produces a bound `project-query-evidence.v1` receipt.

**Why:** Orientation has no inferred target objective, so applying the targeted evidence gate rejects complete, valid role reads even when the orientation coverage contract is satisfied.

**How to apply:** Keep orientation excluded from targeted project-query proof checks, require complete orientation coverage before terminalization, and derive objective validation only from that server-owned coverage result.

The orientation verdict must be derived from the same role-coverage closure at every finalization seam, including non-native and native streaming traces. The route acceptance boundary must refuse a successful terminal projection when complete coverage is paired with an explicitly incomplete decision trace.

**Why:** Orientation may not carry a structured target objective, so generic objective-gate telemetry can remain incomplete even after all server-owned role reads are complete; allowing that stale trace beside `PROVEN` creates public parity contradictions.

**How to apply:** Treat complete orientation coverage as `ANSWER_COMPLETE` evidence without requiring an inferred objective, and keep the acceptance projection incomplete if its persisted decision trace explicitly reports recovery or non-verification.
---
name: Terminal ownership fences
description: Durable worker completion and failure transitions must remain coupled to ownership checks.
---

Terminal writes for leased work must use the current worker identity and live status as compare-and-set conditions, and callers must stop follow-on mutations when that write loses the race.

**Why:** A stale worker can finish after reconciliation or cancellation has transferred ownership; an unguarded terminal write can overwrite the winner and make downstream project state appear successful or failed incorrectly.

**How to apply:** Keep ownership/status predicates on completion and failure updates, return whether the write won, and gate related events, project updates, promotion, validation, or delivery on that result.
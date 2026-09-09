---
name: Terminal ownership fences
description: Durable worker completion and failure transitions must remain coupled to ownership checks.
---

Terminal writes for leased work must use the current worker identity and live status as compare-and-set conditions, and callers must stop follow-on mutations when that write loses the race. Failure-message reservation needs the same fence as success-message reservation.

**Why:** A stale worker can finish after reconciliation or cancellation has transferred ownership; an unguarded terminal write can overwrite the winner and make downstream project state appear successful or failed incorrectly. Reserving a final message before the acceptance fence can strand an execution with a misleading message identity and no authoritative acceptance.

**How to apply:** Keep ownership/status predicates on completion, failure, and final-message reservation updates; select every field used by the ownership check; return whether the write won; and gate related events, project updates, promotion, validation, or delivery on that result. Abort signals are advisory for providers; re-check durable ownership after every awaited provider/tool operation before interpreting or persisting its result.
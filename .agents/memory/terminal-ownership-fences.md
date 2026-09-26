---
name: Terminal ownership fences
description: Durable worker completion and failure transitions must remain coupled to ownership checks.
---

Terminal writes for leased work must use the current worker identity and live status as compare-and-set conditions, and callers must stop follow-on mutations when that write loses the race. Failure-message reservation needs the same fence as success-message reservation.

An Episode event's actorId records who wrote that immutable event; it is provenance, not continuing lease authority. During same-attempt recovery, a replacement worker may consume a canonical request written by the previous worker. Its follow-on append must still pass the current execution worker/lease fence.

**Why:** A stale worker can finish after reconciliation or cancellation has transferred ownership; an unguarded terminal write can overwrite the winner and make downstream project state appear successful or failed incorrectly. Reserving a final message before the acceptance fence can strand an execution with a misleading message identity and no authoritative acceptance.

**How to apply:** Keep ownership/status predicates on completion, failure, and final-message reservation updates; select every field used by the ownership check; return whether the write won; and gate related events, project updates, promotion, validation, or delivery on that result. Abort signals are advisory for providers; re-check durable ownership after every awaited provider/tool operation before interpreting or persisting its result.

For Episode-request recovery, require a well-formed worker provenance record and match the full canonical action plus project/Episode/execution/attempt. Do not require the request actorId to equal the replacement worker; authorization for ACTION_COMMITTED comes from the subsequent append's current lease check.

**Why:** Worker IDs may rotate while a same-attempt Episode remains stable. Equating historical actorId with current lease owner would make a valid append-only request unrecoverable; dropping the current append fence would let stale workers write.

**How to apply:** Separate immutable event provenance from current write authority. Preserve the attempt boundary, reject missing/malformed request identity, and let the existing ownership-fenced append authorize the new event.
---
name: Recipe contract schemas
description: Non-obvious Zod and namespaced-ID constraints for safe capability recipe contracts.
---

Required recipe values must use an explicit presence guard rather than relying on `z.any()` or `z.unknown()`; in this Zod runtime those schemas can make object fields optional. Compiled evidence predicates need a separate schema with the wider server-owned node-ID bound because namespacing a valid source ID can exceed the source recipe limit.

**Why:** A missing model value could otherwise pass contract parsing, and validating compiled IDs with the source-node schema can reject valid deterministic plans.

**How to apply:** When adding mandatory recipe fields, use a required value schema. When compiling or persisting namespaced predicates, validate them with the compiled predicate schema rather than the source predicate schema.

Recipe execution scope must be revalidated at invocation time against canonical realpaths, and a passed node must carry a server-produced evidence receipt before it can satisfy an outcome predicate.

**Why:** A compiled relative path can become unsafe through symlink changes, and a callback that merely returns `status: passed` is not proof that the required validation actually ran.

**How to apply:** Keep recipe definitions server-owned; bind their approved paths and candidate identity durably, re-check the lease/scope before lifecycle transitions, and derive evidence references from validated capability output.

An execution idempotency key must match the full durable recipe binding, including candidate identity and candidate workspace; a matching request envelope alone is insufficient.

**Why:** Reusing a key for a different candidate can silently return the first execution and make validation or delivery evidence refer to the wrong isolated bytes.

**How to apply:** Compare the stored checkpoint binding during both normal idempotency replay and the unique-key conflict reread; allow replay only for the same binding generation and reject candidate drift.

Recipe binding identity must exclude transient lifecycle fields such as phase, lease owner, and lease expiry when replaying or reclaiming the same candidate generation.

**Why:** Reconciliation intentionally clears worker ownership and pauses an expired execution; including stale lease state in identity prevents a new worker from reclaiming the unchanged candidate.

**How to apply:** Compare project, operation, revision, candidate, approved scope, and budgets for identity, then let the claim transition rewrite the current phase and lease atomically.

Recipe runner recovery must reconcile the server-owned plan with checkpointed node states, retain evidence refs for passed nodes, and keep checkpoint versions within the database integer range.

**Why:** Rebuilding a fresh plan reruns completed validation, dropping evidence refs makes a passed node impossible to include in the final receipt, and wall-clock sequence values can abort the first progress write.

**How to apply:** Resume only validated checkpoint nodes, persist each passed node's receipt ref in every progress snapshot, hydrate retained refs before continuing, and advance from the claimed durable checkpoint version.

An expired-lease pause acceptance is provisional and may be replaced only by the currently claimed worker while its live lease is valid; terminal acceptance message IDs must be verified before persistence.

**Why:** Reclaiming the same execution attempt otherwise looks like a duplicate and leaves the execution running, while synthetic receipt IDs can violate the chat-message foreign key.

**How to apply:** Allow the live reclaimed worker to update only the matching lease-expired pause acceptance in the same transaction, and downgrade missing message references to an existing valid ID or null.

An asynchronous checkpoint rejection is not automatically lease loss: a lower sequence can arrive after a newer write from the same live worker.

**Why:** Recipe progress observers write without awaiting each other, so database ordering can legitimately reject an older snapshot while ownership remains valid.

**How to apply:** After a rejected checkpoint, probe the durable lease; abort only when the worker no longer owns it, and preserve the newer checkpoint when ownership is still live.

Cancellation can win after every recipe node passes but before terminal acceptance; the runner must finalize cancellation through the durable failure path and replace any provisional lease-expired acceptance, preserving the cancelled recipe receipt.

**Why:** A reclaimed recipe may still have a prior pause acceptance. Treating the cancellation finalization as a duplicate leaves the execution in `cancelling`, and omitting the receipt from the replacement branch makes reloads lose the terminal result.

**How to apply:** When completion loses to cancellation, call the server-owned cancelled finalizer, allow provisional acceptance replacement only for explicit cancellation, and persist the receipt in both insert and replacement paths.

Reconciliation can terminalize a cancellation after the worker has already entered its completion fallback; a recipe runner must treat an already-cancelled durable row as a successful cancellation handoff, not as a lease-loss exception.

**Why:** The reconciler may win after cancellation and before the worker's fallback. Without a guarded receipt handoff, the API reports an error for a correctly cancelled execution and reloads can lose the recipe result.

**How to apply:** Let reconciliation replace a provisional cancellation acceptance, then allow the worker to persist its receipt only onto a cancelled execution with no existing receipt; never reopen or overwrite a terminal row.

Every terminal acceptance must carry the worker's captured attempt identity and validate it after locking the execution row; a finalization key or optional worker ID is not an attempt fence.

**Why:** A delayed callback from an earlier retry can arrive after a new attempt is running. Without an attempt check, it can create a new acceptance and terminalize the wrong attempt even when its textual key says `attempt:0`.

**How to apply:** Require `expectedAttempt` in all server-owned completion, failure, task, cancellation, and reconciliation paths; reject mismatches before any acceptance or side-effect write while preserving stale-snapshot diagnostics where applicable.
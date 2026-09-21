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
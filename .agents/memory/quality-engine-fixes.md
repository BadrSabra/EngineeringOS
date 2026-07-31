---
name: Quality engine scoring and context cache NOTIFY eviction fixes
description: Two bugs found when applying the quality-engine patch — scoring threshold miss and compound cache key mismatch in the NOTIFY handler.
---

## Bug 1: quality-engine `assessStructuredOutput` scoring gap (task_execution)

**Rule:** The `task_execution` scorer must include a bonus for a non-placeholder `summary` field.

**Why:** The scoring formula produced 0.735 for a valid payload but the threshold is 0.75. The `summary` field was not included in the profile-specific bonus section, leaving a 0.015 gap.

**Fix:** Added `if (typeof summary === "string" && !isPlaceholderText(summary)) score += 0.04;` in the `task_execution` case of `assessStructuredOutput` in `lib/ai-orchestrator/src/quality-engine.ts`.

**How to apply:** If the `task_execution` scorer is ever revised, keep `summary` as a scored field alongside `result`, `steps`, and `confidence`.

---

## Bug 2: `startContextInvalidationChannel` NOTIFY eviction used bare projectId as cache key

**Rule:** The NOTIFY handler in `context-builder.ts` must iterate all keys with prefix `projectId::` and delete them — not call `contextCache.delete(msg.payload)` directly.

**Why:** Cache keys are compound strings (`projectId::sections` built by `buildContextCacheKey`). Using the bare projectId as the delete key is always a no-op — cross-process NOTIFY invalidation was silently broken.

**Fix:** In `startContextInvalidationChannel`, replaced `contextCache.delete(msg.payload)` with a prefix-scan loop identical to `invalidateContextCache`.

**How to apply:** Any future eviction from the NOTIFY handler must use the same prefix-scan pattern. The `invalidateContextCache` function is the canonical example.

---

## Bug 3: Test isolation — `startContextInvalidationChannel` describe block leaked cache state

**Rule:** The LISTEN channel describe block needs its own `beforeEach` that calls `invalidateContextCache` and resets `_tableData`, not just an `afterEach` for the notifier.

**Why:** The `setInvalidationNotifier` describe block's final test ("PostFailedNotify") left a cache entry that poisoned the first test in the LISTEN channel block.

**Fix:** Added a `beforeEach` in `startContextInvalidationChannel — LISTEN channel` that mirrors the top-level describe's setup.

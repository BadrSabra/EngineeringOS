---
name: Context cache invalidation rule
description: Any code path that commits DB state the context-builder reads must call invalidateContextCache — the 30-second TTL is not a substitute.
---

# Context cache invalidation rule

## The rule
Every function that writes to a table read by `lib/ai-orchestrator/src/context-builder.ts` **must** call `invalidateContextCache(projectId)` after the write commits. The 30-second TTL is a performance optimisation, not a correctness guarantee.

Tables context-builder reads: `projects`, `tasks`, `metrics`, `graphEntities`, `graphRelationships`, `events`, `workflows`, `scanJobs`.

## Why
`buildProjectContext` caches the result for 30 seconds. If a scan completes, a task is updated, or a reconciliation resets a project status, the next AI chat turn will see the pre-change snapshot for up to 30 seconds. In practice users trigger AI chat immediately after a scan — they will see stale metrics and scan status.

## Where it was missing (fixed)
- `artifacts/api-server/src/lib/scan-runner.ts` — neither success nor failure path called `invalidateContextCache`; fixed in both paths.
- `artifacts/api-server/src/lib/job-reconciliation.ts` — project reset from "scanning"→"active" at startup did not bust the cache; fixed per project.

## Where it is already wired
- `artifacts/api-server/src/routes/ai.ts`: apply-changes, analyze, review, orchestrate, task-execute all call `invalidateContextCache` after their DB writes.

## How to apply
Import `{ invalidateContextCache }` from `@workspace/ai-orchestrator`. Call it synchronously (it's a Map.delete) after the transaction commits, in the same try/catch level as `recordAudit`. Do not call it inside the transaction — if the transaction rolls back, the cache entry is still valid.

## Rate-limit map note
`_projectCallTimestamps` in `routes/ai.ts` is now swept every 5 minutes via `.unref()` interval to prevent unbounded growth. Any future in-memory Map keyed by projectId should follow the same pattern.

---
name: PR-D1 Job Queue Durability
description: enqueueWithId deduplication + stale-pending sweep added to job-queue and job-reconciliation
---

## Rule
All DB-backed jobs (scan, discovery, AI tasks) must use `heavyJobQueue.enqueueWithId(id, fn)` with their DB row ID. Never use plain `enqueue()` for jobs that have a stable ID.

**Why:** The stale-pending sweep (`requeueStalePendingJobs`) periodically re-enqueues scan_jobs stuck in "queued" state. Without `enqueueWithId`, a job already in the in-memory pending array would get enqueued twice, causing double-execution.

**How to apply:**
- `enqueueWithId(id, fn)` → returns `false` (skipped) if job already tracked; `true` if added
- `has(id)` → check before calling if you need to skip the log on no-op
- Plain `enqueue(fn)` → only for genuinely anonymous, one-off jobs with no DB row ID
- Advisory lock inside `runScanJob` is a second safety net for multi-instance deployments

## Files changed
- `artifacts/api-server/src/lib/job-queue.ts` — added `enqueueWithId`, `has`, `pendingIds/runningIds` Sets
- `artifacts/api-server/src/lib/job-reconciliation.ts` — added `requeueStalePendingJobs`, `STALE_PENDING_TIMEOUT_MS` (15 min default), updated `startStaleJobSweep` to run both sweeps
- `artifacts/api-server/src/routes/projects.ts`, `git.ts`, `discovery.ts`, `ai/tasks.ts` — all updated to `enqueueWithId`
- `job-queue.test.ts` / `job-reconciliation.test.ts` — 15 new tests; mock updated to include `enqueueWithId` and `has`

## Test mock pattern
When mocking `./job-queue.js` for reconciliation tests:
```typescript
vi.mock("./job-queue.js", () => ({
  heavyJobQueue: {
    enqueue: vi.fn(),
    enqueueWithId: vi.fn().mockReturnValue(true),
    has: vi.fn().mockReturnValue(false),
  },
}));
```
Assertions must check `enqueueWithId`, not `enqueue`, for all reconciliation re-enqueue calls.

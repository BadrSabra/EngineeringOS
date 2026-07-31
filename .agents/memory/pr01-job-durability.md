---
name: PR-01 Job Durability
description: How durable background jobs work after process restart — the pending status, discovery-runner extraction, and reconciliation split.
---

## The problem
`heavyJobQueue` is in-memory. On restart, queued/running closures vanish but DB rows still show non-terminal statuses, leaving jobs "stuck".

## The fix

### Discovery sessions: added `"pending"` status
- `discovery_session_status` PG enum now has `[pending, discovering, ready, error, imported]`.
- Route creates session as `"pending"` before enqueueing.
- `runDiscovery` (in `lib/discovery-runner.ts`) immediately transitions `pending → discovering` as its very first action.
- This gives reconciliation a clean signal: `pending` = never started (safe to re-enqueue), `discovering` = was in-flight (mark error).

### Scan jobs: split `queued` vs `running`
- `queued` → re-enqueue via `heavyJobQueue.enqueue(() => runScanJob(id, projectId))` — project stays `scanning`
- `running` → mark failed + reset project to `active` + invalidate context cache

### `runDiscovery` extracted to `lib/discovery-runner.ts`
- Original lived in `routes/discovery.ts`. Reconciliation can't import from routes (circular).
- All detect* helpers, `STEPS`, `updateSession`, and `runDiscovery` moved to the lib.
- Route imports `{ runDiscovery, STEPS }` from the lib; `DiscoveryResultData`, `ScannedFile`, `walkProject`, etc. removed from route imports.

## Testing
- `job-reconciliation.test.ts` mocks `./job-queue.js` (`heavyJobQueue: { enqueue: vi.fn() }`) to prevent actual job execution during tests — this makes the "re-enqueued" assertions deterministic.
- 4 status paths tested: running→failed, queued→re-enqueued, discovering→error, pending→re-enqueued.

**Why:**
Without mocking the queue, re-enqueued jobs race with test assertions (Node.js is single-threaded but async; runScanJob hits its first `await` before test assertions run, making results non-deterministic).
